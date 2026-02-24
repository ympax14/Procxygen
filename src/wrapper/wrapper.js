import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

let childCmd = null;

process.on('message', (msg) => {
    if (msg.action === 'STOP') {
        console.log(`[WRAPPER] Signal d'arrêt reçu.`);
        if (childCmd) {
            const pid = childCmd.pid;
            // On utilise spawnSync ou on gère la sortie immédiatement après l'appel
            if (process.platform === "win32") {
                // Utilisation de execSync pour bloquer juste le temps du kill
                try {
                    execSync(`taskkill /pid ${pid} /T /F`);
                } catch (e) {
                    // Si déjà fermé, on ignore l'erreur
                }
            } else {
                childCmd.kill('SIGKILL');
            }
        }
        
        process.exit(88);
    }
});

async function main() {
    const target = process.argv[2];
    const args = process.argv.slice(3);

    const scriptPath = path.resolve(process.cwd(), target);

    if (fs.existsSync(scriptPath) && fs.lstatSync(scriptPath).isFile()) {
        // CAS NODE : Import dynamique
        await import(pathToFileURL(scriptPath).href);
    } else {
        // CAS COMMANDE EXTERNE (npm, etc.)
        // Sur Windows, 'npm' doit souvent être 'npm.cmd' si shell: false
        const cmd = (process.platform === "win32" && target === "npm") ? "npm.cmd" : target;

        childCmd = spawn(cmd, args, {
            stdio: 'inherit', // Les logs vont dans le pipe du Wrapper (lu par Procxygen)
            shell: true // Ici le shell est OK car le Wrapper est le parent direct
        });

        childCmd.on('close', (code) => process.exit(code));
    }
}

main();