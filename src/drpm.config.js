export const config = {
    port: 3000, // Port de l'interface web
    services: [
        {
            name: "BOT-DISCORD",
            script: "./scripts/process1.js",
            color: "#5865F2",
            env: { DEBUG: "bot:*" }
        },
        {
            name: "BACKEND-API",
            script: "./scripts/process2.js",
            color: "#3b82f6",
            env: { PORT: 5000, DB_URL: "..." }
        }
    ]
};