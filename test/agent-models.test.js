const test = require('node:test');
const assert = require('node:assert/strict');
const { orderModels, bumpKind, formatKindUsage } = require('../lib/agent-models');

const C = ['pro', 'flash', 'preview', 'lite'];

test('orderModels: hoi dap bat dau tu model dang dung, xoay vong', () => {
  assert.deepEqual(orderModels({ candidates: C, currentModel: 'preview' }), ['preview', 'lite', 'pro', 'flash']);
});

test('orderModels: viec nen thu model nhe truoc, phan con lai giu thu tu xoay vong', () => {
  assert.deepEqual(
    orderModels({ candidates: C, currentModel: 'flash', kind: 'scheduled', backgroundModel: 'lite' }),
    ['lite', 'flash', 'preview', 'pro'],
  );
  assert.equal(orderModels({ candidates: C, currentModel: 'pro', kind: 'summary', backgroundModel: 'lite' })[0], 'lite');
});

test('orderModels: hoi dap khong bi anh huong boi backgroundModel', () => {
  assert.equal(orderModels({ candidates: C, currentModel: 'pro', kind: 'interactive', backgroundModel: 'lite' })[0], 'pro');
});

test('orderModels: backgroundModel ngoai chuoi model cua nguoi dung hoac de trong -> bo qua', () => {
  assert.equal(orderModels({ candidates: C, currentModel: 'pro', kind: 'scheduled', backgroundModel: 'khac' })[0], 'pro');
  assert.equal(orderModels({ candidates: C, currentModel: 'pro', kind: 'scheduled', backgroundModel: '' })[0], 'pro');
});

test('orderModels: loai model het quota; viec nen het quota model nhe thi sang model con lai', () => {
  assert.deepEqual(
    orderModels({ candidates: C, currentModel: 'pro', exhausted: ['lite', 'pro'], kind: 'scheduled', backgroundModel: 'lite' }),
    ['flash', 'preview'],
  );
});

test('orderModels: tat ca het quota -> van thu 1 model', () => {
  assert.deepEqual(orderModels({ candidates: C, currentModel: 'flash', exhausted: [...C] }), ['flash']);
});

test('bumpKind + formatKindUsage: dem luot goi / so viec theo loai', () => {
  let b = {};
  for (let i = 0; i < 5; i++) b = bumpKind(b, 'interactive', 'calls');
  b = bumpKind(b, 'interactive', 'tasks');
  b = bumpKind(b, 'interactive', 'tasks');
  b = bumpKind(b, 'scheduled', 'calls');
  b = bumpKind(b, 'loai-la', 'calls'); // loai la -> tinh vao hoi dap
  assert.deepEqual(b.interactive, { calls: 6, tasks: 2 });
  assert.deepEqual(b.scheduled, { calls: 1, tasks: 0 });
  const line = formatKindUsage(b);
  assert.match(line, /hỏi đáp: 6 lượt \/ 2 câu \(TB 3\.0\)/);
  assert.match(line, /hẹn giờ: 1 lượt/);
  assert.equal(formatKindUsage({}), '');
});
