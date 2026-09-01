/* =========================================================
   PLANNER — Todoist-uslubidagi shaxsiy modul
   Global helpers: state, sb, currentProfile, toast, escapeHtml,
   uid, todayISO, t, usingLocalFallback
========================================================= */

const LOCAL_KEY_PLANNER_TASKS = 'tm_local_planner_tasks';
const LOCAL_KEY_PLANNER_GOALS = 'tm_local_planner_goals';
const LOCAL_KEY_FOCUS = 'tm_local_focus_sessions';
const LOCAL_KEY_PLANNER_DAY = 'tm_local_planner_day_slots';

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
  if (!state.plannerDaySlots) state.plannerDaySlots = [];
  if (!state.plannerTab) state.plannerTab = 'today';
  if (!state.plannerDayDate) state.plannerDayDate = todayISO();
  if (!state.plannerDayMode) state.plannerDayMode = 'day';
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

function plannerFmtHour(h) {
  return String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';
}

function plannerDefaultDaySlots() {
  const slots = [];
  for (let i = 0; i < 24; i++) {
    const startH = 5 + i;
    slots.push({
      sort_order: i,
      start_time: plannerFmtHour(startH),
      end_time: plannerFmtHour(startH + 1),
      title: '',
      is_done: false
    });
  }
  return slots;
}

function plannerIsTemplateSlot(s) {
  return !s.plan_date;
}

function plannerSlotsFor(planDate) {
  const list = state.plannerDaySlots || [];
  if (planDate == null) {
    return list.filter(plannerIsTemplateSlot).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  const d = plannerDateOnly(planDate);
  return list.filter(s => plannerDateOnly(s.plan_date) === d)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function plannerNormTime(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function plannerTimeToMin(t) {
  const n = plannerNormTime(t);
  if (!n) return 0;
  const p = n.split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

function plannerSlotIsNow(slot) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  let a = plannerTimeToMin(slot.start_time);
  let b = plannerTimeToMin(slot.end_time);
  if (b <= a) b += 24 * 60;
  let c = cur;
  if (c < a && b > 24 * 60) c += 24 * 60;
  return c >= a && c < b;
}

function plannerCloneSlots(fromSlots, planDate) {
  return (fromSlots || []).map((s, i) => ({
    id: plannerUid(),
    plan_date: planDate,
    sort_order: s.sort_order != null ? s.sort_order : i,
    start_time: s.start_time || plannerFmtHour(5 + i),
    end_time: s.end_time || plannerFmtHour(6 + i),
    title: s.title || '',
    is_done: false,
    created_at: new Date().toISOString()
  }));
}

async function fetchPlannerDaySlots(date) {
  const uid = plannerOwnerId();
  if (!uid) return [];
  if (usingLocalFallback) return plannerMine(plannerLocalGet(LOCAL_KEY_PLANNER_DAY));
  const day = date ? plannerDateOnly(date) : todayISO();
  const { data, error } = await sb.from('planner_day_slots')
    .select('*')
    .eq('user_id', uid)
    .or('plan_date.is.null,plan_date.eq.' + day)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error(error);
    const msg = error.message || '';
    if (/schema cache|does not exist|planner_day_slots/i.test(msg)) {
      toast(plannerT('planner.daySql', 'Kunlik reja uchun supabase_schema.sql oxiridagi planner_day_slots SQL ni ishga tushiring'));
    } else {
      toast('Planner: ' + msg);
    }
    return [];
  }
  return plannerMine(data || []);
}

async function plannerInsertManyDaySlots(rows) {
  const uid = plannerOwnerId();
  if (!uid || !rows.length) return [];
  rows.forEach(r => { r.user_id = uid; });
  ensurePlannerState();
  state.plannerDaySlots = (state.plannerDaySlots || []).concat(rows);

  if (usingLocalFallback) {
    plannerLocalSet(LOCAL_KEY_PLANNER_DAY, plannerLocalGet(LOCAL_KEY_PLANNER_DAY).concat(rows));
    return rows;
  }
  const payloads = rows.map(r => {
    const p = Object.assign({}, r);
    delete p.id;
    return p;
  });
  const { data, error } = await sb.from('planner_day_slots').insert(payloads).select('*');
  if (error) {
    const ids = {};
    rows.forEach(r => { ids[r.id] = true; });
    state.plannerDaySlots = (state.plannerDaySlots || []).filter(x => !ids[x.id]);
    toast('Xatolik: ' + error.message);
    return [];
  }
  (data || []).forEach((d, i) => {
    const temp = rows[i];
    if (temp) {
      state.plannerDaySlots = (state.plannerDaySlots || []).map(x => x.id === temp.id ? d : x);
    }
  });
  return data || [];
}

async function plannerEnsureTemplate() {
  ensurePlannerState();
  if (plannerSlotsFor(null).length) return;
  const created = plannerCloneSlots(plannerDefaultDaySlots(), null);
  await plannerInsertManyDaySlots(created);
}

async function plannerEnsureDay(date) {
  const d = plannerDateOnly(date) || todayISO();
  ensurePlannerState();
  await plannerEnsureTemplate();
  if (plannerSlotsFor(d).length) return;
  const cloned = plannerCloneSlots(plannerSlotsFor(null), d);
  if (cloned.length) await plannerInsertManyDaySlots(cloned);
}

async function plannerEnsureDayView() {
  ensurePlannerState();
  const date = state.plannerDayDate || todayISO();
  if (!usingLocalFallback && sb) {
    const extra = await fetchPlannerDaySlots(date);
    const byId = {};
    (state.plannerDaySlots || []).forEach(s => { byId[s.id] = s; });
    extra.forEach(s => { byId[s.id] = s; });
    state.plannerDaySlots = Object.values(byId);
  }
  if (state.plannerDayMode !== 'template') await plannerEnsureDay(date);
  renderPlannerView();
}

async function plannerSetDayDate(value) {
  const d = plannerDateOnly(value) || todayISO();
  state.plannerDayDate = d;
  state.plannerDayMode = 'day';
  await plannerEnsureDayView();
}

function plannerSetDayMode(mode) {
  state.plannerDayMode = mode === 'template' ? 'template' : 'day';
  renderPlannerView();
  if (state.plannerDayMode === 'day') plannerEnsureDayView();
}

async function plannerSaveSlotField(id, field, value) {
  const slot = (state.plannerDaySlots || []).find(x => x.id === id);
  if (!slot) return;
  let next = value;
  if (field === 'start_time' || field === 'end_time') {
    next = plannerNormTime(value);
    if (!next) return;
  } else if (field === 'title') {
    next = String(value || '');
  }
  if (slot[field] === next) return;
  await plannerPatchRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, 'plannerDaySlots', id, { [field]: next }, true);
}

async function plannerToggleDaySlot(id) {
  const slot = (state.plannerDaySlots || []).find(x => x.id === id);
  if (!slot || plannerIsTemplateSlot(slot)) return;
  const next = !slot.is_done;
  const row = document.querySelector('.pl-day-row[data-slot="' + id + '"]');
  if (row) {
    row.classList.toggle('done', next);
    const chk = row.querySelector('.pl-check');
    if (chk) chk.classList.toggle('on', next);
  }
  await plannerPatchRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, 'plannerDaySlots', id, { is_done: next }, true);
}

