const crypto = require('crypto');

const PREFIX = 'agc';

function createConfirmStore({ timeoutMs }) {
  const pending = new Map(); // chatId -> { id, resolve, timer }

  function finish(chatId, answer) {
    const p = pending.get(chatId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(chatId);
    p.resolve(answer);
  }

  function request(chatId) {
    finish(chatId, 'no');
    const id = crypto.randomBytes(4).toString('hex');
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => finish(chatId, 'timeout'), timeoutMs);
      pending.set(chatId, { id, resolve, timer });
    });
    return { id, promise };
  }

  // id chỉ có khi bấm nút; gõ tay (không id) áp dụng cho yêu cầu đang chờ.
  function answer(chatId, ans, id) {
    const p = pending.get(chatId);
    if (!p) return 'none';
    if (id !== undefined && id !== p.id) return 'stale';
    finish(chatId, ans);
    return 'ok';
  }

  return { request, answer, hasPending: (chatId) => pending.has(chatId) };
}

function confirmKeyboard(id) {
  return [[
    { text: '✅ Xác nhận', callback_data: `${PREFIX}:yes:${id}` },
    { text: '❌ Huỷ', callback_data: `${PREFIX}:no:${id}` },
  ]];
}

function parseConfirmCallback(data) {
  const m = /^agc:(yes|no):([0-9a-f]{8})$/.exec(data || '');
  return m ? { answer: m[1], id: m[2] } : null;
}

module.exports = { PREFIX, createConfirmStore, confirmKeyboard, parseConfirmCallback };
