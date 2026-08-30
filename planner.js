/* =========================================================
   PLANNER — Todoist-uslubidagi shaxsiy modul
   Global helpers: state, sb, currentProfile, toast, escapeHtml,
   uid, todayISO, t, usingLocalFallback
========================================================= */

const LOCAL_KEY_PLANNER_TASKS = 'tm_local_planner_tasks';
const LOCAL_KEY_PLANNER_GOALS = 'tm_local_planner_goals';
const LOCAL_KEY_FOCUS = 'tm_local_focus_sessions';

const PLANNER_WEEKDAYS = {
  uz: ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
  ru: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};
const PLANNER_MONTHS = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};

let plannerFocus = {
  running: false,
  paused: false,
  plannedSeconds: 25 * 60,
  startedAt: 0,
  pauseStartedAt: 0,
  pausedMs: 0,
  tickId: null,
  sessionStartedAt: null
};
let plannerShowDone = {
  today: false,
  scheduled: false,
  inbox: false,
  goals: false
};

function plannerUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return (typeof uid === 'function' ? uid() : ('id_' + Date.now())).replace(/^id_/, '00000000-0000-4000-8000-');
}

function plannerOwnerId() {
  return currentProfile?.id || null;
}

function plannerLang() {
  return (typeof currentLang !== 'undefined' && currentLang) || 'uz';
}

function plannerT(key, fallback) {
  if (typeof t === 'function') {
    const v = t(key);
    if (v && v !== key) return v;
  }
  return fallback;
}

function ensurePlannerState() {
  if (!state.plannerTasks) state.plannerTasks = [];
  if (!state.plannerGoals) state.plannerGoals = [];
  if (!state.focusSessions) state.focusSessions = [];
  if (!state.plannerTab) state.plannerTab = 'today';
}

function plannerLocalGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
}
function plannerLocalSet(key, rows) {
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch (e) {}
}

function plannerMine(rows) {
  const id = plannerOwnerId();
  if (!id) return [];
  return (rows || []).filter(r => r.user_id === id);
}

function plannerDateOnly(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function plannerAddDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function plannerPrettyDate(iso) {
  const today = todayISO();
  if (iso === today) return plannerT('planner.today', 'Bugun');
  if (iso === plannerAddDays(today, 1)) return plannerT('planner.tomorrow', 'Ertaga');
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  const lang = plannerLang();
  const wd = (PLANNER_WEEKDAYS[lang] || PLANNER_WEEKDAYS.uz)[d.getDay()];
  const mon = (PLANNER_MONTHS[lang] || PLANNER_MONTHS.uz)[d.getMonth()];
  return wd + ', ' + d.getDate() + '-' + mon;
}

function plannerFormatClock(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

/* ---------- fetch (faqat o'z user_id) ---------- */
async function fetchPlannerTasks() {
  const uid = plannerOwnerId();
  if (!uid) return [];
  if (usingLocalFallback) return plannerMine(plannerLocalGet(LOCAL_KEY_PLANNER_TASKS));
  const { data, error } = await sb.from('planner_tasks')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); toast('Planner: ' + error.message); return []; }
  return plannerMine(data || []);
}

async function fetchPlannerGoals() {
  const uid = plannerOwnerId();
  if (!uid) return [];
  if (usingLocalFallback) return plannerMine(plannerLocalGet(LOCAL_KEY_PLANNER_GOALS));
  const { data, error } = await sb.from('planner_goals')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); toast('Planner: ' + error.message); return []; }
  return plannerMine(data || []);
}

async function fetchFocusSessions() {
  const uid = plannerOwnerId();
  if (!uid) return [];
  if (usingLocalFallback) return plannerMine(plannerLocalGet(LOCAL_KEY_FOCUS));
  const { data, error } = await sb.from('focus_sessions')
    .select('*')
    .eq('user_id', uid)
    .order('started_at', { ascending: false });
  if (error) { console.error(error); return []; }
  return plannerMine(data || []);
}

