module.exports = {
  apps: [
    {
      name: "sramap-frontend",
      script: "server.js",
      cwd: "/var/www/sramap/current",
      instances: 2,
      exec_mode: "cluster",
      listen_timeout: 10000,
      kill_timeout: 5000,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        HOSTNAME: "127.0.0.1",
      },
    },
  ],
};
