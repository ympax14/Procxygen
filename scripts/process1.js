let infoCounts = 1;
let errorCounts = 1;

setInterval(() => console.log('Process1 Heartbeat', infoCounts++), 2000);
setInterval(() => console.error('Process1 Error', errorCounts++), 2000);