async function loadPlannerData() {
  ensurePlannerState();
  if (!plannerOwnerId()) {
    state.plannerTasks = [];
    state.plannerGoals = [];
    state.focusSessions = [];
    return;
  }
  const [tasks, goals, sessions] = await Promise.all([
    fetchPlannerTasks(),
    fetchPlannerGoals(),
    fetchFocusSessions()
  ]);
  state.plannerTasks = tasks;
  state.plannerGoals = goals;
  state.focusSessions = sessions;
  state._plannerLoaded = true;
}

/* ---------- CRUD (optimistic) ---------- */
async function plannerInsertRow(table, localKey, row, listKey) {
  const uid = plannerOwnerId();
  if (!uid) { toast(plannerT('planner.needProfile', 'Profil topilmadi')); return null; }
  row.user_id = uid;
  ensurePlannerState();
  state[listKey] = (state[listKey] || []).concat([row]);
  renderPlannerView();

  if (usingLocalFallback) {
    const all = plannerLocalGet(localKey);
    all.push(row);
    plannerLocalSet(localKey, all);
    return row;
  }
  const payload = Object.assign({}, row);
  delete payload.id;
  const { data, error } = await sb.from(table).insert([payload]).select('*').single();
  if (error) {
    state[listKey] = (state[listKey] || []).filter(x => x.id !== row.id);
    renderPlannerView();
    toast('Xatolik: ' + error.message);
    return null;
  }
  state[listKey] = (state[listKey] || []).map(x => x.id === row.id ? data : x);
  renderPlannerView();
  return data;
}

async function plannerPatchRow(table, localKey, listKey, id, patch) {
  ensurePlannerState();
  const list = state[listKey] || [];
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return false;
  const prev = Object.assign({}, list[idx]);
  list[idx] = Object.assign({}, list[idx], patch);
  renderPlannerView();

  if (usingLocalFallback) {
    const all = plannerLocalGet(localKey).map(x => x.id === id ? Object.assign({}, x, patch) : x);
    plannerLocalSet(localKey, all);
    return true;
  }
  const { error } = await sb.from(table).update(patch).eq('id', id).eq('user_id', plannerOwnerId());
  if (error) {
    list[idx] = prev;
    renderPlannerView();
    toast('Xatolik: ' + error.message);
    return false;
  }
  return true;
}

async function plannerRemoveRow(table, localKey, listKey, id) {
  ensurePlannerState();
  const list = state[listKey] || [];
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return;
  const prev = list[idx];
  list.splice(idx, 1);
  renderPlannerView();

  if (usingLocalFallback) {
    plannerLocalSet(localKey, plannerLocalGet(localKey).filter(x => x.id !== id));
    return;
  }
  const { error } = await sb.from(table).delete().eq('id', id).eq('user_id', plannerOwnerId());
  if (error) {
    state[listKey].splice(idx, 0, prev);
    renderPlannerView();
    toast('Xatolik: ' + error.message);
  }
}

async function plannerAddTask(title, dueDate) {
  const text = String(title || '').trim();
  if (!text) return;
  const now = new Date().toISOString();
  await plannerInsertRow('planner_tasks', LOCAL_KEY_PLANNER_TASKS, {
    id: plannerUid(),
    title: text,
    due_date: dueDate || null,
    is_done: false,
    done_at: null,
    created_at: now
  }, 'plannerTasks');
}

async function plannerToggleTask(id) {
  const task = (state.plannerTasks || []).find(x => x.id === id);
  if (!task) return;
  const next = !task.is_done;
  await plannerPatchRow('planner_tasks', LOCAL_KEY_PLANNER_TASKS, 'plannerTasks', id, {
    is_done: next,
    done_at: next ? new Date().toISOString() : null
  });
}

