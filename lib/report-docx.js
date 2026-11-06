const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } = require('docx');

const MAX_SECTIONS = 20;
const MAX_ITEMS = 60;
const KEEP_REPORTS = 30;

const str = (v, max = 4000) => String(v ?? '').slice(0, max);
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

// Doan van co the co link: { text, url? } -> Paragraph. Chi link http(s), tranh javascript:/file:.
function linkRuns(text, url) {
  const safe = httpUrl(url);
  if (!safe) return [new TextRun(text)];
  return [new ExternalHyperlink({ link: safe, children: [new TextRun({ text, style: 'Hyperlink', color: '0563C1', underline: {} })] })];
}

function buildDocument({ title, summary, sections = [], sources = [] }) {
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(str(title, 200) || 'Báo cáo')] })];
  if (summary) children.push(new Paragraph({ children: [new TextRun({ text: str(summary), italics: true })], spacing: { after: 200 } }));

  for (const s of sections.slice(0, MAX_SECTIONS)) {
    if (s.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(str(s.heading, 200))] }));
    for (const p of (s.paragraphs || []).slice(0, MAX_ITEMS)) {
      children.push(new Paragraph({ children: [new TextRun(str(p))], spacing: { after: 120 } }));
    }
    for (const b of (s.bullets || []).slice(0, MAX_ITEMS)) {
      const item = typeof b === 'string' ? { text: b } : b;
      children.push(new Paragraph({ bullet: { level: 0 }, children: linkRuns(str(item.text, 1000), item.url) }));
    }
  }

  if (sources.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Nguồn tham khảo')] }));
    sources.slice(0, MAX_ITEMS).forEach((src, i) => {
      const label = str(src.title || src.url, 300);
      children.push(new Paragraph({
        children: [new TextRun(`[${i + 1}] `), ...linkRuns(label, src.url), ...(httpUrl(src.url) ? [new TextRun({ text: `  ${src.url}`, color: '666666', size: 18 })] : [])],
      }));
    });
  }
  return new Document({ creator: 'homelab-bot', title: str(title, 200), sections: [{ children }] });
}

function slugify(s) {
  return String(s || 'bao-cao').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'bao-cao';
}

// Giu KEEP_REPORTS file moi nhat de thu muc khong phinh mai.
function pruneReports(dir, keep = KEEP_REPORTS) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* best effort */ }
  }
}

// Ten file do code tu dat (khong lay duong dan tu model) -> khong the bat bot gui/ghi file tuy y.
async function writeReport(dir, spec, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const filePath = path.join(dir, `${stamp}-${slugify(spec.title)}.docx`);
  fs.writeFileSync(filePath, await Packer.toBuffer(buildDocument(spec)));
  pruneReports(dir);
  return filePath;
}

module.exports = { buildDocument, writeReport, slugify, pruneReports };