async function plannerDeleteDaySlot(id) {
  await plannerRemoveRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, 'plannerDaySlots', id);
}

async function plannerAddDaySlot() {
  ensurePlannerState();
  const isTpl = state.plannerDayMode === 'template';
  const date = isTpl ? null : (state.plannerDayDate || todayISO());
  const list = plannerSlotsFor(date);
  const last = list[list.length - 1];
  const lastEnd = last ? plannerTimeToMin(last.end_time) : 5 * 60;
  const startH = Math.floor(lastEnd / 60) % 24;
  const startM = lastEnd % 60;
  const start = String(startH).padStart(2, '0') + ':' + String(startM).padStart(2, '0');
  const endMin = (lastEnd + 60) % (24 * 60);
  const end = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
  await plannerInsertRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, {
    id: plannerUid(),
    plan_date: date,
    sort_order: list.length ? Math.max.apply(null, list.map(s => s.sort_order || 0)) + 1 : 0,
    start_time: start,
    end_time: end,
    title: '',
    is_done: false,
    created_at: new Date().toISOString()
  }, 'plannerDaySlots');
}

async function plannerSaveCurrentAsTemplate() {
  const date = state.plannerDayDate || todayISO();
  const dayRows = plannerSlotsFor(date);
  if (!dayRows.length) {
    toast(plannerT('planner.dayEmpty', 'Avval kunlik qatorlar bo\'lsin'));
    return;
  }
  const oldTpl = plannerSlotsFor(null);
  for (const s of oldTpl) {
    await plannerRemoveRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, 'plannerDaySlots', s.id, true);
  }
  await plannerInsertManyDaySlots(plannerCloneSlots(dayRows, null));
  toast(plannerT('planner.templateSaved', 'Shablon saqlandi'));
  renderPlannerView();
}

async function plannerResetDayFromTemplate() {
  if (!confirm(plannerT('planner.confirmReset', 'Shu kunning yozuvlari shablon bilan almashtirilsinmi?'))) return;
  const date = state.plannerDayDate || todayISO();
  const existing = plannerSlotsFor(date);
  for (const s of existing) {
    await plannerRemoveRow('planner_day_slots', LOCAL_KEY_PLANNER_DAY, 'plannerDaySlots', s.id, true);
  }
  await plannerEnsureTemplate();
  const cloned = plannerCloneSlots(plannerSlotsFor(null), date);
  if (cloned.length) await plannerInsertManyDaySlots(cloned);
  renderPlannerView();
}

