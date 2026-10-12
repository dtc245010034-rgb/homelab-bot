// Mỗi ô lịch (ngày × buổi) chứa nhiều dòng "giờ - nội dung". Các hàm thuần thao tác trên mảng dòng.
class ScheduleCellError extends Error {
  constructor(code, message, lines = []) {
    super(message);
    this.name = 'ScheduleCellError';
    this.code = code;
    this.lines = lines;
  }
}

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

const listLines = (lines) => lines.map(l => `"${l}"`).join('; ');

function splitCell(value) {
  if (value == null) return [];
  return String(value).split('\n').map(l => l.trim()).filter(Boolean);
}

const joinCell = (lines) => lines.join('\n');

function findLine(lines, match) {
  if (lines.length === 0) throw new ScheduleCellError('empty', 'Ô lịch này đang trống.');
  const key = norm(match);
  if (!key) {
    if (lines.length === 1) return { index: 0, line: lines[0] };
    throw new ScheduleCellError('need-match', `Ô có ${lines.length} việc, cần chỉ rõ việc nào: ${listLines(lines)}.`, lines);
  }
  const hits = lines.map((line, index) => ({ line, index })).filter(x => norm(x.line).includes(key));
  if (hits.length === 0) throw new ScheduleCellError('not-found', `Không thấy việc nào khớp "${match}". Hiện có: ${listLines(lines)}.`, lines);
  if (hits.length > 1) throw new ScheduleCellError('ambiguous', `"${match}" khớp ${hits.length} việc: ${listLines(hits.map(h => h.line))}. Hãy nêu rõ hơn.`, lines);
  return hits[0];
}

function removeLine(lines, match) {
  const { index, line } = findLine(lines, match);
  return { lines: lines.filter((_, i) => i !== index), removed: line };
}

function replaceLine(lines, match, newLine) {
  const { index, line } = findLine(lines, match);
  return { lines: lines.map((l, i) => (i === index ? newLine : l)), old: line };
}

function addLineUnique(lines, line) {
  if (lines.some(l => norm(l) === norm(line))) return { lines: [...lines], duplicate: true };
  return { lines: [...lines, line.trim()], duplicate: false };
}

module.exports = { ScheduleCellError, splitCell, joinCell, findLine, removeLine, replaceLine, addLineUnique };
