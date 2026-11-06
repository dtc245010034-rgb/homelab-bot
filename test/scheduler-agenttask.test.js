const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createScheduler, USER_JOB_TYPES } = require('../scheduler');

const CHAT = 111;
const past = () => new Date(Date.now() - 60_000).toISOString();

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-test-'));
  const calls = { send: [], pin: [], unpin: [], agent: [], system: [] };
  const sched = createScheduler({
    dir,
    send: async (chatId, text) => { calls.send.push([chatId, text]); return 900 + calls.send.length; },
    pinMessage: async (c, m) => { calls.pin.push([c, m]); },
    unpinMessage: async (c, m) => { calls.unpin.push([c, m]); },
    systemActions: { weeklyReport: async () => { calls.system.push('weeklyReport'); } },
    runAgentTask: async (job) => { calls.agent.push(job.id); },
    ...extra,
  });
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'));
  const write = (jobs) => fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  return { dir, calls, sched, read, write };
}

const daily = { kind: 'daily', hour: 10, minute: 0 };
const agentJob = (o = {}) => ({ id: 'ag1', chatId: CHAT, type: 'agentTask', message: 'Tin AI', prompt: 'tim tin AI', schedule: daily, nextFireAt: past(), active: true, ...o });
const msgJob = (o = {}) => ({ id: 'm1', chatId: CHAT, type: 'message', message: 'Nhac lich', schedule: { kind: 'once', atISO: past() }, nextFireAt: past(), active: true, ...o });

test('agentTask den gio: chay agent, KHONG gui chu thang va KHONG ghim', async () => {
  const { calls, sched, write, read } = setup();
  write([agentJob()]);
  await sched.tick();
  assert.deepEqual(calls.agent, ['ag1']);
  assert.deepEqual(calls.send, []);
  assert.deepEqual(calls.pin, []);
  const j = read()[0];
  assert.ok(j.lastFiredAt);
  assert.ok(new Date(j.nextFireAt) > new Date()); // da hen lan ke tiep
  assert.equal(j.active, true); // daily van song
});

test('HOI QUY: nhac lich kieu message van gui + ghim, bo ghim tin cu', async () => {
  const { dir, calls, sched, write } = setup();
  fs.writeFileSync(path.join(dir, 'pin-state.json'), JSON.stringify({ chatId: CHAT, messageId: 555 }));
  write([msgJob()]);
  await sched.tick();
  assert.deepEqual(calls.send, [[CHAT, 'Nhac lich']]);
  assert.deepEqual(calls.unpin, [[CHAT, 555]]);
  assert.deepEqual(calls.pin, [[CHAT, 901]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pin-state.json'), 'utf8')), { chatId: CHAT, messageId: 901 });
});

test('agentTask chay xen voi message: agentTask KHONG dung vao pin-state cua nhac lich', async () => {
  const { dir, calls, sched, write } = setup();
  fs.writeFileSync(path.join(dir, 'pin-state.json'), JSON.stringify({ chatId: CHAT, messageId: 555 }));
  write([agentJob()]);
  await sched.tick();
  assert.deepEqual(calls.unpin, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pin-state.json'), 'utf8')), { chatId: CHAT, messageId: 555 });
});

test('agentTask loi: khong ghi lastFiredAt nhung van hen lan sau (khong lap vo han)', async () => {
  const { sched, write, read } = setup({ runAgentTask: async () => { throw new Error('het quota'); } });
  const origErr = console.error; console.error = () => {};
  write([agentJob()]);
  try { await sched.tick(); } finally { console.error = origErr; }
  const j = read()[0];
  assert.equal(j.lastFiredAt, undefined);
  assert.ok(new Date(j.nextFireAt) > new Date());
});

test('agentTask chay lau hon 1 tick: tick thu hai KHONG ban lai job dang chay', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { calls, sched, write } = setup({ runAgentTask: async (job) => { calls.agent.push(job.id); await gate; } });
  write([agentJob()]);
  const first = sched.tick();
  await new Promise(r => setImmediate(r));
  await sched.tick(); // tick thu hai trong luc job 1 van chay
  release();
  await first;
  assert.deepEqual(calls.agent, ['ag1']);
});

test('chua cau hinh runAgentTask -> job loi, khong crash', async () => {
  const { sched, write, read } = setup({ runAgentTask: undefined });
  const origErr = console.error; console.error = () => {};
  write([agentJob()]);
  try { await sched.tick(); } finally { console.error = origErr; }
  assert.equal(read()[0].lastFiredAt, undefined);
});

test('addJob luu prompt cho agentTask; message khong co field prompt', () => {
  const { sched, read } = setup();
  const a = sched.addJob({ chatId: CHAT, type: 'agentTask', message: 'Tin AI', prompt: 'tim tin AI', schedule: daily });
  const m = sched.addJob({ chatId: CHAT, type: 'message', message: 'hi', schedule: daily });
  const jobs = read();
  assert.equal(jobs.find(j => j.id === a.id).prompt, 'tim tin AI');
  assert.equal('prompt' in jobs.find(j => j.id === m.id), false);
});

test('listJobs/cancelJob thay ca agentTask cua minh, khong thay job system hay cua chat khac', () => {
  const { sched, write, read } = setup();
  write([
    agentJob(), msgJob({ id: 'm1', schedule: daily }),
    agentJob({ id: 'other', chatId: 999 }),
    { id: 'sys1', chatId: null, type: 'system', action: 'weeklyReport', schedule: daily, nextFireAt: past(), active: true },
  ]);
  assert.deepEqual(sched.listJobs(CHAT).map(j => j.id).sort(), ['ag1', 'm1']);
  assert.equal(sched.cancelJob('ag1'), true);
  assert.equal(read().find(j => j.id === 'ag1').active, false);
  assert.equal(sched.cancelJob('sys1'), false); // job he thong khong huy duoc qua agent
  assert.equal(read().find(j => j.id === 'sys1').active, true);
});

test('USER_JOB_TYPES chi gom message va agentTask', () => {
  assert.deepEqual([...USER_JOB_TYPES].sort(), ['agentTask', 'message']);
});
