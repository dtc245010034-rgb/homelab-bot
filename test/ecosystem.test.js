const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (env) => {
  const keys = ['PM2_APP_NAME', 'CAM_RTSP_URL'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const file = path.join(__dirname, '..', 'ecosystem.config.js');
  delete require.cache[require.resolve(file)];
  try { return require(file); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test('ecosystem: ten tien trinh bot lay tu PM2_APP_NAME, mac dinh homelab-bot', () => {
  assert.equal(load({}).apps[0].name, 'homelab-bot');
  assert.equal(load({ PM2_APP_NAME: 'dog-bot' }).apps[0].name, 'dog-bot');
});

test('ecosystem: co tran RAM tu khoi dong lai (max_memory_restart) va gioi han khoi dong lai lien tuc', () => {
  const app = load({}).apps[0];
  assert.equal(app.max_memory_restart, '300M');
  assert.equal(app.max_restarts, 20);
});

test('ecosystem: chi them motion-check khi co CAM_RTSP_URL', () => {
  assert.equal(load({}).apps.length, 1);
  const withCam = load({ CAM_RTSP_URL: 'rtsp://x' }).apps;
  assert.deepEqual(withCam.map(a => a.name), ['homelab-bot', 'motion-check']);
});
