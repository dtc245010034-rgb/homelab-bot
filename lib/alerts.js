const DEFAULT_THRESHOLDS = { cpuPct: 85, ramPct: 85, diskPct: 85, tempC: 78 };

function evaluateAlerts({ cpuPct, ramPct, diskPct, tempC }, th = DEFAULT_THRESHOLDS) {
  const out = [];
  if (cpuPct  > th.cpuPct)  out.push({ key: 'cpu',  text: `▸ CPU quá tải: <code>${cpuPct.toFixed(1)}%</code>` });
  if (ramPct  > th.ramPct)  out.push({ key: 'ram',  text: `▸ RAM quá tải: <code>${ramPct.toFixed(1)}%</code>` });
  if (diskPct > th.diskPct) out.push({ key: 'disk', text: `▸ Dung lượng ổ cứng sắp đầy: <code>${diskPct.toFixed(1)}%</code>` });
  if (tempC   > th.tempC)   out.push({ key: 'temp', text: `▸ Nhiệt độ CPU cao: <code>${tempC}°C</code>` });
  return out;
}

// Moi key chi duoc "ready" 1 lan moi `ms` - chong gui lap lai moi 5 phut khi dieu kien van dung.
function createCooldown(ms, nowFn = Date.now) {
  const last = new Map();
  return {
    ready(key) {
      const now = nowFn();
      const prev = last.get(key);
      if (prev !== undefined && now - prev < ms) return false;
      last.set(key, now);
      return true;
    },
  };
}

module.exports = { DEFAULT_THRESHOLDS, evaluateAlerts, createCooldown };
