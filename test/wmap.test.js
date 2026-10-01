const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { compositeArgs, appendArgs, finalArgs, convert } = require('../wmap');

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
