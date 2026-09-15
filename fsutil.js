const fs = require('fs');

function ensureDirs(dirs) {
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}

// Khong tu ensureDirs - caller tu chiu trach nhiem dam bao thu muc cha ton tai truoc khi goi.
function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

module.exports = { ensureDirs, writeJsonAtomic, readJsonSafe };