async function plannerDeleteTask(id) {
  await plannerRemoveRow('planner_tasks', LOCAL_KEY_PLANNER_TASKS, 'plannerTasks', id);
}

async function plannerAddGoal(title, targetDate) {
  const text = String(title || '').trim();
  if (!text) return;
  await plannerInsertRow('planner_goals', LOCAL_KEY_PLANNER_GOALS, {
    id: plannerUid(),
    title: text,
    target_date: targetDate || null,
    is_done: false,
    created_at: new Date().toISOString()
  }, 'plannerGoals');
}

async function plannerToggleGoal(id) {
  const g = (state.plannerGoals || []).find(x => x.id === id);
  if (!g) return;
  const next = !g.is_done;
  await plannerPatchRow('planner_goals', LOCAL_KEY_PLANNER_GOALS, 'plannerGoals', id, {
    is_done: next
  });
}

async function plannerDeleteGoal(id) {
  await plannerRemoveRow('planner_goals', LOCAL_KEY_PLANNER_GOALS, 'plannerGoals', id);
}

function plannerAddFromComposer() {
  const input = document.getElementById('planner-composer');
  const dateEl = document.getElementById('planner-composer-date');
  if (!input) return;
  const title = input.value;
  if (!title.trim()) return;
  if (state.plannerTab === 'goals') {
    plannerAddGoal(title, dateEl && dateEl.value ? dateEl.value : null);
  } else {
    let due = null;
    if (state.plannerTab === 'today') due = (dateEl && dateEl.value) || todayISO();
    else if (state.plannerTab === 'scheduled') due = (dateEl && dateEl.value) || plannerAddDays(todayISO(), 1);
    else if (state.plannerTab === 'inbox') due = (dateEl && dateEl.value) || null;
    plannerAddTask(title, due);
  }
  input.value = '';
}

function plannerOnComposerKey(ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    plannerAddFromComposer();
  }
}

function plannerSwitchTab(tab) {
  state.plannerTab = tab;
  renderPlannerView();
  const input = document.getElementById('planner-composer');
  if (input) input.focus();
}

function plannerToggleDoneArchive(section) {
  plannerShowDone[section] = !plannerShowDone[section];
  renderPlannerView();
}

/* ---------- Focus ---------- */
function plannerFocusElapsedSec() {
  if (!plannerFocus.startedAt) return 0;
  const now = plannerFocus.paused ? plannerFocus.pauseStartedAt : Date.now();
  return Math.max(0, (now - plannerFocus.startedAt - plannerFocus.pausedMs) / 1000);
}

function plannerFocusRemaining() {
  return plannerFocus.plannedSeconds - plannerFocusElapsedSec();
}

function plannerTodayFocusStats() {
  const today = todayISO();
  const rows = (state.focusSessions || []).filter(s => {
    if (!s.completed) return false;
    const d = plannerDateOnly(s.started_at || s.created_at || s.ended_at);
    return d === today;
  });
  const seconds = rows.reduce((a, s) => a + (Number(s.actual_seconds) || 0), 0);
  return { count: rows.length, minutes: Math.round(seconds / 60) };
}

async function plannerSaveFocusSession(completed) {
  const uid = plannerOwnerId();
  if (!uid) return;
  const actual = Math.max(1, Math.round(plannerFocusElapsedSec()));
  const started = plannerFocus.sessionStartedAt || new Date(plannerFocus.startedAt).toISOString();
  const row = {
    id: plannerUid(),
    user_id: uid,
    planned_seconds: plannerFocus.plannedSeconds,
    actual_seconds: actual,
    completed: !!completed,
    started_at: started,
    ended_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  ensurePlannerState();
  state.focusSessions = [row].concat(state.focusSessions || []);
  renderPlannerView();

  if (usingLocalFallback) {
    const all = plannerLocalGet(LOCAL_KEY_FOCUS);
    all.unshift(row);
    plannerLocalSet(LOCAL_KEY_FOCUS, all);
    return;
  }
  const payload = Object.assign({}, row);
  delete payload.id;
  const { data, error } = await sb.from('focus_sessions').insert([payload]).select('*').single();
  if (error) {
    console.error(error);
    toast('Fokus seansi yozilmadi: ' + error.message);
    return;
  }
  state.focusSessions = (state.focusSessions || []).map(x => x.id === row.id ? data : x);
  renderPlannerView();
}

function plannerBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

function plannerNotifyFocusDone() {
  toast(plannerT('planner.focusDone', 'Fokus seansi tugadi! 🎉'));
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(plannerT('planner.focusDone', 'Fokus seansi tugadi! 🎉')); } catch (e) { plannerBeep(); }
  } else {
    plannerBeep();
  }
}

