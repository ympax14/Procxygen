import fs from "fs";
import { pathToFileURL } from "url";
import path from "path";

process.on('message', (msg) => {
    if (msg.action === 'STOP') {
        console.log(`[WRAPPER] Arrêt ordonné avec le code : ${msg.code}`);
        process.exit(msg.code);
    }
});

function execute(targetScript) {
    if (!targetScript) return;

    import(pathToFileURL(targetScript).href).catch(err => {
        console.error(`[WRAPPER-ERROR] Failed loading script : ${targetScript}`);
        console.error(err);
        process.exit(1);
    });
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) console.log(err);
        });
        return true;
    } catch(err) {
        console.error(err);
        return false;
    }
}

function main() {
    if (process.argv.length === 0) {
        console.error('[WRAPPER-ERROR] No script path given !');
        process.exit(1);
    }

    const scriptPath = path.resolve(process.cwd(), process.argv[2]);

    fileExists(scriptPath).then((exists) => {
        if (exists) {
            console.log('[WRAPPER-SUCCESS] Script found ! Starting...');
            execute(scriptPath);
        } else {
            console.error('[WRAPPER-ERROR] Given script path is invalid !', scriptPath);
            process.exit(1);
        }
    });
}

main();