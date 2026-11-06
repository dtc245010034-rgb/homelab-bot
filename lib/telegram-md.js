const { escapeHtml } = require('./rss');

const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
// Moi tieu de muc giu dung 1 emoji dau dong (do model chon), emoji roi rac khac bi bo.
const LEAD_EMOJI = /^((?:\p{Extended_Pictographic}[\u200d\ufe0f]?)+)\s*/u;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[*-]|\d+[.)])\s+/;

// Escape TRUOC roi moi chen the, nen noi dung do model/web tao ra khong the tu chen the HTML.
function inline(escaped) {
  return escaped
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text, url) => `<a href="${url.replace(/"/g, '&quot;')}">${text}</a>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=$|[\s).,;:!?])/g, '$1<i>$2</i>');
}

function line(raw) {
  const src = escapeHtml(raw);
  const bullet = /^(\s*)[*-]\s+(.*)$/.exec(src);
  if (bullet) return `${bullet[1].length >= 2 ? '      └' : '•'} ${inline(bullet[2])}`;
  const num = /^(\d)[.)]\s+(.*)$/.exec(src);
  if (num) return `${num[1]}\ufe0f\u20e3 ${inline(num[2])}`; // 1️⃣ ... 9️⃣
  return inline(src);
}

// the HTML sai long nhau lam Telegram tu choi ca tin -> kiem tra, neu hong thi quay ve van ban thuan.
function balanced(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)(b|i|code|a|blockquote)\b[^>]*>/g)) {
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

// Markdown nhe cua model -> HTML Telegram.
// "### 🧰 Muc" thanh tieu de dam kem emoji dau dong, noi dung cua muc nam trong 1 khoi trich dan; cau chot cuoi bai de ngoai khoi.
function mdToTelegramHtml(md, maxChars = 3300) {
  let src = String(md ?? '').replace(/\r/g, '');
  if (src.length > maxChars) src = src.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';

  const out = [];
  let body = null; // dong cua muc hien tai
  const closeSection = (isLast) => {
    if (!body) return;
    while (body.length && !body[body.length - 1].trim()) body.pop();
    let tail = '';
    if (isLast) {
      const gap = body.map(l => !l.trim()).lastIndexOf(true);
      const lastBlock = gap >= 0 ? body.slice(gap + 1) : [];
      if (gap > 0 && lastBlock.length && !lastBlock.some(l => LIST_ITEM.test(l))) {
        tail = lastBlock.join('\n');
        body = body.slice(0, gap);
        while (body.length && !body[body.length - 1].trim()) body.pop();
      }
    }
    if (body.length) out.push(`<blockquote>${body.join('\n')}</blockquote>`);
    if (tail) out.push(`<i>${tail}</i>`);
    body = null;
  };

  for (const raw of src.split('\n')) {
    const h = HEADING.exec(raw);
    if (h) {
      closeSection(false);
      const lead = LEAD_EMOJI.exec(h[1].trim());
      const title = h[1].trim().slice(lead ? lead[0].length : 0).replace(EMOJI, '').replace(/\*\*/g, '').replace(/[:\s]+$/, '').trim();
      out.push(`${out.length ? '\n' : ''}<b>${lead ? `${lead[1]} ` : ''}${escapeHtml(title)}</b>`);
      body = [];
    } else if (body) {
      body.push(line(raw));
    } else {
      out.push(line(raw));
    }
  }
  closeSection(true);

  const html = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return balanced(html) ? html : escapeHtml(src);
}

module.exports = { mdToTelegramHtml };
