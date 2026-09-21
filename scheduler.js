const path = require('path');
const crypto = require('crypto');
const fsutil = require('./fsutil');

const SCHEDULER_DIR = path.join(__dirname, 'scheduler');
const JOBS_FILE      = path.join(SCHEDULER_DIR, 'jobs.json');
const PIN_STATE_FILE = path.join(SCHEDULER_DIR, 'pin-state.json');
const TICK_MS        = 45_000;

function ensureSchedulerDir() {
  fsutil.ensureDirs([SCHEDULER_DIR]);
}

function loadJobs() {
  return fsutil.readJsonSafe(JOBS_FILE, []) || [];
}

function saveJobs(jobs) {
  ensureSchedulerDir();
  fsutil.writeJsonAtomic(JOBS_FILE, jobs);
}

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

function createScheduler({ send, systemActions, pinMessage, unpinMessage }) {
  async function tick() {
    const now = Date.now();
    const jobs = loadJobs();
    const due = jobs
      .filter(j => j.active && new Date(j.nextFireAt).getTime() <= now)
      .sort((a, b) => new Date(a.nextFireAt) - new Date(b.nextFireAt));

    for (const job of due) {
      try {
        if (job.type === 'message') {
          const messageId = await send(job.chatId, job.message);
          if (pinMessage && messageId) {
            const pinState = fsutil.readJsonSafe(PIN_STATE_FILE, null);
            if (pinState && pinState.chatId === job.chatId && pinState.messageId) {
              await unpinMessage(job.chatId, pinState.messageId);
            }
            await pinMessage(job.chatId, messageId);
            fsutil.writeJsonAtomic(PIN_STATE_FILE, { chatId: job.chatId, messageId });
          }
        } else if (job.type === 'system') {
          const fn = systemActions[job.action];
          if (fn) await fn(job);
          else console.error(`[scheduler] unknown system action: ${job.action}`);
        }
      } catch (e) {
        console.error(`[scheduler] job ${job.id} (${job.action || job.type}) failed:`, e.message);
      }

      const fresh = loadJobs();
      const idx = fresh.findIndex(j => j.id === job.id);
      if (idx === -1) continue; // bi cancelJob() xoa dung luc nay - bo qua

      if (job.schedule.kind === 'once') {
        fresh[idx].active = false;
      } else {
        fresh[idx].nextFireAt = computeNextFireAt(job.schedule, new Date()).toISOString();
      }
      saveJobs(fresh);
    }
  }

  function start() {
    ensureSchedulerDir();
    const jobs = loadJobs();
    const seeds = [
      { action: 'archiveAndResetWeek',     schedule: { kind: 'weekly', dayOfWeek: 1, hour: 0, minute: 0 } },
      { action: 'dailyScheduleDigest',     schedule: { kind: 'daily',  hour: 0, minute: 1 } },
      { action: 'weekendPlanningReminder', schedule: { kind: 'weekly', dayOfWeek: 6, hour: 7, minute: 30 } },
    ];
    let changed = false;
    for (const s of seeds) {
      if (!jobs.some(j => j.type === 'system' && j.action === s.action)) {
        jobs.push({
          id: crypto.randomUUID().slice(0, 8),
          chatId: null,
          type: 'system',
          action: s.action,
          schedule: s.schedule,
          nextFireAt: computeNextFireAt(s.schedule, new Date()).toISOString(),
          active: true,
          createdAt: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) saveJobs(jobs);

    setInterval(() => {
      tick().catch(e => console.error('[scheduler tick error]', e.message));
    }, TICK_MS);
  }

  function addJob({ chatId, type, message, action, schedule }) {
    const jobs = loadJobs();
    const job = {
      id: crypto.randomUUID().slice(0, 8),
      chatId,
      type,
      message,
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
    return loadJobs().filter(j => j.active && j.type === 'message' && j.chatId === chatId);
  }

  function cancelJob(id) {
    const jobs = loadJobs();
    const idx = jobs.findIndex(j => j.id === id && j.type === 'message');
    if (idx === -1) return false;
    jobs[idx].active = false;
    saveJobs(jobs);
    return true;
  }

  return { start, addJob, listJobs, cancelJob, tick };
}

module.exports = { createScheduler, computeNextFireAt };
