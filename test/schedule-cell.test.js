const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitCell, joinCell, findLine, removeLine, replaceLine, addLineUnique, ScheduleCellError,
} = require('../lib/schedule-cell');

const CELL = '8:00 - Học CodeGym\n10h - Đi gym\n\n 13h30 - Họp nhóm ';

test('splitCell: bo dong trong, cat khoang trang, chap nhan o rong/null', () => {
  assert.deepEqual(splitCell(CELL), ['8:00 - Học CodeGym', '10h - Đi gym', '13h30 - Họp nhóm']);
  assert.deepEqual(splitCell(''), []);
  assert.deepEqual(splitCell(null), []);
  assert.deepEqual(splitCell(undefined), []);
});

test('joinCell: noi lai bang xuong dong, rong -> chuoi rong', () => {
  assert.equal(joinCell(['a', 'b']), 'a\nb');
  assert.equal(joinCell([]), '');
});

test('findLine: khop chuoi con khong phan biet hoa thuong va dau', () => {
  const lines = splitCell(CELL);
  assert.equal(findLine(lines, 'codegym').index, 0);
  assert.equal(findLine(lines, 'DI GYM').index, 1);
  assert.equal(findLine(lines, 'hop nhom').line, '13h30 - Họp nhóm');
});

test('findLine: chu d/Đ cung duoc coi nhu d', () => {
  assert.equal(findLine(['9h - Đi chợ'], 'di cho').index, 0);
});

test('findLine: khong khop -> loi not-found kem danh sach dong hien co', () => {
  const lines = splitCell(CELL);
  assert.throws(() => findLine(lines, 'bơi'), (e) =>
    e instanceof ScheduleCellError && e.code === 'not-found' &&
    e.lines.length === 3 && e.message.includes('Đi gym'));
});

test('findLine: khop nhieu dong -> loi ambiguous', () => {
  const lines = ['8h - Học bài', '14h - Học nhóm'];
  assert.throws(() => findLine(lines, 'học'), (e) => e.code === 'ambiguous' && e.lines.length === 2);
});

test('findLine: khong co match va o chi co 1 dong -> chon dong do', () => {
  assert.equal(findLine(['8h - Một việc']).index, 0);
  assert.equal(findLine(['8h - Một việc'], '   ').index, 0);
});

test('findLine: khong co match ma o co nhieu dong -> loi need-match', () => {
  assert.throws(() => findLine(splitCell(CELL)), (e) => e.code === 'need-match');
});

test('findLine: o rong -> loi empty', () => {
  assert.throws(() => findLine([], 'gym'), (e) => e.code === 'empty');
  assert.throws(() => findLine([]), (e) => e.code === 'empty');
});

test('removeLine: chi bo dung 1 dong, giu nguyen cac dong con lai va khong sua mang goc', () => {
  const lines = splitCell(CELL);
  const r = removeLine(lines, 'đi gym');
  assert.equal(r.removed, '10h - Đi gym');
  assert.deepEqual(r.lines, ['8:00 - Học CodeGym', '13h30 - Họp nhóm']);
  assert.equal(lines.length, 3);
});

test('removeLine: o 1 dong, bo match -> o thanh rong', () => {
  assert.deepEqual(removeLine(['8h - Một việc']).lines, []);
});

test('replaceLine: thay dung dong khop, tra ve dong cu', () => {
  const r = replaceLine(splitCell(CELL), 'đi gym', '11h - Đi bơi');
  assert.equal(r.old, '10h - Đi gym');
  assert.deepEqual(r.lines, ['8:00 - Học CodeGym', '11h - Đi bơi', '13h30 - Họp nhóm']);
});

test('replaceLine: khong khop -> nem loi, khong thay doi gi', () => {
  assert.throws(() => replaceLine(['8h - A'], 'zzz', 'x'), (e) => e.code === 'not-found');
});

test('addLineUnique: them vao cuoi neu chua co', () => {
  const r = addLineUnique(['8h - A'], '9h - B');
  assert.equal(r.duplicate, false);
  assert.deepEqual(r.lines, ['8h - A', '9h - B']);
});

test('addLineUnique: dong y het (khac hoa thuong/khoang trang) -> khong them, duplicate=true', () => {
  const r = addLineUnique(['13h30 - Đi khám'], '  13H30 -  đi khám ');
  assert.equal(r.duplicate, true);
  assert.deepEqual(r.lines, ['13h30 - Đi khám']);
});

test('addLineUnique: cung noi dung nhung khac gio -> van them (khong phai trung)', () => {
  const r = addLineUnique(['13h30 - Đi khám'], '13h30 - 16h30 - Đi khám');
  assert.equal(r.duplicate, false);
  assert.equal(r.lines.length, 2);
});