function plannerStopTick() {
  if (plannerFocus.tickId) {
    clearInterval(plannerFocus.tickId);
    plannerFocus.tickId = null;
  }
}

function plannerTick() {
  const left = plannerFocusRemaining();
  plannerPaintFocus();
  if (left <= 0 && plannerFocus.running && !plannerFocus.paused) {
    plannerStopTick();
    plannerFocus.running = false;
    plannerFocus.paused = false;
    plannerSaveFocusSession(true);
    plannerNotifyFocusDone();
    plannerPaintFocus();
  }
}

function plannerStartFocus() {
  const input = document.getElementById('planner-focus-mins');
  let mins = parseInt(input && input.value, 10);
  if (!Number.isFinite(mins) || mins < 1) mins = 25;
  if (mins > 180) mins = 180;
  if (input) input.value = String(mins);

  if (plannerFocus.paused && plannerFocus.startedAt) {
    plannerFocus.pausedMs += Date.now() - plannerFocus.pauseStartedAt;
    plannerFocus.paused = false;
    plannerFocus.running = true;
    plannerFocus.tickId = setInterval(plannerTick, 250);
    plannerPaintFocus();
    return;
  }

  plannerStopTick();
  plannerFocus.plannedSeconds = mins * 60;
  plannerFocus.startedAt = Date.now();
  plannerFocus.pausedMs = 0;
  plannerFocus.paused = false;
  plannerFocus.running = true;
  plannerFocus.sessionStartedAt = new Date().toISOString();
  plannerFocus.tickId = setInterval(plannerTick, 250);
  plannerPaintFocus();
}

function plannerPauseFocus() {
  if (!plannerFocus.running || plannerFocus.paused) return;
  plannerFocus.paused = true;
  plannerFocus.pauseStartedAt = Date.now();
  plannerStopTick();
  plannerPaintFocus();
}

async function plannerCancelFocus() {
  if (!plannerFocus.running && !plannerFocus.paused && !plannerFocus.startedAt) return;
  plannerStopTick();
  if (plannerFocus.startedAt && plannerFocusElapsedSec() >= 1) {
    await plannerSaveFocusSession(false);
  }
  plannerFocus.running = false;
  plannerFocus.paused = false;
  plannerFocus.startedAt = 0;
  plannerFocus.pausedMs = 0;
  plannerFocus.sessionStartedAt = null;
  plannerPaintFocus();
}

function plannerPaintFocus() {
  const clock = document.getElementById('planner-focus-clock');
  const stats = document.getElementById('planner-focus-stats');
  const startBtn = document.getElementById('planner-focus-start');
  if (clock) {
    const left = plannerFocus.running || plannerFocus.paused
      ? plannerFocusRemaining()
      : (parseInt((document.getElementById('planner-focus-mins') || {}).value, 10) || 25) * 60;
    clock.textContent = plannerFormatClock(left);
    clock.classList.toggle('running', plannerFocus.running && !plannerFocus.paused);
    clock.classList.toggle('paused', plannerFocus.paused);
  }
  if (startBtn) {
    startBtn.textContent = plannerFocus.paused
      ? plannerT('planner.resume', 'Davom ettirish')
      : (plannerFocus.running
        ? plannerT('planner.running', 'Davom etmoqda')
        : plannerT('planner.start', 'Boshlash'));
    startBtn.disabled = plannerFocus.running && !plannerFocus.paused;
  }
  if (stats) {
    const s = plannerTodayFocusStats();
    stats.textContent = plannerT('planner.focusToday', 'Bugun: {n} ta seans, jami {m} daqiqa fokus')
      .replace('{n}', String(s.count))
      .replace('{m}', String(s.minutes));
  }
}

