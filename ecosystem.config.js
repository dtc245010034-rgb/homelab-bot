// pm2 start ecosystem.config.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const common = { cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, time: true };

module.exports = {
  apps: [
    { name: 'homelab-bot', script: 'bot.js', ...common },
    // Chi chay tien trinh do chuyen dong khi da cau hinh camera
    ...(process.env.CAM_RTSP_URL ? [{ name: 'motion-check', script: 'motion-check.js', ...common }] : []),
  ],
};
