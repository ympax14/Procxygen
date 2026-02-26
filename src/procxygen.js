import { spawn } from 'child_process';
import os from 'os';
import('loadavg-windows'); // Nécessaire pour loadAvg sur Windows car pas natif
import pidusage from 'pidusage';
import fs from 'fs';
import dotenv from 'dotenv';

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

dotenv.config();

const IS_DEV = process.env.IS_PROD === "false";
const STATUS = Object.freeze({
    STOPPED: 'STOPPED',
    RUNNING: 'RUNNING',
    CRASHED: 'CRASHED'
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, './procxygen.default.config.js');

async function getDefaultConfig() {
    if (fs.existsSync(DEFAULT_CONFIG_PATH) && fs.lstatSync(DEFAULT_CONFIG_PATH).isFile()) {
        const res = await import(pathToFileURL(DEFAULT_CONFIG_PATH).href);
        return res.default;
    }
    else throw new Error('Procxygen default config not found !');
}

async function getConfig() {
    let module;

    if (IS_DEV) {
        console.log('Procxygen is running as DEVELOPMENT mode !');
        const res = await import(pathToFileURL(DEFAULT_CONFIG_PATH).href);
        module = res.default;
    } else {
        const CONFIG_PATH = path.resolve(__dirname, './procxygen.config.js');
        const EXISTS = await fs.existsSync(CONFIG_PATH);
        const IS_FILE = EXISTS ? await fs.lstatSync(CONFIG_PATH).isFile() : false;

        if (EXISTS && IS_FILE) {
            console.log('config path: ', CONFIG_PATH);
            const res = await import(pathToFileURL(CONFIG_PATH).href);
            module = res.default;
        } else {
            console.warn('Procxygen config file not found ! Using default config file...');
            res = await getDefaultConfig();
            module = res.default;
        }
    }

    if (!module) {
        throw new Error("La configuration chargée est vide. Vérifiez l'export default dans vos fichiers config.");
    }

    return module;
}

let config;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
let services = [];

const LogTypes = Object.freeze({
    WARN: 'WARN',
    ERROR: 'ERROR',
    INFO: 'INFO'
});

class Log {
    constructor(content, type = LogTypes.INFO) {
        this.date = new Date().toLocaleString({ hour: '2-digit', minute: '2-digit', second: '2-digit'  });
        this.content = content;
        this.type = type;
    }
}

class Service {
    constructor(cfg) {
        this.name = cfg.name;
        this.exec = cfg.run.exec;
        this.args = cfg.run.args;
        this.env = cfg.run.env;
        this.color = cfg.color;
        this.child = null;
        this.restartCount = 0;
        this.logs = []; // Stockage temporaire des derniers logs
        this.status = STATUS.STOPPED;
        this.stopping = false;
    }

    start() {
        if (this.child) return;
        console.log(`[${this.name}] Lancement...`);

        if (this.logs.length > 0) this.logs = [];

        this.child = spawn(this.exec, this.args, {
            env: { ...process.env, ...this.env },
            stdio: ['inherit', 'pipe', 'pipe'],
            detached: true,
            shell: false // Désactivé pour ne pas casser le canal IPC
        });

        this.child.stdout.on('data', (data) => this.handleLog(data, LogTypes.INFO));
        this.child.stderr.on('data', (data) => this.handleLog(data, LogTypes.ERROR));
        this.child.on('spawn', () => {
            this.updateStatus(STATUS.RUNNING)
            console.log(`[${this.name}] Lancé !`);
        });
        this.child.on('close', (code) => {
            this.child = null;

            if (this.stopping || code === null || code === 0) {
                this.stopping = false;
                this.updateStatus(STATUS.STOPPED);
                console.log(`[${this.name}] Arrêté...`);
            } else {
                this.updateStatus(STATUS.CRASHED);
                console.log(`[${this.name}] Crash avec le code ${code}. Tentative de redémarrage dans 3 secondes...`);
                setTimeout(() => this.start(), 3000);
            }
        });
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        io.emit('status-update', { name: this.name, status: this.status });
    }

    stop() {
        if (this.stopping || !this.child) return;
        this.stopping = true;

        const pid = this.child.pid;
        console.log(`[PROCXYGEN] Arrêt du processus ${this.name} (#${pid})`);

        this.killProcessTree(pid);
    }

    killProcessTree(pid) {
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", pid, "/T", "/F"]);
        } else {
            try {
                process.kill(-pid, "SIGTERM");
            } catch {}

            setTimeout(() => {
                try {
                    process.kill(-pid, "SIGKILL");
                } catch {}
            }, 5000);
        }
    }

    restart() {
        this.stop();
        setTimeout(() => {
            this.start();
        }, 1000);
    }

    getStats() {
        // En vrai PM2 utilise 'pidusage', ici on fait simple
        return {
            name: this.name,
            status: this.status,
            restarts: this.restartCount,
            pid: this.child?.pid
        };
    }

    handleLog(data, type = LogTypes.INFO) {
        const line = data.toString().trim();
        const log = new Log(line, type);
        this.logs.push(log);

        if (this.logs.length > config.max_logs) this.logs.shift(); // Garder 100 lignes

        io.emit(`log-new`, { name: this.name, log: log }); // Envoi au web
    };
}

