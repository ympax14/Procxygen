const MAX_LOGS = 100;
const STATUS = Object.freeze({
    STOPPED: 'STOPPED',
    RUNNING: 'RUNNING',
    CRASHED: 'CRASHED'
});

const socket = io();
let services = [];
let activeService = null;

// --- UTILS ---
function getLogsElement() {
    return document.getElementById('logs');
}

function ansiToHtml(text) {
    const colors = {
        '0': 'initial',
        '1': 'font-weight: bold',
        '31': 'color: #ef4444',
        '32': 'color: #22c55e',
        '33': 'color: #eab308',
        '34': 'color: #3b82f6',
        '36': 'color: #06b6d4',
    };
    return text.replace(/\x1b\[(\d+)m/g, (match, code) => {
        return code === '0' ? '</span>' : `<span style="${colors[code] || ''}">`;
    }).replace(/\x1b\[m/g, '</span>');
}

function getLogLine(log) {
    const textColor = log.type === 'ERROR' ? 'text-red-400' : 'text-slate-400';
    const timeColor = log.type === 'ERROR' ? 'text-red-600' : 'text-green-600';
    return `<div class="font-mono leading-tight ${textColor}"><span class="${timeColor}">[${log.date}]</span> ${ansiToHtml(log.content)}</div>`;
}

function getStatusColor(status, withShadow = false) {
    const colors = {
        'RUNNING': 'bg-green-500',
        'CRASHED': 'bg-orange-500',
        'STOPPED': 'bg-red-500'
    };
    const shadow = withShadow ? `shadow-[0_0_10px_currentcolor]` : '';
    return `${colors[status] || 'bg-slate-500'} ${shadow}`;
}

// --- CORE FUNCTIONS ---

function renderTabs() {
    const container = document.getElementById('tabs-container');
    container.innerHTML = '';

    services.forEach(service => {
        const isActive = service.name === activeService;
        const btn = document.createElement('button');
        btn.onclick = () => switchTab(service.name);
        btn.className = `px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center gap-2 ${isActive
                ? 'bg-blue-600/20 border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                : 'bg-[#0f172a] border-white/5 text-slate-500 hover:border-white/20'
            }`;
        btn.innerHTML = `<div id="dot-${service.name}" class="w-2 h-2 rounded-full ${getStatusColor(service.status)}"></div>${service.name}`;
        container.appendChild(btn);
    });
}

function renderActiveService() {
    const container = document.getElementById('active-service-container');
    const service = services.find(s => s.name === activeService);
    if (!service) return;

    // flex-col h-[calc(100vh-200px)] force la carte à tenir dans l'écran
    container.innerHTML = `
        <div class="bg-[#0f172a] border border-white/5 rounded-3xl overflow-hidden shadow-2xl flex-1 min-h-0 flex flex-col">
            <div class="p-4 px-6 flex justify-between items-center bg-white/2 border-b border-white/5 shrink-0">
                <div class="flex items-center gap-3">
                    <div id="status-${service.name}" class="w-3 h-3 rounded-full ${getStatusColor(service.status, true)}"></div>
                    <h2 class="font-black text-[10px] uppercase tracking-widest" style="color: ${service.color}">${service.name}</h2>
                </div>
                <div class="flex gap-2">
                    <button onclick="clearLogs('${service.name}')" class="px-3 py-1 bg-indigo-600/20 hover:scale-105 text-indigo-400 border border-indigo-600/30 rounded text-[9px] font-bold uppercase">Clear</button>
                    <button onclick="start('${service.name}')" class="px-3 py-1 bg-green-600/20 hover:scale-105 text-green-400 border border-green-600/30 rounded text-[9px] font-bold uppercase">Start</button>
                    <button onclick="restart('${service.name}')" style="background: rgba(234, 88, 12, 0.2)" class="px-3 py-1 hover:scale-105 rounded text-[9px] text-orange-400 border border-orange-600/30 font-bold uppercase transition-all">Restart</button>
                    <button onclick="stop('${service.name}')" class="px-3 py-1 bg-red-600/20 hover:scale-105 text-red-400 border border-red-600/30 rounded text-[9px] font-bold uppercase">Stop</button>
                </div>
            </div>
            
            <div id="logs" class="flex-1 min-h-0 p-4 overflow-y-auto custom-scrollbar bg-black/40 space-y-1">
                ${service.logs.map(log => getLogLine(log)).join('')}
            </div>
        </div>
    `;

    scrollToBottom(service.name);
}

function scrollToBottom() {
    const el = getLogsElement();
    if (el) {
        // Un petit timeout assure que le DOM est bien rendu avant de scroller
        setTimeout(() => {
            el.scrollTop = el.scrollHeight;
        }, 10);
    }
}

function switchTab(name) {
    activeService = name;
    renderTabs();
    renderActiveService();
}

// --- SOCKETS (Définis UNE SEULE FOIS) ---

socket.on('services', (_services) => {
    // Initialisation
    services = _services.map(s => ({ ...s }));
    if (services.length > 0) {
        activeService = services[0].name;
        renderTabs();
        renderActiveService();
    }
});

socket.on('status-update', ({ name, status }) => {
    const service = services.find(s => s.name === name);
    if (service) {
        service.status = status;
        // Update visuel sans re-render
        const dot = document.getElementById(`dot-${name}`);
        const mainDot = document.getElementById(`status-${name}`);
        if (dot) dot.className = `w-2 h-2 rounded-full ${getStatusColor(status)}`;
        if (mainDot) mainDot.className = `w-3 h-3 rounded-full ${getStatusColor(status, true)}`;
        if (status === STATUS.RUNNING) {
            service.logs = [];
            if (activeService === service.name) {
                const el = getLogsElement();
                if (el) el.innerHTML = '';
            }
        }
    }
});

socket.on('log-new', ({ name, log }) => {
    const service = services.find(s => s.name === name);
    if (service) {
        service.logs.push(log);
        if (service.logs.length > MAX_LOGS) service.logs.shift();

        if (activeService === name) {
            const el = getLogsElement();
            if (el) {
                el.insertAdjacentHTML('beforeend', getLogLine(log));
                if (el.children.length > MAX_LOGS) el.removeChild(el.firstChild);
                el.scrollTop = el.scrollHeight;
            }
        }
    }
});

// --- ACTIONS ---
function restart(name) {
    const target = services.find(i => i.name === name);
    if (!target) return;

    socket.emit('restart-service', name);
}

function start(name) {
    const target = services.find(i => i.name === name);
    if (!target || target.status != STATUS.STOPPED) return;

    socket.emit('start-service', name);
}
function stop(name) {
    const target = services.find(i => i.name === name);
    if (!target || target.status != STATUS.RUNNING) return;

    socket.emit('stop-service', name);
}
function clearLogs(name) {
    const service = services.find(s => s.name === name);
    if (service) service.logs = [];
    const el = getLogsElement();
    if (el) el.innerHTML = '';
    socket.emit('clear-logs', service.name);
}