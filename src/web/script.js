const socket = io();
const services = [
    {
        name: "BOT-DISCORD",
        status: "STOPPED",
        color: "#5865F2",
        logs: []
    }, {
        name: "BACKEND",
        status: "STOPPED",
        color: "#3b82f6",
        logs: []
    }, {
        name: "FRONTEND",
        status: "STOPPED",
        color: "#3b82f6",
        logs: []
    }
];

function getLogsElement(service) {
    return document.getElementById(`logs-${service.name}`);
}

function getDotElement(service) {
    return document.getElementById(`status-${service.name}`);
}

function ansiToHtml(text) {
    const colors = {
        '0': 'initial',
        '1': 'font-weight: bold',
        '2': 'opacity: 1',
        '31': 'color: #ef4444', // Red
        '32': 'color: #22c55e', // Green
        '33': 'color: #eab308', // Yellow
        '34': 'color: #3b82f6', // Blue
        '36': 'color: #06b6d4', // Cyan
        '39': 'color: initial', // Default
    };

    // Regex pour capturer les séquences ESC[...m
    return text.replace(/\x1b\[(\d+)m/g, (match, code) => {
        if (code === '0') return '</span>';
        const style = colors[code];
        return style ? `<span style="${style}">` : '';
    }).replace(/\x1b\[m/g, '</span>');
}

function getLogLine(log) {
    const textColor = log.type === 'ERROR' ? 'text-red-500' : 'text-slate-500';

    // On nettoie et formate le contenu
    const cleanContent = ansiToHtml(log.content);

    return `
    <div class="opacity-100 ${textColor}">
        <span class="${log.type === 'ERROR' ? 'text-red-600' : 'text-green-600'}">[${log.date}]</span>
        ${cleanContent}
    </div>`;
}

let activeService = services[0].name; // Par défaut le premier service

function renderUI() {
    const tabsContainer = document.getElementById('tabs-container');
    const mainContainer = document.getElementById('active-service-container');
    
    tabsContainer.innerHTML = '';
    mainContainer.innerHTML = '';

    services.forEach(service => {
        const isActive = service.name === activeService;
        
        // 1. Génération de l'onglet
        const tab = document.createElement('button');
        tab.onclick = () => switchTab(service.name);
        tab.className = `px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all border ${
            isActive 
            ? 'bg-blue-600/20 border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
            : 'bg-[#0f172a] border-white/5 text-slate-500 hover:border-white/20'
        }`;
        tab.innerHTML = `
            <div class="flex items-center gap-2">
                <div id="dot-${service.name}" class="w-2 h-2 rounded-full ${getStatusColor(service.status)}"></div>
                ${service.name}
            </div>
        `;
        tabsContainer.appendChild(tab);

        // 2. Génération de la carte de logs (uniquement si actif)
        if (isActive) {
            const card = `
            <div class="bg-[#0f172a] border border-white/5 rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[calc(100vh-250px)]">
                <div class="p-6 flex justify-between items-center bg-white/5">
                    <div class="flex items-center gap-3">
                        <div id="status-${service.name}" class="w-4 h-4 rounded-full ${getStatusColor(service.status, true)}"></div>
                        <h2 class="font-black text-xs uppercase tracking-widest" style="color: ${service.color}">${service.name}</h2>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="clearLogs('${services.indexOf(service)}')" class="px-4 py-1.5 bg-orange-600 hover:scale-105 rounded-lg text-[10px] font-black uppercase transition-all">Clear</button>
                        <button onclick="start('${service.name}')" class="px-4 py-1.5 bg-green-600/75 hover:scale-105 rounded-lg text-[10px] font-black uppercase transition-all">Start</button>
                        <button onclick="restart('${service.name}')" class="px-4 py-1.5 bg-indigo-600/75 hover:scale-105 rounded-lg text-[10px] font-black uppercase transition-all">Restart</button>
                        <button onclick="stop('${service.name}')" class="px-4 py-1.5 bg-red-600/75 hover:scale-105 rounded-lg text-[10px] font-black uppercase transition-all">Stop</button>
                    </div>
                </div>
                <div id="logs-${service.name}" class="flex-1 p-4 overflow-y-auto text-[11px] console custom-scrollbar space-y-1">
                </div>
            </div>`;
            mainContainer.innerHTML = card;
            
            // Re-remplir les logs stockés
            const logsElement = getLogsElement(service);
            service.logs.forEach(log => logsElement.innerHTML += getLogLine(log));
            logsElement.scrollTop = logsElement.scrollHeight;
        }

        // --- Écouteurs Socket (toujours actifs pour stocker en arrière-plan) ---
        socket.off(`log:${service.name}`); // Évite les doublons d'écouteurs
        socket.on(`log:${service.name}`, (log) => {
            service.logs.push(log);
            if (service.logs.length > 100) service.logs.shift();
            
            if (activeService === service.name) {
                const el = getLogsElement(service);
                el.innerHTML += getLogLine(log);
                if (el.children.length > 100) el.removeChild(el.firstChild);
                el.scrollTop = el.scrollHeight;
            }
        });

        socket.off(`logs:${service.name}`); // Évite les doublons d'écouteurs
        socket.on(`logs:${service.name}`, (logs) => {
            service.logs = logs;
            if (service.logs.length > 100) service.logs.splice(0, service.logs.length - 100);

            if (activeService === service.name) {
                const el = getLogsElement(service);
                let logsContent = '';

                for (const log of service.logs) {
                    logsContent += getLogLine(log);
                }
            
                el.innerHTML = logsContent;
                el.scrollTop = el.scrollHeight;
            }
        });

        socket.off(`status:${service.name}`);
        socket.on(`status:${service.name}`, (status) => {
            service.status = status;

            if (service.status === "RUNNING") {
                service.logs = [];
                const el = getLogsElement(service);
                el.innerHTML = '';
            }

            // Update dot couleur sans tout re-render si possible
            const dot = document.getElementById(`dot-${service.name}`);
            const mainDot = document.getElementById(`status-${service.name}`);
            if (dot) dot.className = `w-2 h-2 rounded-full ${getStatusColor(status)}`;
            if (mainDot) mainDot.className = `w-4 h-4 rounded-full ${getStatusColor(status, true)}`;
        });
    });
}

function getStatusColor(status, withShadow = false) {
    if (status === "RUNNING") return `bg-green-500 ${withShadow ? 'shadow-[0_0_10px_green]' : ''}`;
    if (status === "CRASHED") return `bg-orange-500 ${withShadow ? 'shadow-[0_0_10px_orange]' : ''}`;
    return `bg-red-500 ${withShadow ? 'shadow-[0_0_10px_red]' : ''}`;
}

function switchTab(name) {
    activeService = name;
    renderUI();
}

// Initialisation
renderUI();

function restart(name) {
    socket.emit('restart-service', name);
}

function start(name) {
    socket.emit('start-service', name);
}

function stop(name) {
    socket.emit('stop-service', name);
}

function clearLogs(index) {
    services[index].logs = [];
    const el = getLogsElement(services[index]);
    el.innerHTML = '';
}