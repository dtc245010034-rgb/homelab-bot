const axios = require('axios');
const fs    = require('fs');
const os    = require('os');

const PIHOLE_SECRET = os.homedir() + '/homelab-bot/.pihole-secret';
const LOG_FILE      = os.homedir() + '/homelab-bot/pihole-weekly.json';

async function saveDailySnapshot() {
  try {
    const pass    = fs.readFileSync(PIHOLE_SECRET, 'utf8').trim();
    const authRes = await axios.post('http://localhost/api/auth', { password: pass });
    const sid     = authRes.data?.session?.sid;
    const { data } = await axios.get('http://localhost/api/stats/summary', {
      headers: { 'sid': sid }
    });
    axios.delete('http://localhost/api/auth', { headers: { 'sid': sid } }).catch(() => {});

    const today   = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const blocked = (data.queries?.status?.GRAVITY ?? 0) + (data.queries?.status?.GRAVITY_CNAME ?? 0);
    const entry   = {
      date    : today,
      total   : data.queries?.total ?? 0,
      blocked : blocked,
      clients : data.clients?.active ?? 0
    };

    let log = [];
    try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
    // Giữ 7 ngày gần nhất
    log = log.filter(x => x.date !== today);
    log.push(entry);
    if (log.length > 7) log = log.slice(-7);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    console.log('[pihole-log] Saved:', entry);
  } catch (e) { console.error('[pihole-log]', e.message); }
}

saveDailySnapshot();
