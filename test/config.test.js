const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, deriveSubstream, hostOf } = require('../config');

const MAIN = 'rtsp://u:p@192.168.1.68:554/Streaming/Channels/101';
const base = { TELEGRAM_BOT_TOKEN: '123:abc', ALLOWED_CHAT_ID: '42', CAM_RTSP_URL: MAIN, OWM_API_KEY: 'k' };

test('thieu TELEGRAM_BOT_TOKEN -> throw', () => {
  assert.throws(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '' }), /TELEGRAM_BOT_TOKEN/);
});

test('thieu ALLOWED_CHAT_ID -> throw', () => {
  const { ALLOWED_CHAT_ID, ...rest } = base;
  assert.throws(() => loadConfig(rest), /ALLOWED_CHAT_ID/);
});

test('ALLOWED_CHAT_ID khong phai so nguyen -> throw', () => {
  assert.throws(() => loadConfig({ ...base, ALLOWED_CHAT_ID: 'abc' }), /ALLOWED_CHAT_ID/);
});

test('gia tri hop le: API, CHAT_ID dang so, OWM_KEY', () => {
  const c = loadConfig(base);
  assert.equal(c.API, 'https://api.telegram.org/bot123:abc');
  assert.equal(c.CHAT_ID, 42);
  assert.equal(c.OWM_KEY, 'k');
});

test('CAM_HOST va CAM_MOTION_RTSP (sub-stream 102) suy ra tu URL chinh', () => {
  const c = loadConfig(base);
  assert.equal(c.CAM_RTSP, MAIN);
  assert.equal(c.CAM_HOST, '192.168.1.68');
  assert.equal(c.CAM_MOTION_RTSP, 'rtsp://u:p@192.168.1.68:554/Streaming/Channels/102');
});

test('CAM_MOTION_RTSP_URL ghi de gia tri suy ra', () => {
  const c = loadConfig({ ...base, CAM_MOTION_RTSP_URL: 'rtsp://x/y' });
  assert.equal(c.CAM_MOTION_RTSP, 'rtsp://x/y');
});

test('khong co camera -> cac truong CAM_* la null', () => {
  const { CAM_RTSP_URL, ...rest } = base;
  const c = loadConfig(rest);
  assert.equal(c.CAM_RTSP, null);
  assert.equal(c.CAM_MOTION_RTSP, null);
  assert.equal(c.CAM_HOST, null);
});

test('deriveSubstream: URL khong phai kenh 101 giu nguyen', () => {
  assert.equal(deriveSubstream('rtsp://h/other'), 'rtsp://h/other');
  assert.equal(deriveSubstream(null), null);
});

test('hostOf: co/khong userinfo, cong, va gia tri rac', () => {
  assert.equal(hostOf('rtsp://192.168.1.68:554/x'), '192.168.1.68');
  assert.equal(hostOf('rtsp://a:b@cam.local/x'), 'cam.local');
  assert.equal(hostOf('rtsp://a:p@ss@10.0.0.5:554/x'), '10.0.0.5');
  assert.equal(hostOf('khong-phai-url'), null);
  assert.equal(hostOf(undefined), null);
});

test('config tra ve object dong bang', () => {
  assert.ok(Object.isFrozen(loadConfig(base)));
});

test('KNOWN_DEVICES, MAIN_PC va broadcast duoc doc tu env', () => {
  const { parseDevices, broadcastOf, getLocation } = require('../config');
  assert.deepEqual(parseDevices('192.168.1.1=Router;192.168.1.5= NAS '), { '192.168.1.1': 'Router', '192.168.1.5': 'NAS' });
  assert.equal(broadcastOf('192.168.1.62'), '192.168.1.255');
  assert.equal(broadcastOf(undefined), '255.255.255.255');
  const c = loadConfig({ TELEGRAM_BOT_TOKEN: 't', ALLOWED_CHAT_ID: '1', MAIN_PC_IP: '10.0.0.7', MAIN_PC_MAC: 'AA:BB:CC:DD:EE:FF' });
  assert.equal(c.WOL_BROADCAST, '10.0.0.255');
  assert.equal(c.MAIN_PC_MAC, 'AA:BB:CC:DD:EE:FF');
  assert.deepEqual(getLocation({}), { name: 'Hà Nội', lat: 21.0278, lon: 105.8342 });
  assert.deepEqual(getLocation({ LOCATION_NAME: 'Huế', LOCATION_LAT: '16.46', LOCATION_LON: '107.59' }), { name: 'Huế', lat: 16.46, lon: 107.59 });
  assert.equal(getLocation({ LOCATION_LAT: 'abc', LOCATION_LON: '1' }).name, 'Hà Nội');
});