function initServices() {
    const services = [];

    for (const service of config.services) {
        if (service.devOnly && !IS_DEV) continue;

        services.push(new Service(service));
    }

    return services;
}

function initExpressRoutes(app) {
    const webPath = path.resolve(__dirname, 'web');
    app.use(express.static(webPath));
    app.get('/', (req, res) => res.sendFile(path.join(webPath, 'index.html')));
}

function initSocketListeners(io) {
    io.on('connection', (socket) => {
        socket.emit('config', { services, max_logs: config.max_logs });

        /*services.forEach(service => {
            service.updateStatus(service.status);
            socket.emit(`logs:${service.name}`, service.logs);
        });*/

        socket.on('restart-service', (name) => {
            const target = services.find(i => i.name === name);
            if (target) target.restart();
        });

        socket.on('stop-service', (name) => {
            const target = services.find(i => i.name === name);
            if (target) target.stop();
        });

        socket.on('start-service', (name) => {
            const target = services.find(i => i.name === name);
            if (target) target.start();
        });

        socket.on('clear-logs', (name) => {
            const target = services.find(i => i.name === name);
            if (target) target.logs = [];
        });
    });
}

function initServer() {
    initExpressRoutes(app);
    initSocketListeners(io);

    httpServer.listen(config.port, () => {
        console.log(`🚀 DRPM Interface: http://localhost:${config.port}`);
    });
}

function consoleDashboard() {
    setInterval(async () => {
        console.clear();
        console.log(`=== 🛡️  PROCXYGENS  🛡️ ===`);
        console.table(services.map(s => s.getStats()));

        let loadTable = {};

        os.loadavg().forEach((value, index) => {
            let label = index === 0 ? '1 minute' : (index === 1 ? '5 minutes' : '15 minutes');
            loadTable[index] = { last: label, load: value.toFixed(2) }
        });

        console.table(loadTable);
        console.log(`Uptime ProcessManager ${process.uptime().toFixed(1)}s | Uptime Système: ${os.uptime().toFixed(1)}s`);
    }, 10000);
}

function startMonitoring() {
    setInterval(async () => {
        const stats = [];

        for (const service of services) {
            if (!service.child?.pid) continue;

            try {
                const s = await pidusage(service.child.pid);

                stats.push({
                    name: service.name,
                    cpu: s.cpu.toFixed(2),
                    memory: (s.memory / 1024 / 1024).toFixed(2),
                    uptime: (s.elapsed / 1000).toFixed(0),
                    pid: service.child.pid
                });

            } catch(err) {
                console.log(err);
            }
        }

        io.emit("monitor", stats);
    }, 1000);
}

function main() {
    initServer();
    services = initServices();
    startMonitoring();

    services.forEach(service => service.start());
}

(async () => {
    config = await getConfig();
    main();
})();