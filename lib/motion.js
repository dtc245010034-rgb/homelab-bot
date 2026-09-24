// ImageMagick Q16: `compare -metric RMSE` in "<gia tri> (<chuan hoa 0..1>)" ra stderr. Nhan 65535 de
// giu nguyen thang nguong 6000 da hieu chinh tu truoc.
function parseRmse(stderr) {
  const m = /\(([\d.]+(?:e-?\d+)?)\)/i.exec(String(stderr ?? ''));
  return m ? parseFloat(m[1]) * 65535 : null;
}

function shouldAlert({ rmse, threshold, lastAlertAt, now, cooldownMs }) {
  if (rmse == null || !(rmse > threshold)) return false;
  return now - (lastAlertAt || 0) > cooldownMs;
}

// Bao "down" 1 lan khi that bai lien tiep >= failThreshold, bao "up" 1 lan khi ket noi lai.
function createHealthTracker({ failThreshold = 3 } = {}) {
  let fails = 0;
  let down = false;
  return {
    recordSuccess() {
      fails = 0;
      if (down) { down = false; return 'up'; }
      return null;
    },
    recordFailure() {
      fails++;
      if (!down && fails >= failThreshold) { down = true; return 'down'; }
      return null;
    },
    get isDown() { return down; },
  };
}

module.exports = { parseRmse, shouldAlert, createHealthTracker };