function plannerDayRowHtml(slot, showDone, highlight) {
  const done = !!slot.is_done;
  const id = slot.id;
  const start = escapeHtml(slot.start_time || '05:00');
  const end = escapeHtml(slot.end_time || '06:00');
  const title = escapeHtml(slot.title || '');
  return `<div class="pl-day-row${done ? ' done' : ''}${highlight ? ' now' : ''}" data-slot="${id}">
    ${showDone
      ? `<button type="button" class="pl-check${done ? ' on' : ''}" onclick="plannerToggleDaySlot('${id}')" aria-label="Bajarildi"></button>`
      : `<span class="pl-day-spacer"></span>`}
    <input type="time" class="pl-day-time" value="${start}" onchange="plannerSaveSlotField('${id}', 'start_time', this.value)">
    <span class="pl-day-dash">–</span>
    <input type="time" class="pl-day-time" value="${end}" onchange="plannerSaveSlotField('${id}', 'end_time', this.value)">
    <input type="text" class="pl-day-task" value="${title}" placeholder="${escapeHtml(plannerT('planner.slotPh', 'Vazifa…'))}"
      onblur="plannerSaveSlotField('${id}', 'title', this.value)"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
    <button type="button" class="pl-del" onclick="plannerDeleteDaySlot('${id}')" title="O'chirish">×</button>
  </div>`;
}

function renderPlannerDaily() {
  const isTpl = state.plannerDayMode === 'template';
  const date = state.plannerDayDate || todayISO();
  const slots = plannerSlotsFor(isTpl ? null : date);
  const today = todayISO();
  const highlightNow = !isTpl && date === today;
  const doneCount = slots.filter(s => s.is_done).length;
  const rows = slots.length
    ? slots.map(s => plannerDayRowHtml(s, !isTpl, highlightNow && plannerSlotIsNow(s))).join('')
    : `<p class="pl-empty">${escapeHtml(plannerT('planner.emptyDay', 'Qator yo\'q — shablon yarating yoki qator qo\'shing'))}</p>`;
  return `
    <div class="pl-day-toolbar">
      <div class="pl-day-modes">
        <button type="button" class="pl-tab${!isTpl ? ' active' : ''}" onclick="plannerSetDayMode('day')">${escapeHtml(plannerT('planner.dayView', 'Kun'))}</button>
        <button type="button" class="pl-tab${isTpl ? ' active' : ''}" onclick="plannerSetDayMode('template')">${escapeHtml(plannerT('planner.template', 'Shablon'))}</button>
      </div>
      ${isTpl ? '' : `<label class="pl-day-date">${escapeHtml(plannerT('planner.pickDate', 'Sana'))}
        <input type="date" value="${escapeHtml(date)}" onchange="plannerSetDayDate(this.value)">
      </label>`}
      ${isTpl ? `<span class="pl-day-hint">${escapeHtml(plannerT('planner.templateHint', 'Har kuni shu soatlar va vazifalar nusxa olinadi. Vaqtni qo\'lda o\'zgartiring.'))}</span>`
        : `<span class="pl-day-hint">${doneCount}/${slots.length} ${escapeHtml(plannerT('planner.doneShort', 'bajarildi'))}</span>`}
    </div>
    <div class="pl-day-actions">
      ${isTpl ? '' : `<button type="button" class="btn-outline" onclick="plannerSaveCurrentAsTemplate()">${escapeHtml(plannerT('planner.saveTemplate', 'Shablon qilib saqlash'))}</button>
      <button type="button" class="btn-ghost" onclick="plannerResetDayFromTemplate()">${escapeHtml(plannerT('planner.resetFromTemplate', 'Shablondan tiklash'))}</button>`}
      <button type="button" class="btn-ghost" onclick="plannerAddDaySlot()">${escapeHtml(plannerT('planner.addSlot', 'Qator qo\'shish'))}</button>
    </div>
    <div class="pl-day-list">${rows}</div>`;
}

async function loadPlannerData() {
  ensurePlannerState();
  if (!plannerOwnerId()) {
    state.plannerTasks = [];
    state.plannerGoals = [];
    state.focusSessions = [];
    state.plannerDaySlots = [];
    return;
  }
  const [tasks, goals, sessions, daySlots] = await Promise.all([
    fetchPlannerTasks(),
    fetchPlannerGoals(),
    fetchFocusSessions(),
    fetchPlannerDaySlots(todayISO())
  ]);
  state.plannerTasks = tasks;
  state.plannerGoals = goals;
  state.focusSessions = sessions;
  state.plannerDaySlots = daySlots;
  state._plannerLoaded = true;
  await plannerEnsureTemplate();
  await plannerEnsureDay(state.plannerDayDate || todayISO());
}

