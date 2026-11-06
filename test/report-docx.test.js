const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { writeReport, slugify, pruneReports } = require('../lib/report-docx');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
const xmlOf = async (file) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  return { doc: await zip.file('word/document.xml').async('string'), rels: await zip.file('word/_rels/document.xml.rels').async('string') };
};

test('slugify: bo dau tieng Viet, ky tu la', () => {
  assert.equal(slugify('Bản tin AI ngày 06/11/2026!'), 'ban-tin-ai-ngay-06-11-2026');
  assert.equal(slugify('Đường đi'), 'duong-di');
  assert.equal(slugify('***'), 'bao-cao');
});

test('writeReport: tao .docx hop le co tieu de, muc, link nguon', async () => {
  const dir = tmp();
  const file = await writeReport(dir, {
    title: 'Bản tin AI',
    summary: 'Tóm tắt ngắn',
    sections: [{ heading: 'Tin nổi bật', paragraphs: ['Doan van 1'], bullets: [{ text: 'OpenAI ra mat X', url: 'https://openai.example/x' }, 'Gach khong link'] }],
    sources: [{ title: 'OpenAI blog', url: 'https://openai.example/x' }],
  }, new Date('2026-11-06T03:00:00Z'));
  assert.equal(path.dirname(file), dir);
  assert.match(path.basename(file), /^202611060300-ban-tin-ai\.docx$/);
  const { doc, rels } = await xmlOf(file);
  for (const t of ['Bản tin AI', 'Tin nổi bật', 'Doan van 1', 'OpenAI ra mat X', 'Gach khong link', 'Nguồn tham khảo']) assert.ok(doc.includes(t), t);
  assert.match(rels, /Target="https:\/\/openai\.example\/x"[^>]*TargetMode="External"/);
});

test('writeReport: link khong phai http(s) khong tro thanh hyperlink', async () => {
  const file = await writeReport(tmp(), {
    title: 'T', sections: [{ heading: 'H', bullets: [{ text: 'bad', url: 'javascript:alert(1)' }, { text: 'file', url: 'file:///etc/passwd' }] }],
    sources: [{ title: 'x', url: 'javascript:alert(1)' }],
  });
  const { doc, rels } = await xmlOf(file);
  assert.ok(doc.includes('bad'));
  assert.ok(!/javascript:|file:\/\//.test(rels));
});

test('writeReport: tieu de chua ../ khong thoat khoi thu muc bao cao', async () => {
  const dir = tmp();
  const file = await writeReport(dir, { title: '../../etc/passwd', sections: [] });
  assert.equal(path.dirname(file), dir);
});

test('pruneReports: giu keep file moi nhat', () => {
  const dir = tmp();
  for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, `2026110${i}0000-x.docx`), 'x');
  pruneReports(dir, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['202611040000-x.docx', '202611050000-x.docx']);
});
