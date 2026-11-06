const path = require('path');
const crypto = require('crypto');
const fsutil = require('./fsutil');

const SCHEDULER_DIR = path.join(__dirname, 'scheduler');
const TICK_MS        = 45_000;

// Hàm thuần - nhận `now` tường minh để test không cần chờ thời gian thật.
// QUAN TRỌNG: `now` luôn phải là thời điểm THỰC tại lúc gọi (tạo job, hoặc job vừa bắn xong),
// không bao giờ cộng dồn từ nextFireAt cũ - đây là cơ chế chống bắn dồn khi bot down lâu ngày.
function computeNextFireAt(schedule, now) {
  if (schedule.kind === 'once') {
    return new Date(schedule.atISO);
  }

  const candidate = new Date(now);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  if (schedule.kind === 'daily') {
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  if (schedule.kind === 'weekly') {
    const currentDow = candidate.getDay(); // 0=Chu nhat..6=Thu 7 (chuan JS)
    let diffDays = (schedule.dayOfWeek - currentDow + 7) % 7;
    candidate.setDate(candidate.getDate() + diffDays);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  throw new Error(`Unknown schedule.kind: ${schedule.kind}`);
}

const SYSTEM_SEEDS = [
  { action: 'archiveAndResetWeek',     schedule: { kind: 'weekly', dayOfWeek: 1, hour: 0,  minute: 0 } },
  { action: 'dailyScheduleDigest',     schedule: { kind: 'daily',  hour: 6, minute: 30 } },
  { action: 'weekendPlanningReminder', schedule: { kind: 'weekly', dayOfWeek: 6, hour: 7,  minute: 30 } },
  { action: 'weeklyReport',            schedule: { kind: 'weekly', dayOfWeek: 1, hour: 8,  minute: 0 } },
];

// Ap gio tu .env (SCHEDULE_DAILY_DIGEST, SCHEDULE_WEEKEND_REMINDER, SCHEDULE_WEEKLY_REPORT) len cac seed mac dinh.
// Gia tri 'off' tat han (seed.off). Ham thuan: tra ve mang moi, khong sua SYSTEM_SEEDS.
function buildSystemSeeds(schedules = {}) {
  const pick = { dailyScheduleDigest: schedules.dailyDigest, weekendPlanningReminder: schedules.weekendReminder, weeklyReport: schedules.weeklyReport };
  return SYSTEM_SEEDS.map(seed => {
    const w = pick[seed.action];
    if (!w) return seed;
    if (w.off) return { ...seed, off: true };
    const schedule = { ...seed.schedule, hour: w.hour, minute: w.minute };
    if (seed.schedule.kind === 'weekly' && w.dayOfWeek !== undefined) schedule.dayOfWeek = w.dayOfWeek;
    return { ...seed, schedule };
  });
}

function sameSchedule(a, b) {
  return ['kind', 'dayOfWeek', 'hour', 'minute', 'atISO'].every(k => a[k] === b[k]);
}

// Hop nhat seed vao danh sach job: them seed con thieu, VA cap nhat lich cua seed da ton tai neu code
// doi gio (chi them-neu-thieu thi doi gio trong SYSTEM_SEEDS khong bao gio co hieu luc voi jobs.json cu).
// Ham thuan: khong sua mang dau vao. Chi dung vao job type 'system'.
function reconcileSeeds(jobs, seeds, now) {
  let changed = false;
  const out = jobs.map(j => ({ ...j }));
  for (const s of seeds) {
    const existing = out.find(j => j.type === 'system' && j.action === s.action);
    if (!existing) {
      out.push({
        id: crypto.randomUUID().slice(0, 8),
        chatId: null,
        type: 'system',
        action: s.action,
        schedule: s.schedule,
        nextFireAt: computeNextFireAt(s.schedule, now).toISOString(),
        active: !s.off,
        createdAt: now.toISOString(),
      });
      changed = true;
    } else {
      // Job he thong nguoi dung khong huy duoc (cancelJob chi cham job nguoi dung) nen `active` do .env quyet dinh.
      if (existing.active !== !s.off) { existing.active = !s.off; changed = true; }
      if (!sameSchedule(existing.schedule || {}, s.schedule)) {
        existing.schedule = s.schedule;
        existing.nextFireAt = computeNextFireAt(s.schedule, now).toISOString();
        changed = true;
      }
    }
  }
  return { jobs: out, changed };
}

// Xoa job 'once' da tat va da qua han hon keepDays ngay (jobs.json khong phinh mai). Ham thuan.
function pruneJobs(jobs, now, keepDays = 7) {
  const cutoff = now.getTime() - keepDays * 86400000;
  const kept = jobs.filter(j => {
    if (j.active || j.type === 'system' || !j.schedule || j.schedule.kind !== 'once') return true;
    const at = new Date(j.schedule.atISO).getTime();
    return !(at < cutoff);
  });
  return { jobs: kept, removed: jobs.length - kept.length };
}

// Loai job nguoi dung tao: 'message' (gui chu + ghim) va 'agentTask' (den gio chay agent voi `prompt`).
const USER_JOB_TYPES = new Set(['message', 'agentTask']);

function createScheduler({ send, systemActions, pinMessage, unpinMessage, runAgentTask, dir = SCHEDULER_DIR, seeds = buildSystemSeeds(require('./config').getSettings().SCHEDULES) }) {
  // `dir` chi de test dung thu muc tam, khong dung vao jobs.json that.
  const jobsFile = path.join(dir, 'jobs.json');
  const pinFile = path.join(dir, 'pin-state.json');
  const loadJobs = () => fsutil.readJsonSafe(jobsFile, []) || [];
  const saveJobs = (jobs) => { fsutil.ensureDirs([dir]); fsutil.writeJsonAtomic(jobsFile, jobs); };

  // agentTask co the chay vai phut, lau hon TICK_MS: neu khong danh dau, tick ke tiep thay job van "den han" va ban lai.
  const inFlight = new Set();

  async function tick() {
    const now = Date.now();
    const jobs = loadJobs();
    const due = jobs
      .filter(j => j.active && !inFlight.has(j.id) && new Date(j.nextFireAt).getTime() <= now)
      .sort((a, b) => new Date(a.nextFireAt) - new Date(b.nextFireAt));

    for (const job of due) {
      let ok = false;
      inFlight.add(job.id);
      try {
        if (job.type === 'message') {
          const messageId = await send(job.chatId, job.message);
          if (pinMessage && messageId) {
            const pinState = fsutil.readJsonSafe(pinFile, null);
            if (pinState && pinState.chatId === job.chatId && pinState.messageId) {
              await unpinMessage(job.chatId, pinState.messageId);
            }
            await pinMessage(job.chatId, messageId);
            fsutil.writeJsonAtomic(pinFile, { chatId: job.chatId, messageId });
          }
        } else if (job.type === 'agentTask') {
          if (!runAgentTask) throw new Error('chưa cấu hình runAgentTask');
          await runAgentTask(job);
        } else if (job.type === 'system') {
          const fn = systemActions[job.action];
          if (fn) await fn(job);
          else console.error(`[scheduler] unknown system action: ${job.action}`);
        }
        ok = true;
        console.log(`[scheduler] fired ${job.id} (${job.action || job.type})`);
      } catch (e) {
        console.error(`[scheduler] job ${job.id} (${job.action || job.type}) failed:`, e.message);
      } finally {
        inFlight.delete(job.id);
      }

      const fresh = loadJobs();
      const idx = fresh.findIndex(j => j.id === job.id);
      if (idx === -1) continue; // bi cancelJob() xoa dung luc nay - bo qua

      if (ok) fresh[idx].lastFiredAt = new Date().toISOString();
      if (job.schedule.kind === 'once') {
        fresh[idx].active = false;
      } else {
        fresh[idx].nextFireAt = computeNextFireAt(job.schedule, new Date()).toISOString();
      }
      saveJobs(fresh);
    }
  }

  function start() {
    fsutil.ensureDirs([dir]);
    for (const s of seeds) {
      if (!systemActions[s.action]) console.error(`[scheduler] seed "${s.action}" chưa có handler trong systemActions`);
    }
    const now = new Date();
    const reconciled = reconcileSeeds(loadJobs(), seeds, now);
    const pruned = pruneJobs(reconciled.jobs, now);
    if (reconciled.changed || pruned.removed) saveJobs(pruned.jobs);
    if (pruned.removed) console.log(`[scheduler] don ${pruned.removed} job mot lan da het han`);

    setInterval(() => {
      tick().catch(e => console.error('[scheduler tick error]', e.message));
    }, TICK_MS);
  }

  function addJob({ chatId, type, message, prompt, action, schedule }) {
    const jobs = loadJobs();
    const job = {
      id: crypto.randomUUID().slice(0, 8),
      chatId,
      type,
      message,
      ...(prompt ? { prompt } : {}),
      action,
      schedule,
      nextFireAt: computeNextFireAt(schedule, new Date()).toISOString(),
      active: true,
      createdAt: new Date().toISOString(),
    };
    jobs.push(job);
    saveJobs(jobs);
    return job;
  }

  function listJobs(chatId) {
    return loadJobs().filter(j => j.active && USER_JOB_TYPES.has(j.type) && j.chatId === chatId);
  }

  function cancelJob(id) {
    const jobs = loadJobs();
    const idx = jobs.findIndex(j => j.id === id && USER_JOB_TYPES.has(j.type));
    if (idx === -1) return false;
    jobs[idx].active = false;
    saveJobs(jobs);
    return true;
  }

  return { start, addJob, listJobs, cancelJob, tick };
}

module.exports = { USER_JOB_TYPES, createScheduler, computeNextFireAt, SYSTEM_SEEDS, buildSystemSeeds, reconcileSeeds, pruneJobs };
