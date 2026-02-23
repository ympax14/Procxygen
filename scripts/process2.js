let infoCounts = 1;
let errorCounts = 1;

setInterval(() => console.log('Process2 Heartbeat', infoCounts++), 2000);
setInterval(() => console.error('Process2 Error', errorCounts++), 2000);