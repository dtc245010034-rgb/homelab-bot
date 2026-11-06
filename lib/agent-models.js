// Chon thu tu model de thu cho 1 lan goi Gemini, theo "loai viec":
//   interactive = nguoi dung dang cho cau tra loi (/agent)  -> bat dau tu model dang dung (currentModel)
//   scheduled / summary = viec nen (hen gio, tom tat phien)  -> thu model NHE (backgroundModel) truoc,
//                           de danh quota model manh cho hoi dap truc tiep; het quota thi moi sang cac model con lai.
// Model da het quota hom nay bi loai khoi danh sach. backgroundModel khong nam trong chuoi model cua nguoi dung thi bo qua.
const KINDS = Object.freeze(['interactive', 'scheduled', 'summary']);

function orderModels({ candidates, currentModel, exhausted = [], kind = 'interactive', backgroundModel = '' }) {
  const startIdx = Math.max(0, candidates.indexOf(currentModel));
  let ordered = [...candidates.slice(startIdx), ...candidates.slice(0, startIdx)];
  if (kind !== 'interactive' && backgroundModel && candidates.includes(backgroundModel)) {
    ordered = [backgroundModel, ...ordered.filter(m => m !== backgroundModel)];
  }
  ordered = ordered.filter(m => !exhausted.includes(m));
  // Tat ca deu het quota: van thu 1 model de loi 429 that tu Google quyet dinh (quota co the da phuc hoi som).
  if (ordered.length === 0) ordered.push(currentModel || candidates[0]);
  return ordered;
}

// byKind: { interactive: { calls, tasks }, ... } - "calls" la so lan goi API (tinh ca thu lai), "tasks" la so cau hoi/viec.
function bumpKind(byKind, kind, field) {
  const k = KINDS.includes(kind) ? kind : 'interactive';
  const cur = byKind[k] || { calls: 0, tasks: 0 };
  return { ...byKind, [k]: { ...cur, [field]: (cur[field] || 0) + 1 } };
}

const KIND_LABEL = { interactive: 'hỏi đáp', scheduled: 'hẹn giờ', summary: 'tóm tắt phiên' };

// Dong tom tat de hien trong /agent quota: "hỏi đáp: 12 lượt / 5 câu (TB 2.4) · hẹn giờ: 6 lượt / 2 việc ..."
function formatKindUsage(byKind = {}) {
  const parts = [];
  for (const k of KINDS) {
    const u = byKind[k];
    if (!u || !u.calls) continue;
    const avg = u.tasks ? ` (TB ${(u.calls / u.tasks).toFixed(1)})` : '';
    parts.push(`${KIND_LABEL[k]}: ${u.calls} lượt${u.tasks ? ` / ${u.tasks} ${k === 'interactive' ? 'câu' : 'việc'}` : ''}${avg}`);
  }
  return parts.join(' · ');
}

module.exports = { KINDS, orderModels, bumpKind, formatKindUsage };
