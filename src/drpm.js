import { spawn } from 'child_process';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { config } from './drpm.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(__dirname, './wrapper/wrapper.js');

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
        this.date = new Date().toLocaleDateString();
        this.content = content;
        this.type = type;
    }
}

class Service {
    constructor(cfg) {
        this.name = cfg.name;
        this.script = cfg.script;
        this.color = cfg.color;
        this.env = cfg.env;
        this.child = null;
        this.restartCount = 0;
        this.logs = []; // Stockage temporaire des derniers logs
        this.status = 'STOPPED';
    }

    start() {
        if (this.child) this.child.send({ action: 'STOP', code: CustomCodes.STOP });
        if (this.logs.length > 0) this.logs = [];

        console.log(`[${this.name}] Lancement...`);

        this.child = spawn('node', [wrapperPath, this.script], {
            env: { ...process.env, ...this.env },
            stdio: ['inherit', 'pipe', 'pipe', 'ipc']
        });

        const handleLog = (data, type = LogTypes.INFO) => {
            const line = data.toString().trim();
            const logInst = new Log(line, type);
            this.logs.push(logInst);

            if (this.logs.length > 100) this.logs.shift(); // Garder 100 lignes

            io.emit(`log:${this.name}`, logInst); // Envoi au web
        };

        this.child.stdout.on('data', (data) => handleLog(data, LogTypes.INFO));
        this.child.stderr.on('data', (data) => handleLog(data, LogTypes.ERROR));
        this.child.on('spawn', () => this.updateStatus('RUNNING'));
        this.child.on('close', (code) => {
            if (code !== null && code !== 0 && code !== CustomCodes.STOP) {
                this.updateStatus('CRASHED');
                setTimeout(() => this.start(), 3000);
            } else {
                this.updateStatus('STOPPED');
            }
        });
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        io.emit(`status:${this.name}`, this.status);
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
    return config.services.map(s => new Service(s));
}

function initExpressRoutes(app) {
    app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), './src/index.html')));
}

function initSocketListeners(io) {
    io.on('connection', (socket) => {
        services.forEach(service => {
            service.updateStatus(service.status);
            socket.emit(`logs:${service.name}`, service.logs);
        });

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
    });
}

function initServer() {
    initExpressRoutes(app);
    initSocketListeners(io);

    // --- API & ROUTES ---

    httpServer.listen(config.port, () => {
        console.log(`🚀 DRPM Interface: http://localhost:${config.port}`);
    });

    return { app, httpServer, io };
}

function main() {
    services = initServices();
    const { app, httpServer, io } = initServer();

    services.forEach(service => service.start());

    setInterval(() => {
        console.clear();
        console.log(`=== 🛡️  DELTARISE PROCESS MANAGER ===`);
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

main();