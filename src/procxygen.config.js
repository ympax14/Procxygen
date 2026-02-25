const config = {
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
            color: "#a12bfb",
            devOnly: false
        },
        {
            name: "BACKEND",
            run: {
                exec: "node",
                args: ["./backend/server.js"],
                env: {}
            },
            color: "#fb312b",
            devOnly: false,
        },
        {
            name: "FRONTEND",
            run: {
                exec: "npm",
                args: ["run", "dev"],
                env: {}
            },
            color: "#2b69fb",
            devOnly: false
        }
    ]
};

export default config;