/* ---------- UI ---------- */
function plannerTaskRowHtml(task, overdue) {
  const done = !!task.is_done;
  return `<div class="pl-row${done ? ' done' : ''}${overdue ? ' overdue' : ''}">
    <button type="button" class="pl-check${done ? ' on' : ''}" onclick="plannerToggleTask('${task.id}')" aria-label="Bajarildi"></button>
    <span class="pl-title">${escapeHtml(task.title || '')}</span>
    ${overdue ? `<span class="pl-badge">${escapeHtml(plannerT('planner.overdue', 'Kechikkan'))}</span>` : ''}
    ${!overdue && task.due_date && state.plannerTab !== 'today' ? `<span class="pl-date">${escapeHtml(plannerPrettyDate(plannerDateOnly(task.due_date)))}</span>` : ''}
    <button type="button" class="pl-del" onclick="plannerDeleteTask('${task.id}')" title="O'chirish">×</button>
  </div>`;
}

function plannerGoalRowHtml(g) {
  const done = !!g.is_done;
  const td = plannerDateOnly(g.target_date);
  return `<div class="pl-row${done ? ' done' : ''}">
    <button type="button" class="pl-check${done ? ' on' : ''}" onclick="plannerToggleGoal('${g.id}')" aria-label="Bajarildi"></button>
    <span class="pl-title">${escapeHtml(g.title || '')}</span>
    ${td ? `<span class="pl-date">${escapeHtml(plannerPrettyDate(td))}</span>` : ''}
    <button type="button" class="pl-del" onclick="plannerDeleteGoal('${g.id}')" title="O'chirish">×</button>
  </div>`;
}

function plannerDoneFold(section, rows, renderRow) {
  if (!rows.length) return '';
  const open = !!plannerShowDone[section];
  return `<div class="pl-done-wrap">
    <button type="button" class="pl-done-toggle" onclick="plannerToggleDoneArchive('${section}')">
      ✓ ${rows.length} ta bajarildi (${open ? plannerT('planner.hide', 'yashirish') : plannerT('planner.show', 'ko\'rsatish')})
    </button>
    ${open ? `<div class="pl-done-list">${rows.map(renderRow).join('')}</div>` : ''}
  </div>`;
}

function plannerComposerPlaceholder() {
  if (state.plannerTab === 'goals') return plannerT('planner.goalPh', 'Yangi maqsad…');
  if (state.plannerTab === 'inbox') return plannerT('planner.inboxPh', 'Muddatisiz vazifa…');
  if (state.plannerTab === 'scheduled') return plannerT('planner.schedPh', 'Kelajakdagi vazifa…');
  return plannerT('planner.todayPh', 'Bugungi vazifa… Enter bilan qo\'shing');
}

