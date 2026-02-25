const config = {
    port: 3000, // Port de l'interface web
    services: [
        {
            name: "DUMMY-PROCESS-1",
            run: {
                exec: "node",
                args: ["./scripts/process1.js"],
                env: {}
            },
            color: "#5865F2",
            devOnly: true
        },
        {
            name: "DUMMY-PROCESS-2",
            run: {
                exec: "node",
                args: ["./scripts/process2.js"],
                env: {}
            },
            color: "#3b82f6",
            devOnly: true,
        }
    ]
};

export default config;