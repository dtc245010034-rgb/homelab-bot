const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compositeArgs, appendArgs, finalArgs, convert, baseTileUrl, labelTileUrl } = require('../wmap');

test('appendArgs: giữ nguyên đường dẫn có khoảng trắng/ký tự đặc biệt như một tham số', () => {
  const f = ['/tmp/a b.png', '/tmp/$(x).png'];
  assert.deepEqual(appendArgs(f, '+append', '/tmp/o.png'), [...f, '+append', '/tmp/o.png']);
});

test('compositeArgs: đúng thứ tự base, overlay, out', () => {
  const a = compositeArgs('b.png', 'o.png', 'out.png');
  assert.equal(a[0], 'b.png');
  assert.equal(a[1], 'o.png');
  assert.equal(a[a.length - 1], 'out.png');
  assert.ok(a.includes('-composite'));
});

test('finalArgs: caption có dấu nháy kép nằm nguyên trong một tham số, không bị shell diễn giải', () => {
  const caption = 'TN "mưa" $(rm -rf /) `x`';
  const a = finalArgs('g.png', 10, 20, caption, 'f.png');
  assert.equal(a.filter((x) => x === caption).length, 1);
  assert.ok(a.includes('circle 10,20 16,20'));
  assert.equal(a[a.length - 1], 'f.png');
});

let hasConvert = true;
try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); } catch { hasConvert = false; }

test('tích hợp: ghép và chú thích ảnh thật bằng convert, không chặn event loop', { skip: !hasConvert }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmap-test-'));
  try {
    const mk = (n, c) => { const f = path.join(dir, n); execFileSync('convert', ['-size', '32x32', `xc:${c}`, f]); return f; };
    const a = mk('a b.png', 'red'), b = mk('b.png', 'blue');
    const row = path.join(dir, 'row.png');
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await convert(appendArgs([a, b], '+append', row));
    const fin = path.join(dir, 'final.png');
    await convert(finalArgs(row, 8, 8, 'TN "mưa" $(id)', fin));
    clearInterval(timer);
    assert.ok(fs.statSync(fin).size > 0);
    assert.match(execFileSync('identify', ['-format', '%w', row]).toString(), /^64$/);
    assert.ok(ticks > 0, 'event loop phải còn chạy trong lúc convert');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('baseTileUrl/labelTileUrl: Esri, thu tu z/y/x, khong con carto', () => {
  assert.equal(baseTileUrl(5, 25, 14), 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/5/14/25');
  assert.match(labelTileUrl(9, 406, 224), /World_Light_Gray_Reference\/MapServer\/tile\/9\/224\/406$/);
  assert.ok(!/carto/.test(baseTileUrl(1, 1, 1)));
});

test('finalArgs: dung font co dau tieng Viet va +repage', () => {
  const a = finalArgs('g.png', 1, 1, 'Thái Nguyên', 'f.png');
  assert.ok(a.includes('+repage'));
  assert.equal(a[a.indexOf('-font') + 1], 'DejaVu-Sans');
});

test('tích hợp: chú thích nằm ở thanh dưới khi ảnh mang canvas ảo nhỏ hơn ảnh thật (lỗi cũ: chữ nằm giữa ảnh)', { skip: !hasConvert }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmap-test-'));
  try {
    const grid = path.join(dir, 'grid.png');
    execFileSync('convert', ['-size', '300x200', 'xc:black', '-page', '100x100+0+0', grid]);
    const fin = path.join(dir, 'final.png');
    await convert(finalArgs(grid, 150, 100, 'Thái Nguyên - RAIN', fin));
    assert.equal(execFileSync('identify', ['-format', '%h', fin]).toString(), '232');
    const maxWhite = (geom) => parseFloat(execFileSync('convert', [fin, '-crop', geom, '+repage', '-colorspace', 'Gray', '-format', '%[fx:maxima]', 'info:']).toString());
    assert.ok(maxWhite('300x32+0+200') > 0.9, 'thanh dưới phải có chữ trắng');
    assert.ok(maxWhite('300x60+0+130') < 0.1, 'giữa ảnh không được có chữ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
