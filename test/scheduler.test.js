const test = require('node:test');
const assert = require('node:assert/strict');
const { computeNextFireAt, SYSTEM_SEEDS, reconcileSeeds } = require('../scheduler');

const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi, 0, 0); // gio local, khong phu thuoc TZ may

test('daily: gio chua toi -> hom nay', () => {
  const r = computeNextFireAt({ kind: 'daily', hour: 8, minute: 0 }, at(2026, 9, 24, 7, 0));
  assert.equal(+r, +at(2026, 9, 24, 8, 0));
});

test('daily: gio da qua -> ngay mai', () => {
  const r = computeNextFireAt({ kind: 'daily', hour: 8, minute: 0 }, at(2026, 9, 24, 9, 0));
  assert.equal(+r, +at(2026, 9, 25, 8, 0));
});

test('daily: dung gio -> ngay mai (khong ban lai chinh thoi diem nay)', () => {
  const r = computeNextFireAt({ kind: 'daily', hour: 8, minute: 0 }, at(2026, 9, 24, 8, 0));
  assert.equal(+r, +at(2026, 9, 25, 8, 0));
});

test('weekly: cung thu nhung da qua gio -> +7 ngay (24/09/2026 la thu Nam)', () => {
  const r = computeNextFireAt({ kind: 'weekly', dayOfWeek: 4, hour: 8, minute: 0 }, at(2026, 9, 24, 10, 0));
  assert.equal(+r, +at(2026, 10, 1, 8, 0));
});

test('weekly: tu thu Nam toi thu Hai 08:00 -> 28/09', () => {
  const r = computeNextFireAt({ kind: 'weekly', dayOfWeek: 1, hour: 8, minute: 0 }, at(2026, 9, 24, 10, 0));
  assert.equal(+r, +at(2026, 9, 28, 8, 0));
});

test('once: tra dung atISO', () => {
  const r = computeNextFireAt({ kind: 'once', atISO: '2026-09-25T06:00:00+07:00' }, at(2026, 9, 24, 10, 0));
  assert.equal(r.toISOString(), '2026-09-24T23:00:00.000Z');
});

test('kind la -> throw', () => {
  assert.throws(() => computeNextFireAt({ kind: 'monthly' }, new Date()), /Unknown schedule.kind/);
});

test('SYSTEM_SEEDS: weeklyReport thu Hai 08:00, dailyScheduleDigest 06:30, khong trung action', () => {
  const w = SYSTEM_SEEDS.find(s => s.action === 'weeklyReport');
  assert.deepEqual(w.schedule, { kind: 'weekly', dayOfWeek: 1, hour: 8, minute: 0 });
  const d = SYSTEM_SEEDS.find(s => s.action === 'dailyScheduleDigest');
  assert.deepEqual(d.schedule, { kind: 'daily', hour: 6, minute: 30 });
  const actions = SYSTEM_SEEDS.map(s => s.action);
  assert.equal(new Set(actions).size, actions.length);
});

const NOW = at(2026, 9, 24, 10, 0);
const seedA = { action: 'a', schedule: { kind: 'daily', hour: 6, minute: 30 } };

test('reconcileSeeds: them seed con thieu, nextFireAt tinh tu now', () => {
  const { jobs, changed } = reconcileSeeds([], [seedA], NOW);
  assert.equal(changed, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, 'system');
  assert.equal(jobs[0].active, true);
  assert.equal(jobs[0].nextFireAt, at(2026, 9, 25, 6, 30).toISOString());
});

test('reconcileSeeds: seed da co cung lich -> khong doi gi', () => {
  const existing = [{ id: 'x1', type: 'system', action: 'a', schedule: { kind: 'daily', hour: 6, minute: 30 }, nextFireAt: 'giu-nguyen', active: true }];
  const { jobs, changed } = reconcileSeeds(existing, [seedA], NOW);
  assert.equal(changed, false);
  assert.equal(jobs[0].nextFireAt, 'giu-nguyen');
});

test('reconcileSeeds: seed da co nhung lich khac -> cap nhat lich + nextFireAt, giu nguyen id', () => {
  const existing = [{ id: 'x1', type: 'system', action: 'a', schedule: { kind: 'daily', hour: 0, minute: 1 }, nextFireAt: 'cu', active: true }];
  const { jobs, changed } = reconcileSeeds(existing, [seedA], NOW);
  assert.equal(changed, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'x1');
  assert.deepEqual(jobs[0].schedule, { kind: 'daily', hour: 6, minute: 30 });
  assert.equal(jobs[0].nextFireAt, at(2026, 9, 25, 6, 30).toISOString());
});

test('reconcileSeeds: khong dung vao job nhac viec cua user (type message)', () => {
  const msg = { id: 'm1', type: 'message', action: 'a', schedule: { kind: 'once', atISO: '2026-09-25T06:00:00+07:00' }, active: true };
  const { jobs } = reconcileSeeds([msg], [seedA], NOW);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.find(j => j.id === 'm1'), msg);
});

test('reconcileSeeds: khong sua mang dau vao', () => {
  const existing = [{ id: 'x1', type: 'system', action: 'a', schedule: { kind: 'daily', hour: 0, minute: 1 }, nextFireAt: 'cu', active: true }];
  reconcileSeeds(existing, [seedA], NOW);
  assert.equal(existing[0].nextFireAt, 'cu');
  assert.equal(existing[0].schedule.hour, 0);
});