/* ---------- CRUD (optimistic) ---------- */
async function plannerInsertRow(table, localKey, row, listKey, skipRender) {
  const uid = plannerOwnerId();
  if (!uid) { toast(plannerT('planner.needProfile', 'Profil topilmadi')); return null; }
  row.user_id = uid;
  ensurePlannerState();
  state[listKey] = (state[listKey] || []).concat([row]);
  if (!skipRender) renderPlannerView();

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
    if (!skipRender) renderPlannerView();
    toast('Xatolik: ' + error.message);
    return null;
  }
  state[listKey] = (state[listKey] || []).map(x => x.id === row.id ? data : x);
  if (!skipRender) renderPlannerView();
  return data;
}

async function plannerPatchRow(table, localKey, listKey, id, patch, skipRender) {
  ensurePlannerState();
  const list = state[listKey] || [];
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return false;
  const prev = Object.assign({}, list[idx]);
  list[idx] = Object.assign({}, list[idx], patch);
  if (!skipRender) renderPlannerView();

  if (usingLocalFallback) {
    const all = plannerLocalGet(localKey).map(x => x.id === id ? Object.assign({}, x, patch) : x);
    plannerLocalSet(localKey, all);
    return true;
  }
  const { error } = await sb.from(table).update(patch).eq('id', id).eq('user_id', plannerOwnerId());
  if (error) {
    list[idx] = prev;
    if (!skipRender) renderPlannerView();
    toast('Xatolik: ' + error.message);
    return false;
  }
  return true;
}

async function plannerRemoveRow(table, localKey, listKey, id, skipRender) {
  ensurePlannerState();
  const list = state[listKey] || [];
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return;
  const prev = list[idx];
  list.splice(idx, 1);
  if (!skipRender) renderPlannerView();

  if (usingLocalFallback) {
    plannerLocalSet(localKey, plannerLocalGet(localKey).filter(x => x.id !== id));
    return;
  }
  const { error } = await sb.from(table).delete().eq('id', id).eq('user_id', plannerOwnerId());
  if (error) {
    state[listKey].splice(idx, 0, prev);
    if (!skipRender) renderPlannerView();
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
  if (tab === 'daily') {
    plannerEnsureDayView();
    return;
  }
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
    { id: 'daily', label: plannerT('planner.tabDaily', '⏰ Kunlik') },
    { id: 'today', label: plannerT('planner.tabToday', '📅 Bugun') },
    { id: 'scheduled', label: plannerT('planner.tabSched', '🗓 Rejalashtirilgan') },
    { id: 'inbox', label: plannerT('planner.tabInbox', '📥 Muddatisiz') },
    { id: 'goals', label: plannerT('planner.tabGoals', '🎯 Maqsadlar') }
  ];
  const defaultDate = tab === 'scheduled' ? plannerAddDays(todayISO(), 1) : (tab === 'inbox' || tab === 'goals' ? '' : todayISO());
  const body = tab === 'daily' ? renderPlannerDaily()
    : tab === 'today' ? renderPlannerToday()
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

  const composer = tab === 'daily' ? '' : `
      <div class="pl-composer">
        <input type="text" id="planner-composer" placeholder="${escapeHtml(plannerComposerPlaceholder())}" autocomplete="off" onkeydown="plannerOnComposerKey(event)">
        <label class="pl-cal" title="${escapeHtml(plannerT('planner.pickDate', 'Sana'))}">📅
          <input type="date" id="planner-composer-date" value="${escapeHtml(defaultDate)}">
        </label>
        <button type="button" class="btn-blue" onclick="plannerAddFromComposer()">${escapeHtml(plannerT('planner.add', 'Qo\'shish'))}</button>
      </div>`;

  root.innerHTML = `
    <div class="planner-page">
      <div class="pl-head">
        <div>
          <h2 class="pl-title">${escapeHtml(plannerT('planner.title', '🎯 Planner'))}</h2>
          <p class="pl-sub">${escapeHtml(tab === 'daily'
            ? plannerT('planner.daySub', '24 soatlik kundalik reja — vaqt va vazifani o\'zgartiring, bajarilganini belgilang')
            : plannerT('planner.sub', 'Faqat sizga ko\'rinadigan shaxsiy vazifalar va fokus'))}</p>
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
      ${composer}
      <div class="pl-body">${body}</div>
    </div>`;
  plannerPaintFocus();
}

async function openPlannerView() {
  ensurePlannerState();
  if (!state._plannerLoaded) {
    await loadPlannerData();
    state._plannerLoaded = true;
  }
  renderPlannerView();
}
