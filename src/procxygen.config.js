export const config = {
    port: 3000, // Port de l'interface web
    max_logs: 100,
    services: [
        {
            name: "BOT-DISCORD",
            run: {
                exec: "node",
                args: ["./backend/discord/bot.js"],
                env: {}
            },
            color: "#5865F2",
            devOnly: false
        },
        {
            name: "BACKEND",
            run: {
                exec: "node",
                args: ["./backend/server.js"],
                env: {}
            },
            color: "#3b82f6",
            devOnly: false,
        },
        {
            name: "FRONTEND",
            run: {
                exec: "node",
                args: ["npm", "run", "dev"],
                env: {}
            },
            color: "#3b82f6",
            devOnly: false
        }
    ]
};