import { spawn } from 'child_process';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';
import fs from 'fs';

dotenv.config();

const IS_DEV = process.env.DEV === "true";
const STATUS = Object.freeze({
    STOPPED: 'STOPPED',
    RUNNING: 'RUNNING',
    CRASHED: 'CRASHED'
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, './procxygen.default.config.js');
const WRAPPER_PATH = path.resolve(__dirname, './wrapper/wrapper.js');

async function getDefaultConfig() {
    if (fs.existsSync(DEFAULT_CONFIG_PATH) && fs.lstatSync(DEFAULT_CONFIG_PATH).isFile())
        return import(pathToFileURL(DEFAULT_CONFIG_PATH).href);
    else throw new Error('Default config not found !');
}

async function getConfig() {
    let module;

    if (IS_DEV) {
        console.log('Procxygen is running as DEVELOPMENT mode !');
        module = await import(pathToFileURL(DEFAULT_CONFIG_PATH).href);
    } else {
        const CONFIG_PATH = path.resolve(__dirname, './procxygen.config.js');
        const EXISTS = await fs.existsSync(CONFIG_PATH);
        const IS_FILE = EXISTS ? await fs.lstatSync(CONFIG_PATH).isFile() : false;

        if (EXISTS && IS_FILE) {
            module = await import(CONFIG_PATH);
        } else {
            module = await import(pathToFileURL(DEFAULT_CONFIG_PATH).href);
        }
    }

    return module.default;
}

const config = await getConfig();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
let services = [];

const CustomCodes = Object.freeze({
    STOP: 88
});

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
    }

    start() {
        this.stop();
        if (this.logs.length > 0) this.logs = [];

        console.log(`[${this.name}] Lancement...`);

        if (this.exec === 'node' && !this.args.includes(WRAPPER_PATH))
            this.args.unshift(WRAPPER_PATH);

        this.child = spawn(this.exec, this.args, {
            env: { ...process.env, ...this.env },
            stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
            shell: false // Désactivé pour ne pas casser le canal IPC
        });

        const handleLog = (data, type = LogTypes.INFO) => {
            const line = data.toString().trim();
            const logInst = new Log(line, type);
            this.logs.push(logInst);

            if (this.logs.length > 100) this.logs.shift(); // Garder 100 lignes

            io.emit(`log-new`, {name: this.name, log: logInst}); // Envoi au web
        };

        this.child.stdout.on('data', (data) => handleLog(data, LogTypes.INFO));
        this.child.stderr.on('data', (data) => handleLog(data, LogTypes.ERROR));
        this.child.on('spawn', () => this.updateStatus(STATUS.RUNNING));
        this.child.on('close', (code) => {
            if (code !== null && code !== 0 && code !== CustomCodes.STOP) {
                this.updateStatus(STATUS.CRASHED);
                setTimeout(() => this.start(), 3000);
            } else {
                this.updateStatus(STATUS.STOPPED);
            }
        });
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        io.emit('status-update', { name: this.name, status: this.status });
    }

    stop(customCode = CustomCodes.STOP) {
        if (!this.child) return;

        this.child.send({ action: 'STOP', code: customCode });
        this.child = null;
    }

    restart() {
        this.stop();
        setTimeout(() => this.start(), 1000);
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
    console.log(webPath);
    app.use(express.static(webPath));
    app.get('/', (req, res) => res.sendFile(path.join(webPath, 'index.html')));
}

function initSocketListeners(io) {
    io.on('connection', (socket) => {
        socket.emit('services', services);

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

    return { app, httpServer, io };
}

function consoleDashboard() {
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
}

function main() {
    services = initServices();
    const { app, httpServer, io } = initServer();

    services.forEach(service => service.start());

    setInterval(() => consoleDashboard(), 10000);
}

main();