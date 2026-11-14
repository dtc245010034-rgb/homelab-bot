// pm2 start ecosystem.config.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Ten tien trinh doi duoc bang PM2_APP_NAME trong .env (vd dog-bot). max_memory_restart: bot bi ro RAM thi PM2 khoi dong lai thay vi de may het RAM.
const common = { cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, max_memory_restart: '300M', time: true };

module.exports = {
  apps: [
    { name: process.env.PM2_APP_NAME || 'homelab-bot', script: 'bot.js', ...common },
    // Chi chay tien trinh do chuyen dong khi da cau hinh camera
    ...(process.env.CAM_RTSP_URL ? [{ name: 'motion-check', script: 'motion-check.js', ...common }] : []),
  ],
};
