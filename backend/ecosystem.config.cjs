// PM2 process config for the MOD-U-GO backend on the Hostinger Cloud VPS.
//
// FORK MODE IS DELIBERATE. A single Node instance keeps express-rate-limit's
// in-memory per-user counters correct. Cluster mode would multiply every
// student's limit by the number of workers (each worker has its own memory).
// See backend/middleware/rateLimiter.js before ever changing to cluster mode.
//
// Install & enable on boot:
//   cd /var/www/modugo/backend
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save
//   pm2 startup systemd -u <vps-user> --hp /home/<vps-user>   # then run the printed command
//
// Useful: pm2 logs modugo-api | pm2 monit | pm2 restart modugo-api

module.exports = {
  apps: [
    {
      name: "modugo-api",
      cwd: __dirname,
      script: "server.js",
      exec_mode: "fork",          // single instance — see note above
      instances: 1,
      autorestart: true,
      max_memory_restart: "768M", // VPS safety net; tune to plan RAM
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        // TRUST_PROXY=1 because Nginx runs on the same box (one proxy hop).
        TRUST_PROXY: "1",
      },
      out_file: "/var/log/modugo/pm2-out.log",
      error_file: "/var/log/modugo/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