function renderPlannerToday() {
  const today = todayISO();
  const tasks = state.plannerTasks || [];
  const overdue = tasks.filter(t => !t.is_done && plannerDateOnly(t.due_date) && plannerDateOnly(t.due_date) < today)
    .sort((a, b) => plannerDateOnly(a.due_date).localeCompare(plannerDateOnly(b.due_date)));
  const todayOpen = tasks.filter(t => !t.is_done && plannerDateOnly(t.due_date) === today);
  const done = tasks.filter(t => t.is_done && plannerDateOnly(t.due_date) && plannerDateOnly(t.due_date) <= today);
  let html = '';
  if (overdue.length) {
    html += `<div class="pl-group overdue-group"><div class="pl-group-title danger">${escapeHtml(plannerT('planner.overdue', 'Kechikkan'))}</div>
      ${overdue.map(t => plannerTaskRowHtml(t, true)).join('')}</div>`;
  }
  html += todayOpen.length
    ? todayOpen.map(t => plannerTaskRowHtml(t, false)).join('')
    : `<p class="pl-empty">${escapeHtml(plannerT('planner.emptyToday', 'Bugun uchun vazifa yo\'q'))}</p>`;
  html += plannerDoneFold('today', done, t => plannerTaskRowHtml(t, false));
  return html;
}

function renderPlannerScheduled() {
  const today = todayISO();
  const open = (state.plannerTasks || []).filter(t => !t.is_done && plannerDateOnly(t.due_date) && plannerDateOnly(t.due_date) > today);
  const done = (state.plannerTasks || []).filter(t => t.is_done && plannerDateOnly(t.due_date) && plannerDateOnly(t.due_date) > today);
  const groups = {};
  open.forEach(t => {
    const k = plannerDateOnly(t.due_date);
    (groups[k] || (groups[k] = [])).push(t);
  });
  const keys = Object.keys(groups).sort();
  if (!keys.length && !done.length) {
    return `<p class="pl-empty">${escapeHtml(plannerT('planner.emptySched', 'Kelajakdagi vazifa yo\'q'))}</p>`;
  }
  let html = keys.map(k => `<div class="pl-group"><div class="pl-group-title">${escapeHtml(plannerPrettyDate(k))}</div>
    ${groups[k].map(t => plannerTaskRowHtml(t, false)).join('')}</div>`).join('');
  html += plannerDoneFold('scheduled', done, t => plannerTaskRowHtml(t, false));
  return html;
}

function renderPlannerInbox() {
  const open = (state.plannerTasks || []).filter(t => !t.is_done && !plannerDateOnly(t.due_date));
  const done = (state.plannerTasks || []).filter(t => t.is_done && !plannerDateOnly(t.due_date));
  let html = open.length
    ? open.map(t => plannerTaskRowHtml(t, false)).join('')
    : `<p class="pl-empty">${escapeHtml(plannerT('planner.emptyInbox', 'Muddatisiz vazifa yo\'q'))}</p>`;
  html += plannerDoneFold('inbox', done, t => plannerTaskRowHtml(t, false));
  return html;
}

function renderPlannerGoals() {
  const open = (state.plannerGoals || []).filter(g => !g.is_done);
  const done = (state.plannerGoals || []).filter(g => g.is_done);
  let html = open.length
    ? open.map(g => plannerGoalRowHtml(g)).join('')
    : `<p class="pl-empty">${escapeHtml(plannerT('planner.emptyGoals', 'Maqsad qo\'shilmagan'))}</p>`;
  html += plannerDoneFold('goals', done, g => plannerGoalRowHtml(g));
  return html;
}

