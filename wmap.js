// wmap.js — Dog.Bot v2: weather map generator (OWM tiles + ImageMagick)
// Đặt file này cùng thư mục với bot.js (~/uptime-kuma/wmap.js)
// Yêu cầu: ImageMagick (`convert`) đã có sẵn trên máy (đang dùng cho motion-check.js)
// API key OWM được truyền vào từ bot.js (tham số thứ 3 của generateWeatherMap),
// không đọc từ env — khớp với cách bot.js hardcode OWM key trong handleWeekly().

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const LAYERS = {
  rain: 'precipitation_new',
  clouds: 'clouds_new',
  wind: 'wind_new',
  temp: 'temp_new',
};

// [lonMin, latMin, lonMax, latMax] — phủ toàn VN + Biển Đông
const PRESETS = {
  vn: { bbox: [100, 5, 120, 24], zoom: 5, label: 'Việt Nam + Biển Đông' },
  tn: { center: [21.5928, 105.8442], zoom: 9, radius: 1, label: 'Thái Nguyên' },
};

const THAI_NGUYEN = [21.5928, 105.8442];

function lon2tileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2tileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}
function latLonToPixel(lat, lon, z) {
  const scale = 256 * Math.pow(2, z);
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function buildTileGrid(x1, x2, y1, y2, zoom, layerCode, tmpDir, apiKey) {
  const rowFiles = [];
  for (let y = y1; y <= y2; y++) {
    const rowTiles = [];
    for (let x = x1; x <= x2; x++) {
      const baseFile = path.join(tmpDir, `base_${x}_${y}.png`);
      const overlayFile = path.join(tmpDir, `ov_${x}_${y}.png`);
      const outFile = path.join(tmpDir, `tile_${x}_${y}.png`);
      const baseUrl = `https://basemaps.cartocdn.com/light_all/${zoom}/${x}/${y}.png`;
      const overlayUrl = `https://tile.openweathermap.org/map/${layerCode}/${zoom}/${x}/${y}.png?appid=${apiKey}`;

      await download(baseUrl, baseFile);

      let hasOverlay = true;
      try {
        await download(overlayUrl, overlayFile);
      } catch (e) {
        hasOverlay = false; // vùng không có dữ liệu overlay (OWM free tile không phủ hết) -> dùng nền trơn
      }

      if (hasOverlay) {
        execSync(
          `convert "${baseFile}" "${overlayFile}" -compose dissolve -define compose:args=65 -composite "${outFile}"`
        );
      } else {
        fs.copyFileSync(baseFile, outFile);
      }
      rowTiles.push(outFile);
    }
    const rowFile = path.join(tmpDir, `row_${y}.png`);
    execSync(`convert ${rowTiles.map((f) => `"${f}"`).join(' ')} +append "${rowFile}"`);
    rowFiles.push(rowFile);
  }
  const gridFile = path.join(tmpDir, 'grid.png');
  execSync(`convert ${rowFiles.map((f) => `"${f}"`).join(' ')} -append "${gridFile}"`);
  return gridFile;
}

// presetKey: 'vn' | 'tn'   layerKey: 'rain' | 'clouds' | 'wind' | 'temp'
// Trả về đường dẫn ảnh PNG cuối cùng (nằm ngoài thư mục tạm, caller tự unlink sau khi gửi)
async function generateWeatherMap(presetKey = 'vn', layerKey = 'rain', apiKey) {
  if (!apiKey) throw new Error('Thiếu OWM API key (tham số thứ 3 của generateWeatherMap)');
  const preset = PRESETS[presetKey];
  const layerCode = LAYERS[layerKey];
  if (!preset) throw new Error(`Preset không hợp lệ: ${presetKey}`);
  if (!layerCode) throw new Error(`Layer không hợp lệ: ${layerKey}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmap-'));

  try {
    let x1, x2, y1, y2, zoom, markerLatLon;

    if (preset.bbox) {
      zoom = preset.zoom;
      const [lonMin, latMin, lonMax, latMax] = preset.bbox;
      x1 = lon2tileX(lonMin, zoom);
      x2 = lon2tileX(lonMax, zoom);
      y1 = lat2tileY(latMax, zoom); // vĩ độ lớn hơn -> tile y nhỏ hơn
      y2 = lat2tileY(latMin, zoom);
      markerLatLon = THAI_NGUYEN;
    } else {
      zoom = preset.zoom;
      const [lat, lon] = preset.center;
      const cx = lon2tileX(lon, zoom);
      const cy = lat2tileY(lat, zoom);
      x1 = cx - preset.radius;
      x2 = cx + preset.radius;
      y1 = cy - preset.radius;
      y2 = cy + preset.radius;
      markerLatLon = preset.center;
    }

    console.log(`[wmap] preset=${presetKey} layer=${layerKey} zoom=${zoom} tiles=${x2 - x1 + 1}x${y2 - y1 + 1} bounds=(${x1},${y1})-(${x2},${y2})`);

    const gridFile = await buildTileGrid(x1, x2, y1, y2, zoom, layerCode, tmpDir, apiKey);

    const originPx = { x: x1 * 256, y: y1 * 256 };
    const markerPx = latLonToPixel(markerLatLon[0], markerLatLon[1], zoom);
    const mx = Math.round(markerPx.x - originPx.x);
    const my = Math.round(markerPx.y - originPx.y);

    const caption = `${preset.label} - ${layerKey.toUpperCase()} - ${new Date().toLocaleString(
      'vi-VN',
      { timeZone: 'Asia/Ho_Chi_Minh' }
    )}`;
    const finalFile = path.join(tmpDir, 'final.png');
    execSync(
      `convert "${gridFile}" ` +
        `-fill red -stroke white -strokewidth 1 -draw "circle ${mx},${my} ${mx + 6},${my}" ` +
        `-gravity NorthEast -pointsize 13 -stroke none -fill white -undercolor "#00000090" -annotate +6+6 " Dog.Bot " ` +
        `-gravity South -background "#00000090" -splice 0x32 -pointsize 15 -fill white ` +
        `-annotate +0+9 "${caption.replace(/"/g, "'")}" "${finalFile}"`
    );

    const outputFile = path.join(os.tmpdir(), `wmap_${presetKey}_${layerKey}_${Date.now()}.png`);
    fs.copyFileSync(finalFile, outputFile);
    return outputFile;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { generateWeatherMap, PRESETS, LAYERS };