function renderPlannerView() {
  ensurePlannerState();
  const root = document.getElementById('planner-root');
  if (!root) return;
  const tab = state.plannerTab || 'today';
  const tabs = [
    { id: 'today', label: plannerT('planner.tabToday', '📅 Bugun') },
    { id: 'scheduled', label: plannerT('planner.tabSched', '🗓 Rejalashtirilgan') },
    { id: 'inbox', label: plannerT('planner.tabInbox', '📥 Muddatisiz') },
    { id: 'goals', label: plannerT('planner.tabGoals', '🎯 Maqsadlar') }
  ];
  const defaultDate = tab === 'scheduled' ? plannerAddDays(todayISO(), 1) : (tab === 'inbox' || tab === 'goals' ? '' : todayISO());
  const body = tab === 'today' ? renderPlannerToday()
    : tab === 'scheduled' ? renderPlannerScheduled()
    : tab === 'inbox' ? renderPlannerInbox()
    : renderPlannerGoals();

  const clockVal = plannerFocus.running || plannerFocus.paused
    ? plannerFormatClock(plannerFocusRemaining())
    : plannerFormatClock(25 * 60);
  const stats = plannerTodayFocusStats();
  const startLabel = plannerFocus.paused
    ? plannerT('planner.resume', 'Davom ettirish')
    : plannerT('planner.start', 'Boshlash');

  root.innerHTML = `
    <div class="planner-page">
      <div class="pl-head">
        <div>
          <h2 class="pl-title">${escapeHtml(plannerT('planner.title', '🎯 Planner'))}</h2>
          <p class="pl-sub">${escapeHtml(plannerT('planner.sub', 'Faqat sizga ko\'rinadigan shaxsiy vazifalar va fokus'))}</p>
        </div>
        <div class="pl-focus" id="planner-focus-widget">
          <div class="pl-focus-top">
            <span class="pl-focus-label">⏱ ${escapeHtml(plannerT('planner.focus', 'Fokus'))}</span>
            <span class="pl-focus-stats" id="planner-focus-stats">${escapeHtml(
              plannerT('planner.focusToday', 'Bugun: {n} ta seans, jami {m} daqiqa fokus')
                .replace('{n}', String(stats.count)).replace('{m}', String(stats.minutes))
            )}</span>
          </div>
          <div class="pl-focus-clock ${plannerFocus.running && !plannerFocus.paused ? 'running' : ''}${plannerFocus.paused ? ' paused' : ''}" id="planner-focus-clock">${clockVal}</div>
          <div class="pl-focus-controls">
            <label class="pl-mins">${escapeHtml(plannerT('planner.minutes', 'Daqiqa'))}
              <input type="number" id="planner-focus-mins" min="1" max="180" value="${Math.round(plannerFocus.plannedSeconds / 60) || 25}">
            </label>
            <button type="button" class="btn-blue" id="planner-focus-start" onclick="plannerStartFocus()" ${plannerFocus.running && !plannerFocus.paused ? 'disabled' : ''}>${escapeHtml(startLabel)}</button>
            <button type="button" class="btn-ghost" onclick="plannerPauseFocus()">${escapeHtml(plannerT('planner.pause', 'Pauza'))}</button>
            <button type="button" class="btn-ghost" onclick="plannerCancelFocus()">${escapeHtml(plannerT('planner.cancel', 'Bekor qilish'))}</button>
          </div>
        </div>
      </div>
      <div class="pl-tabs" role="tablist">
        ${tabs.map(tb => `<button type="button" class="pl-tab${tb.id === tab ? ' active' : ''}" onclick="plannerSwitchTab('${tb.id}')">${escapeHtml(tb.label)}</button>`).join('')}
      </div>
      <div class="pl-composer">
        <input type="text" id="planner-composer" placeholder="${escapeHtml(plannerComposerPlaceholder())}" autocomplete="off" onkeydown="plannerOnComposerKey(event)">
        <label class="pl-cal" title="${escapeHtml(plannerT('planner.pickDate', 'Sana'))}">📅
          <input type="date" id="planner-composer-date" value="${escapeHtml(defaultDate)}">
        </label>
        <button type="button" class="btn-blue" onclick="plannerAddFromComposer()">${escapeHtml(plannerT('planner.add', 'Qo\'shish'))}</button>
      </div>
      <div class="pl-body">${body}</div>
    </div>`;
  plannerPaintFocus();
  const input = document.getElementById('planner-composer');
  if (input && document.activeElement && document.activeElement.id !== 'planner-composer') {
    /* keep focus only if user is not typing elsewhere */
  }
}

async function openPlannerView() {
  ensurePlannerState();
  if (!state._plannerLoaded) {
    await loadPlannerData();
    state._plannerLoaded = true;
  }
  renderPlannerView();
}
