/* =========================================================
   LOYIHALAR — Trello-uslubidagi mustaqil modul
   Global helpers: state, sb, currentProfile, toast, escapeHtml,
   userById, userAvatarHtml, getExecutors, initials, uid,
   toDatetimeLocal, fromDatetimeLocal, formatDeadlineDisplay,
   priorityClass, t, isAdmin, usingLocalFallback, closeModal
========================================================= */

const LOCAL_KEY_PROJECTS = 'tm_local_projects';
const LOCAL_KEY_PROJECT_COLUMNS = 'tm_local_project_columns';
const LOCAL_KEY_PROJECT_CARDS = 'tm_local_project_cards';
const LOCAL_KEY_PROJECT_MEMBERS = 'tm_local_project_members';

const PROJECT_COLORS = [
  { id: '#3B82F6', label: 'Ko\'k' },
  { id: '#10B981', label: 'Yashil' },
  { id: '#F59E0B', label: 'Sariq' },
  { id: '#EF4444', label: 'Qizil' },
  { id: '#8B5CF6', label: 'Binafsha' },
  { id: '#06B6D4', label: 'Moviy' }
];
const PROJECT_ICONS = ['📋', '🚀', '🎯', '💡', '📦', '🔥', '⭐', '🛠️'];
const DEFAULT_COLUMNS = [
  { name: 'Rejalashtirilgan', position: 0, color: '#64748B', is_done_column: false },
  { name: 'Jarayonda', position: 1, color: '#3B82F6', is_done_column: false },
  { name: 'Bajarildi', position: 2, color: '#10B981', is_done_column: true }
];

let projectChart = null;
let projectDrag = { cardId: null, fromColumnId: null };

function ensureProjectState() {
  if (!state.projects) state.projects = [];
  if (!state.projectColumns) state.projectColumns = [];
  if (!state.projectCards) state.projectCards = [];
  if (!state.projectMembers) state.projectMembers = [];
  if (!state.projectView) state.projectView = 'list'; // list | board | progress
  if (state.activeProjectId === undefined) state.activeProjectId = null;
}

function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return uid().replace(/^id_/, '00000000-0000-4000-8000-');
}

function canManageProject(project) {
  if (!project || !currentProfile) return false;
  if (isAdmin()) return true;
  return project.owner_user_id === currentProfile.id;
}

function isProjectMemberLocal(projectId) {
  if (!currentProfile) return false;
  const p = (state.projects || []).find(x => x.id === projectId);
  if (!p) return false;
  if (isAdmin() || p.owner_user_id === currentProfile.id) return true;
  return (state.projectMembers || []).some(m => m.project_id === projectId && m.user_id === currentProfile.id);
}

function visibleProjects() {
  ensureProjectState();
  return (state.projects || []).filter(p =>
    !p.deleted_at &&
    p.status !== 'archived' &&
    isProjectMemberLocal(p.id)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uz'));
}

function projectMembersOf(projectId) {
  const p = (state.projects || []).find(x => x.id === projectId);
  const memberIds = new Set(
    (state.projectMembers || []).filter(m => m.project_id === projectId).map(m => m.user_id)
  );
  if (p?.owner_user_id) memberIds.add(p.owner_user_id);
  return Array.from(memberIds).map(id => userById(id)).filter(Boolean);
}

function projectCardsOf(projectId) {
  return (state.projectCards || [])
    .filter(c => c.project_id === projectId && !c.deleted_at)
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function projectColumnsOf(projectId) {
  return (state.projectColumns || [])
    .filter(c => c.project_id === projectId)
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function isDoneColumn(col) {
  if (!col) return false;
  if (col.is_done_column === true || col.is_done_column === 'true' || col.is_done_column === 1) return true;
  const n = String(col.name || '').trim().toLowerCase();
  return n === 'bajarildi' || n === 'done' || n === 'готово' || /bajaril/.test(n);
}

function doneColumnIds(projectId) {
  return new Set(projectColumnsOf(projectId).filter(isDoneColumn).map(c => c.id));
}

function isProjectCardDone(card) {
  if (!card || card.deleted_at) return false;
  if (card.completed_at) return true;
  return doneColumnIds(card.project_id).has(card.column_id);
}

function projectCardToCompletedTask(card) {
  const project = (state.projects || []).find(p => p.id === card.project_id);
  const assignee = userById(card.assignee_user_id) || (project ? userById(project.owner_user_id) : null);
  const projectName = project?.name || (typeof t === 'function' ? t('nav.projects') : 'Loyiha');
  return {
    id: 'pcard_' + card.id,
    project_card_id: card.id,
    project_id: card.project_id,
    is_project_card: true,
    title: card.title,
    assignee: assignee?.display_name || '',
    assignee_user_id: card.assignee_user_id || project?.owner_user_id || null,
    created_by_user_id: project?.owner_user_id || null,
    priority: card.priority || '',
    deadline: card.deadline || null,
    status: 'bajarildi',
    comment: '📋 ' + projectName,
    created_at: card.created_at,
    completed_at: card.completed_at || card.created_at || new Date().toISOString(),
    deleted_at: null
  };
}

function completedProjectCardTasks() {
  ensureProjectState();
  return (state.projectCards || [])
    .filter(isProjectCardDone)
    .map(projectCardToCompletedTask);
}

function projectCardTaskMarker(cardId) {
  return '[pcard:' + cardId + ']';
}

function findTaskForProjectCard(cardId) {
  if (!cardId) return null;
  const marker = projectCardTaskMarker(cardId);
  const matches = (state.tasks || []).filter(t => {
    if (!t) return false;
    if (t.project_card_id === cardId) return true;
    if (String(t.id) === 'pcard_' + cardId) return true;
    return String(t.comment || '').includes(marker);
  });
  return matches.find(t => !t.deleted_at) || matches[0] || null;
}

function buildProjectCardTaskPayload(card) {
  const project = (state.projects || []).find(p => p.id === card.project_id);
  const assigneeUser = (typeof userById === 'function' ? userById(card.assignee_user_id) : null)
    || currentProfile;
  const projectName = (project && project.name) || 'Loyiha';
  const now = new Date().toISOString();
  return {
    assignee_user_id: (assigneeUser && assigneeUser.id) || currentProfile.id,
    assignee: (assigneeUser && assigneeUser.display_name) || currentProfile.display_name || '—',
    created_by_user_id: currentProfile.id,
    reviewer_user_id: currentProfile.id,
    title: card.title || 'Loyiha vazifasi',
    priority: card.priority || '',
    deadline: card.deadline || null,
    status: 'bajarildi',
    start_date: (typeof todayISO === 'function' ? todayISO() : now.slice(0, 10)),
    comment: '📋 ' + projectName + '\n' + projectCardTaskMarker(card.id),
    completed_at: card.completed_at || now,
    project_card_id: card.id
  };
}

function applyTaskToState(row) {
  if (!row || !row.id) return;
  const i = state.tasks.findIndex(t => t.id === row.id);
  if (i > -1) state.tasks[i] = Object.assign({}, state.tasks[i], row);
  else state.tasks.push(row);
}

async function syncProjectCardCompletion(card, isDone) {
  if (!card || !currentProfile || typeof insertTask !== 'function') return;
  const existing = findTaskForProjectCard(card.id);
  if (isDone) {
    const payload = buildProjectCardTaskPayload(card);
    if (existing) {
      const patch = {
        title: payload.title,
        assignee: payload.assignee,
        assignee_user_id: payload.assignee_user_id,
        priority: payload.priority,
        deadline: payload.deadline,
        status: 'bajarildi',
        comment: payload.comment,
        completed_at: payload.completed_at
      };
      if (existing.deleted_at) patch.deleted_at = null;
      await updateTask(existing.id, patch);
      applyTaskToState(Object.assign({}, existing, patch, { deleted_at: null }));
    } else {
      let row = await insertTask(payload, { silent: true });
      if (!row && payload.project_card_id) {
        const { project_card_id, ...rest } = payload;
        row = await insertTask(rest, { silent: false });
      }
      if (row) applyTaskToState(row);
    }
  } else if (existing && !existing.deleted_at) {
    await deleteTaskRow(existing.id);
    applyTaskToState(Object.assign({}, existing, { deleted_at: new Date().toISOString() }));
  }
}

async function backfillCompletedProjectCardTasks() {
  if (!currentProfile || typeof insertTask !== 'function') return;
  const cards = (state.projectCards || []).filter(isProjectCardDone);
  for (const card of cards) {
    if (findTaskForProjectCard(card.id)) continue;
    await syncProjectCardCompletion(card, true);
  }
}

function refreshTaskSurfacesFromProjects() {
  if (typeof renderAll === 'function') {
    renderAll();
    return;
  }
  if (typeof renderExecCards === 'function') renderExecCards();
  if (typeof renderTaskList === 'function') renderTaskList();
  if (typeof renderOutgoingList === 'function') renderOutgoingList();
  const smartPane = document.getElementById('view-smart');
  if (smartPane && smartPane.classList.contains('active') && typeof renderSmartAnalytics === 'function') {
    renderSmartAnalytics();
  }
}

function projectProgressPct(projectId) {
  const cards = projectCardsOf(projectId);
  if (!cards.length) return 0;
  const done = doneColumnIds(projectId);
  const n = cards.filter(c => done.has(c.column_id)).length;
  return Math.round((n / cards.length) * 100);
}

function cardDeadlineInfo(card, projectId) {
  const done = doneColumnIds(projectId || card.project_id);
  if (done.has(card.column_id)) return { text: t('status.bajarildi') || 'Bajarildi', cls: '' };
  if (!card.deadline) return { text: '', cls: '' };
  const now = new Date();
  const dl = new Date(card.deadline);
  if (isNaN(dl.getTime())) return { text: String(card.deadline), cls: '' };
  const diffMs = dl - now;
  const absMs = Math.abs(diffMs);
  const hours = Math.floor(absMs / 3600000);
  const days = Math.floor(absMs / 86400000);
  if (diffMs >= 0) {
    if (hours < 1) return { text: (t('time.lt1h') || '<1 soat') + ' qoldi', cls: 'today' };
    if (hours < 24) return { text: hours + ' ' + (t('time.hour') || 'soat') + ' qoldi', cls: 'today' };
    return { text: days + ' ' + (t('time.day') || 'kun') + ' qoldi', cls: '' };
  }
  if (hours < 24) return { text: hours + ' ' + (t('time.hour') || 'soat') + ' ' + (t('time.passed') || "o'tdi"), cls: 'overdue' };
  return { text: days + ' ' + (t('time.day') || 'kun') + ' ' + (t('time.passed') || "o'tdi"), cls: 'overdue' };
}

/* ---------- Local storage helpers ---------- */
function localGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
}
function localSet(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

/* ---------- Fetch ---------- */
async function fetchProjects() {
  ensureProjectState();
  if (usingLocalFallback) {
    return localGet(LOCAL_KEY_PROJECTS).filter(p => !p.deleted_at);
  }
  const { data, error } = await sb.from('projects').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    if (/relation.*does not exist|Could not find the table/i.test(error.message || '')) {
      toast("Loyihalar jadvali yo'q — supabase_schema.sql ni ishga tushiring");
    } else {
      toast("Loyihalarni olishda xatolik: " + error.message);
    }
    return [];
  }
  return data || [];
}

async function fetchProjectMembers(projectId) {
  if (usingLocalFallback) {
    const all = localGet(LOCAL_KEY_PROJECT_MEMBERS);
    return projectId ? all.filter(m => m.project_id === projectId) : all;
  }
  let q = sb.from('project_members').select('*');
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}

async function fetchProjectColumns(projectId) {
  if (usingLocalFallback) {
    return localGet(LOCAL_KEY_PROJECT_COLUMNS)
      .filter(c => !projectId || c.project_id === projectId)
      .sort((a, b) => a.position - b.position);
  }
  let q = sb.from('project_columns').select('*').order('position', { ascending: true });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}

async function fetchProjectCards(projectId) {
  if (usingLocalFallback) {
    return localGet(LOCAL_KEY_PROJECT_CARDS)
      .filter(c => !c.deleted_at && (!projectId || c.project_id === projectId))
      .sort((a, b) => a.position - b.position);
  }
  let q = sb.from('project_cards').select('*').is('deleted_at', null).order('position', { ascending: true });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return (data || []).filter(c => !c.deleted_at);
}

async function fetchDeletedProjects() {
  if (!isAdmin()) return [];
  if (usingLocalFallback) {
    return localGet(LOCAL_KEY_PROJECTS).filter(p => !!p.deleted_at);
  }
  const { data, error } = await sb.from('projects').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

async function loadAllProjectData() {
  ensureProjectState();
  state.projects = await fetchProjects();
  state.projectMembers = await fetchProjectMembers();
  state.projectColumns = await fetchProjectColumns();
  state.projectCards = await fetchProjectCards();
  if (typeof backfillCompletedProjectCardTasks === 'function') {
    await backfillCompletedProjectCardTasks();
  }
}

/* ---------- CRUD ---------- */
async function createProject(payload, memberIds) {
  const ownerId = currentProfile?.id;
  if (!ownerId) { toast('Profil topilmadi'); return null; }
  const project = {
    id: newUuid(),
    name: payload.name,
    description: payload.description || '',
    color: payload.color || PROJECT_COLORS[0].id,
    icon: payload.icon || '📋',
    is_personal: !!payload.is_personal,
    owner_user_id: ownerId,
    status: 'active',
    deleted_at: null,
    created_at: new Date().toISOString()
  };

  if (usingLocalFallback) {
    const projects = localGet(LOCAL_KEY_PROJECTS);
    projects.push(project);
    localSet(LOCAL_KEY_PROJECTS, projects);
    const members = localGet(LOCAL_KEY_PROJECT_MEMBERS);
    members.push({ project_id: project.id, user_id: ownerId, role: 'owner', created_at: project.created_at });
    if (!project.is_personal) {
      (memberIds || []).forEach(uid => {
        if (uid !== ownerId) members.push({ project_id: project.id, user_id: uid, role: 'member', created_at: project.created_at });
      });
    }
    localSet(LOCAL_KEY_PROJECT_MEMBERS, members);
    const cols = localGet(LOCAL_KEY_PROJECT_COLUMNS);
    DEFAULT_COLUMNS.forEach(c => {
      cols.push(Object.assign({ id: newUuid(), project_id: project.id, created_at: project.created_at }, c));
    });
    localSet(LOCAL_KEY_PROJECT_COLUMNS, cols);
  } else {
    const { data, error } = await sb.from('projects').insert([{
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      is_personal: project.is_personal,
      owner_user_id: ownerId,
      status: 'active'
    }]).select('*').single();
    if (error) { toast('Xatolik: ' + error.message); return null; }
    project.id = data.id;
    project.created_at = data.created_at;
    const memberRows = [{ project_id: project.id, user_id: ownerId, role: 'owner' }];
    if (!project.is_personal) {
      (memberIds || []).forEach(uid => {
        if (uid !== ownerId) memberRows.push({ project_id: project.id, user_id: uid, role: 'member' });
      });
    }
    const { error: mErr } = await sb.from('project_members').insert(memberRows);
    if (mErr) console.error(mErr);
    const colRows = DEFAULT_COLUMNS.map(c => Object.assign({ project_id: project.id }, c));
    const { error: cErr } = await sb.from('project_columns').insert(colRows);
    if (cErr) { toast('Ustunlar yaratilmadi: ' + cErr.message); }
  }

  await loadAllProjectData();
  renderProjectsView();
  toast('Loyiha yaratildi');
  try {
    await notifyProjectCreated(project, memberIds || []);
  } catch (e) { console.error(e); }
  return project;
}

async function notifyProjectCreated(project, memberIds) {
  if (typeof notifyUser !== 'function') return;
  const creator = currentProfile?.display_name || 'Yaratuvchi';
  const typeLabel = project.is_personal ? 'Shaxsiy' : 'Jamoaviy';
  const desc = project.description ? `\n${project.description}` : '';
  const text =
    `${project.icon || '📋'} <b>Yangi loyiha</b>\n\n` +
    `<b>${project.name}</b> (${typeLabel})${desc}\n\n` +
    `Yaratuvchi: ${creator}`;

  const recipientIds = new Set([project.owner_user_id, ...(memberIds || [])]);
  let sent = 0;
  for (const uid of recipientIds) {
    if (!uid || uid === currentProfile?.id) continue; // yaratuvchiga o'ziga yubormaymiz
    const user = typeof userById === 'function' ? userById(uid) : null;
    if (!user) continue;
    const ok = await notifyUser(user, text);
    if (ok) sent++;
  }
  // Asosiy monitoring chatga ham (task yaratilgandagi umumiy kanal kabi)
  if (typeof sendTelegram === 'function' && state.settings?.telegram_chat_id) {
    await sendTelegram(text);
  } else if (!sent && recipientIds.size <= 1) {
    // faqat egasi — personal loyiha; chat sozlanmagan bo'lsa jim
  }
}

async function updateProject(id, patch) {
  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECTS);
    const idx = list.findIndex(p => p.id === id);
    if (idx > -1) list[idx] = Object.assign({}, list[idx], patch);
    localSet(LOCAL_KEY_PROJECTS, list);
  } else {
    const { error } = await sb.from('projects').update(patch).eq('id', id);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  const i = state.projects.findIndex(p => p.id === id);
  if (i > -1) state.projects[i] = Object.assign({}, state.projects[i], patch);
  else await loadAllProjectData();
  renderProjectsView();
}

async function deleteProject(id) {
  const deleted_at = new Date().toISOString();
  await updateProject(id, { deleted_at });
  if (state.activeProjectId === id) {
    state.activeProjectId = null;
    state.projectView = 'list';
  }
  toast("Loyiha o'chirildi (tiklash mumkin)");
}

async function restoreProject(id) {
  if (!isAdmin()) return;
  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECTS);
    const idx = list.findIndex(p => p.id === id);
    if (idx > -1) {
      const row = Object.assign({}, list[idx]);
      delete row.deleted_at;
      row.status = 'active';
      list[idx] = row;
    }
    localSet(LOCAL_KEY_PROJECTS, list);
  } else {
    const { error } = await sb.from('projects').update({ deleted_at: null, status: 'active' }).eq('id', id);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  await loadAllProjectData();
  renderDeletedProjectsPanel();
  toast('Loyiha tiklandi');
}

async function archiveProject(id) {
  await updateProject(id, { status: 'archived' });
  if (state.activeProjectId === id) {
    state.activeProjectId = null;
    state.projectView = 'list';
  }
  toast('Loyiha arxivlandi');
}

async function setProjectMembers(projectId, memberIds) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p || !canManageProject(p)) return;
  const ownerId = p.owner_user_id;
  const ids = Array.from(new Set([ownerId, ...(memberIds || [])]));

  if (usingLocalFallback) {
    let members = localGet(LOCAL_KEY_PROJECT_MEMBERS).filter(m => m.project_id !== projectId);
    ids.forEach(uid => {
      members.push({
        project_id: projectId,
        user_id: uid,
        role: uid === ownerId ? 'owner' : 'member',
        created_at: new Date().toISOString()
      });
    });
    localSet(LOCAL_KEY_PROJECT_MEMBERS, members);
  } else {
    await sb.from('project_members').delete().eq('project_id', projectId);
    const rows = ids.map(uid => ({
      project_id: projectId,
      user_id: uid,
      role: uid === ownerId ? 'owner' : 'member'
    }));
    const { error } = await sb.from('project_members').insert(rows);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  state.projectMembers = await fetchProjectMembers();
  renderProjectsView();
  toast('A\'zolar yangilandi');
}

async function createColumn(projectId, name, color) {
  const cols = projectColumnsOf(projectId);
  const position = cols.length ? Math.max(...cols.map(c => c.position || 0)) + 1 : 0;
  const row = {
    id: newUuid(),
    project_id: projectId,
    name: name || 'Yangi ustun',
    position,
    color: color || '#64748B',
    is_done_column: false,
    created_at: new Date().toISOString()
  };
  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECT_COLUMNS);
    list.push(row);
    localSet(LOCAL_KEY_PROJECT_COLUMNS, list);
  } else {
    const { data, error } = await sb.from('project_columns').insert([{
      project_id: projectId, name: row.name, position, color: row.color, is_done_column: false
    }]).select('*').single();
    if (error) { toast('Xatolik: ' + error.message); return null; }
    row.id = data.id;
  }
  state.projectColumns.push(row);
  renderProjectsView();
  return row;
}

async function updateColumn(id, patch) {
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'name') && (typeof isAdmin !== 'function' || !isAdmin())) {
    toast("Ustun nomini faqat admin o'zgartira oladi");
    return;
  }
  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECT_COLUMNS);
    const idx = list.findIndex(c => c.id === id);
    if (idx > -1) list[idx] = Object.assign({}, list[idx], patch);
    localSet(LOCAL_KEY_PROJECT_COLUMNS, list);
  } else {
    const { error } = await sb.from('project_columns').update(patch).eq('id', id);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  const i = state.projectColumns.findIndex(c => c.id === id);
  if (i > -1) state.projectColumns[i] = Object.assign({}, state.projectColumns[i], patch);
  renderProjectsView();
}

async function deleteColumn(id) {
  const col = state.projectColumns.find(c => c.id === id);
  if (!col) return;
  const cards = projectCardsOf(col.project_id).filter(c => c.column_id === id);
  if (cards.length && !confirm('Ustunda kartochkalar bor. O\'chirishni tasdiqlaysizmi? Kartochkalar ham o\'chiriladi.')) return;

  if (usingLocalFallback) {
    localSet(LOCAL_KEY_PROJECT_COLUMNS, localGet(LOCAL_KEY_PROJECT_COLUMNS).filter(c => c.id !== id));
    const deleted_at = new Date().toISOString();
    const cardsAll = localGet(LOCAL_KEY_PROJECT_CARDS).map(c =>
      c.column_id === id ? Object.assign({}, c, { deleted_at }) : c
    );
    localSet(LOCAL_KEY_PROJECT_CARDS, cardsAll);
  } else {
    const deleted_at = new Date().toISOString();
    await sb.from('project_cards').update({ deleted_at }).eq('column_id', id);
    const { error } = await sb.from('project_columns').delete().eq('id', id);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  state.projectColumns = state.projectColumns.filter(c => c.id !== id);
  state.projectCards = state.projectCards.filter(c => c.column_id !== id);
  renderProjectsView();
  toast("Ustun o'chirildi");
}

async function markDoneColumn(columnId) {
  const col = state.projectColumns.find(c => c.id === columnId);
  if (!col) return;
  const siblings = projectColumnsOf(col.project_id);
  for (const s of siblings) {
    if (s.is_done_column && s.id !== columnId) await updateColumn(s.id, { is_done_column: false });
  }
  await updateColumn(columnId, { is_done_column: true });
}

async function createCard(projectId, columnId, payload) {
  const inCol = projectCardsOf(projectId).filter(c => c.column_id === columnId);
  const position = inCol.length ? Math.max(...inCol.map(c => c.position || 0)) + 1 : 0;
  const row = {
    id: newUuid(),
    project_id: projectId,
    column_id: columnId,
    title: payload.title || 'Yangi kartochka',
    description: payload.description || '',
    assignee_user_id: payload.assignee_user_id || null,
    priority: payload.priority || '',
    deadline: payload.deadline || null,
    position,
    deleted_at: null,
    completed_at: null,
    created_at: new Date().toISOString()
  };
  const done = doneColumnIds(projectId);
  if (done.has(columnId)) row.completed_at = new Date().toISOString();

  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECT_CARDS);
    list.push(row);
    localSet(LOCAL_KEY_PROJECT_CARDS, list);
  } else {
    const { data, error } = await sb.from('project_cards').insert([{
      project_id: projectId,
      column_id: columnId,
      title: row.title,
      description: row.description,
      assignee_user_id: row.assignee_user_id,
      priority: row.priority,
      deadline: row.deadline,
      position,
      completed_at: row.completed_at
    }]).select('*').single();
    if (error) { toast('Xatolik: ' + error.message); return null; }
    row.id = data.id;
    row.created_at = data.created_at;
  }
  state.projectCards.push(row);
  renderProjectsView();
  if (done.has(columnId)) await syncProjectCardCompletion(row, true);
  refreshTaskSurfacesFromProjects();
  return row;
}

async function updateCard(id, patch) {
  if (usingLocalFallback) {
    const list = localGet(LOCAL_KEY_PROJECT_CARDS);
    const idx = list.findIndex(c => c.id === id);
    if (idx > -1) list[idx] = Object.assign({}, list[idx], patch);
    localSet(LOCAL_KEY_PROJECT_CARDS, list);
  } else {
    const { error } = await sb.from('project_cards').update(patch).eq('id', id);
    if (error) { toast('Xatolik: ' + error.message); return; }
  }
  const i = state.projectCards.findIndex(c => c.id === id);
  if (i > -1) state.projectCards[i] = Object.assign({}, state.projectCards[i], patch);
  renderProjectsView();
  refreshTaskSurfacesFromProjects();
}

async function deleteCard(id) {
  const card = state.projectCards.find(c => c.id === id);
  const deleted_at = new Date().toISOString();
  await updateCard(id, { deleted_at });
  state.projectCards = state.projectCards.filter(c => c.id !== id);
  if (card) await syncProjectCardCompletion(card, false);
  toast("Kartochka o'chirildi");
}

async function moveCard(cardId, toColumnId, toIndex) {
  const card = state.projectCards.find(c => c.id === cardId);
  if (!card) return;
  const projectId = card.project_id;
  const fromColumnId = card.column_id;
  const done = doneColumnIds(projectId);
  const wasDone = done.has(fromColumnId);
  const willDone = done.has(toColumnId);

  let siblings = projectCardsOf(projectId)
    .filter(c => c.column_id === toColumnId && c.id !== cardId)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = Math.max(0, Math.min(toIndex == null ? siblings.length : toIndex, siblings.length));
  siblings.splice(idx, 0, card);

  const patchCompleted = {};
  if (!wasDone && willDone) patchCompleted.completed_at = new Date().toISOString();
  if (wasDone && !willDone) patchCompleted.completed_at = null;

  const updates = siblings.map((c, i) => ({
    id: c.id,
    column_id: toColumnId,
    position: i,
    ...(c.id === cardId ? patchCompleted : {})
  }));

  for (const u of updates) {
    const { id, ...patch } = u;
    if (usingLocalFallback) {
      const list = localGet(LOCAL_KEY_PROJECT_CARDS);
      const ix = list.findIndex(x => x.id === id);
      if (ix > -1) list[ix] = Object.assign({}, list[ix], patch);
      localSet(LOCAL_KEY_PROJECT_CARDS, list);
    } else {
      await sb.from('project_cards').update(patch).eq('id', id);
    }
    const si = state.projectCards.findIndex(x => x.id === id);
    if (si > -1) state.projectCards[si] = Object.assign({}, state.projectCards[si], patch);
  }

  // Reindex previous column
  if (fromColumnId !== toColumnId) {
    const prev = projectCardsOf(projectId)
      .filter(c => c.column_id === fromColumnId && c.id !== cardId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].position === i) continue;
      await updateCard(prev[i].id, { position: i });
    }
  }
  renderProjectsView();
  if (wasDone !== willDone) {
    const updated = state.projectCards.find(c => c.id === cardId);
    if (updated) await syncProjectCardCompletion(updated, willDone);
  }
  refreshTaskSurfacesFromProjects();
}
function applyRealtimeProjectChange(table, payload) {
  ensureProjectState();
  const { eventType, new: newRow, old: oldRow } = payload;
  const keyMap = {
    projects: 'projects',
    project_columns: 'projectColumns',
    project_cards: 'projectCards',
    project_members: 'projectMembers'
  };
  const key = keyMap[table];
  if (!key) return;
  const list = state[key];

  if (table === 'projects' || table === 'project_cards') {
    if (eventType === 'INSERT') {
      if (newRow.deleted_at) return;
      if (!list.some(x => x.id === newRow.id)) list.push(newRow);
    } else if (eventType === 'UPDATE') {
      const idx = list.findIndex(x => x.id === newRow.id);
      if (newRow.deleted_at) {
        if (idx > -1) list.splice(idx, 1);
        if (table === 'projects' && state.activeProjectId === newRow.id) {
          state.activeProjectId = null;
          state.projectView = 'list';
        }
      } else if (idx > -1) list[idx] = newRow;
      else list.push(newRow);
    } else if (eventType === 'DELETE') {
      const id = oldRow && oldRow.id;
      const idx = list.findIndex(x => x.id === id);
      if (idx > -1) list.splice(idx, 1);
    }
  } else if (table === 'project_columns') {
    if (eventType === 'INSERT') {
      if (!list.some(x => x.id === newRow.id)) list.push(newRow);
    } else if (eventType === 'UPDATE') {
      const idx = list.findIndex(x => x.id === newRow.id);
      if (idx > -1) list[idx] = newRow;
      else list.push(newRow);
    } else if (eventType === 'DELETE') {
      const idx = list.findIndex(x => x.id === (oldRow && oldRow.id));
      if (idx > -1) list.splice(idx, 1);
    }
  } else if (table === 'project_members') {
    if (eventType === 'INSERT') {
      if (!list.some(x => x.project_id === newRow.project_id && x.user_id === newRow.user_id)) list.push(newRow);
    } else if (eventType === 'UPDATE') {
      const idx = list.findIndex(x => x.project_id === newRow.project_id && x.user_id === newRow.user_id);
      if (idx > -1) list[idx] = newRow;
      else list.push(newRow);
    } else if (eventType === 'DELETE') {
      const idx = list.findIndex(x =>
        x.project_id === (oldRow && oldRow.project_id) && x.user_id === (oldRow && oldRow.user_id)
      );
      if (idx > -1) list.splice(idx, 1);
    }
  }

  const pane = document.getElementById('view-projects');
  if (pane && pane.classList.contains('active')) renderProjectsView();
  if (isAdmin()) renderDeletedProjectsPanel();
  if (table === 'project_cards' || table === 'project_columns') refreshTaskSurfacesFromProjects();
}

function subscribeProjectRealtime(channel) {
  if (!channel) return;
  ['projects', 'project_columns', 'project_cards', 'project_members'].forEach(table => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      applyRealtimeProjectChange(table, payload);
    });
  });
}

/* ---------- UI: List ---------- */
function openProjectsList() {
  state.projectView = 'list';
  state.activeProjectId = null;
  destroyProjectChart();
  renderProjectsView();
}

function openProjectBoard(projectId) {
  state.activeProjectId = projectId;
  state.projectView = 'board';
  destroyProjectChart();
  renderProjectsView();
}

function openProjectProgress(projectId) {
  state.activeProjectId = projectId || state.activeProjectId;
  state.projectView = 'progress';
  renderProjectsView();
}

function renderProjectsView() {
  ensureProjectState();
  const root = document.getElementById('projects-root');
  if (!root) return;
  if (state.projectView === 'board' && state.activeProjectId) {
    root.innerHTML = renderKanbanHtml(state.activeProjectId);
  } else if (state.projectView === 'progress' && state.activeProjectId) {
    root.innerHTML = renderProgressHtml(state.activeProjectId);
    requestAnimationFrame(() => drawProjectProgressChart(state.activeProjectId));
  } else {
    root.innerHTML = renderProjectsListHtml();
  }
}

function renderProjectsListHtml() {
  const projects = visibleProjects();
  const cards = projects.map(p => {
    const pct = projectProgressPct(p.id);
    const n = projectCardsOf(p.id).length;
    const members = projectMembersOf(p.id).slice(0, 5);
    const more = Math.max(0, projectMembersOf(p.id).length - members.length);
    const avatars = members.map(u => userAvatarHtml(u, 'proj-avatar')).join('');
    const menu = canManageProject(p) ? `
      <div class="proj-menu" onclick="event.stopPropagation()">
        <button type="button" class="proj-menu-btn" onclick="toggleProjMenu(event,'${p.id}')">⋯</button>
        <div class="proj-menu-drop hidden" id="proj-menu-${p.id}">
          <button type="button" onclick="archiveProject('${p.id}')">Arxivlash</button>
          <button type="button" class="danger" onclick="confirmDeleteProject('${p.id}')">O'chirish</button>
        </div>
      </div>` : '';
    return `
      <article class="proj-card" style="--proj-color:${escapeHtml(p.color)}" onclick="openProjectBoard('${p.id}')">
        <div class="proj-card-bar"></div>
        ${menu}
        <div class="proj-card-top">
          <span class="proj-card-icon">${escapeHtml(p.icon || '📋')}</span>
          <div>
            <h3>${escapeHtml(p.name)}</h3>
            <p class="proj-card-meta">${p.is_personal ? 'Shaxsiy' : 'Jamoaviy'} · ${n} ta vazifa</p>
          </div>
        </div>
        ${p.description ? `<p class="proj-card-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="proj-progress">
          <div class="proj-progress-track"><div class="proj-progress-fill" style="width:${pct}%"></div></div>
          <span>${pct}%</span>
        </div>
        <div class="proj-card-foot">
          <div class="proj-avatars">${avatars}${more ? `<span class="proj-avatar-more">+${more}</span>` : ''}</div>
        </div>
      </article>`;
  }).join('');

  return `
    <div class="proj-list-head">
      <div>
        <h2 class="proj-title">📋 Loyihalarim</h2>
        <p class="help-text" style="margin:4px 0 0;">Trello uslubidagi mustaqil loyihalar moduli</p>
      </div>
      <button type="button" class="btn-blue" onclick="openCreateProjectModal()">+ Yangi loyiha</button>
    </div>
    <div class="proj-grid">${cards || '<div class="empty-msg">Hali loyiha yo\'q. «+ Yangi loyiha» bosing.</div>'}</div>`;
}

function toggleProjMenu(ev, id) {
  ev.stopPropagation();
  document.querySelectorAll('.proj-menu-drop').forEach(el => {
    if (el.id !== 'proj-menu-' + id) el.classList.add('hidden');
  });
  const drop = document.getElementById('proj-menu-' + id);
  if (drop) drop.classList.toggle('hidden');
}

function confirmDeleteProject(id) {
  if (!confirm("Loyihani o'chirasizmi? Keyin admin tiklashi mumkin.")) return;
  deleteProject(id);
}

/* ---------- UI: Kanban ---------- */
function renderKanbanHtml(projectId) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p) return '<div class="empty-msg">Loyiha topilmadi</div>';
  const cols = projectColumnsOf(projectId);
  const manage = canManageProject(p);
  const membersBtn = (!p.is_personal && manage)
    ? `<button type="button" class="btn-ghost" onclick="openProjectMembersModal('${projectId}')">👥 A'zolar</button>`
    : '';

  const columnsHtml = cols.map(col => {
    const cards = projectCardsOf(projectId).filter(c => c.column_id === col.id);
    const adminRename = typeof isAdmin === 'function' && isAdmin();
    const nameCtrl = adminRename
      ? `<input class="pk-col-name" value="${escapeHtml(col.name)}"
            onchange="renameProjectColumn('${col.id}', this.value)"
            onclick="event.stopPropagation()" title="Ustun nomini o'zgartirish (admin)">`
      : `<span class="pk-col-name" title="Ustun nomini faqat admin o'zgartira oladi">${escapeHtml(col.name)}</span>`;
    const cardsHtml = cards.map(card => {
      const assignee = card.assignee_user_id ? userById(card.assignee_user_id) : null;
      const dl = cardDeadlineInfo(card, projectId);
      return `
        <div class="pk-card ${priorityClass(card.priority)}" draggable="true"
          data-card-id="${card.id}" data-column-id="${col.id}"
          ondragstart="onProjectCardDragStart(event)"
          ondragend="onProjectCardDragEnd(event)"
          onclick="openEditProjectCardModal('${card.id}')">
          <div class="pk-card-title">${escapeHtml(card.title)}</div>
          <div class="pk-card-meta">
            ${assignee ? userAvatarHtml(assignee, 'proj-avatar sm') : ''}
            ${dl.text ? `<span class="deadline-tag ${dl.cls}">${escapeHtml(dl.text)}</span>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="pk-col" data-column-id="${col.id}"
        ondragover="onProjectColDragOver(event)"
        ondrop="onProjectColDrop(event,'${col.id}')">
        <div class="pk-col-head">
          <span class="pk-col-dot" style="background:${escapeHtml(col.color)}"></span>
          ${nameCtrl}
          <span class="pk-col-count">${cards.length}</span>
          <div class="proj-menu" onclick="event.stopPropagation()">
            <button type="button" class="proj-menu-btn" onclick="toggleProjMenu(event,'col-${col.id}')">⋯</button>
            <div class="proj-menu-drop hidden" id="proj-menu-col-${col.id}">
              ${adminRename ? `<button type="button" onclick="markDoneColumn('${col.id}')">Bajarildi ustuni</button>` : ''}
              ${adminRename ? `<button type="button" class="danger" onclick="deleteColumn('${col.id}')">O'chirish</button>` : ''}
              ${!adminRename ? `<button type="button" disabled style="opacity:.6">Nom — faqat admin</button>` : ''}
            </div>
          </div>
        </div>
        <div class="pk-col-body" data-column-id="${col.id}">${cardsHtml}</div>
        <button type="button" class="pk-add-card" onclick="openCreateCardModal('${projectId}','${col.id}')">+ Kartochka</button>
      </div>`;
  }).join('');

  return `
    <div class="pk-toolbar">
      <button type="button" class="btn-ghost" onclick="openProjectsList()">← Orqaga</button>
      <h2 class="proj-title" style="margin:0;">${escapeHtml(p.icon || '')} ${escapeHtml(p.name)}</h2>
      <div class="pk-toolbar-actions">
        <button type="button" class="btn-ghost" onclick="openProjectProgress('${projectId}')">📊 Progress</button>
        ${(typeof isAdmin === 'function' && isAdmin()) ? `<button type="button" class="btn-ghost" onclick="promptAddColumn('${projectId}')">+ Ustun</button>` : ''}
        <button type="button" class="btn-blue" onclick="openCreateCardModal('${projectId}')">+ Kartochka</button>
        ${membersBtn}
      </div>
    </div>
    <div class="pk-board">${columnsHtml || '<div class="empty-msg">Ustun yo\'q</div>'}</div>`;
}

function renameProjectColumn(id, name) {
  if (typeof isAdmin !== 'function' || !isAdmin()) {
    toast("Ustun nomini faqat admin o'zgartira oladi");
    renderProjectsView();
    return;
  }
  const n = (name || '').trim();
  if (!n) return;
  updateColumn(id, { name: n });
}

function promptAddColumn(projectId) {
  if (typeof isAdmin !== 'function' || !isAdmin()) {
    toast("Ustun qo'shish faqat admin uchun");
    return;
  }
  const name = prompt('Ustun nomi:');
  if (!name || !name.trim()) return;
  createColumn(projectId, name.trim());
}

/* ---------- DnD ---------- */
function onProjectCardDragStart(ev) {
  const el = ev.currentTarget;
  projectDrag.cardId = el.dataset.cardId;
  projectDrag.fromColumnId = el.dataset.columnId;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', projectDrag.cardId);
  el.classList.add('dragging');
}
function onProjectCardDragEnd(ev) {
  ev.currentTarget.classList.remove('dragging');
  projectDrag = { cardId: null, fromColumnId: null };
}
function onProjectColDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  const body = ev.currentTarget.querySelector('.pk-col-body');
  if (!body || !projectDrag.cardId) return;
  const after = getDragAfterElement(body, ev.clientY);
  const dragging = document.querySelector('.pk-card.dragging');
  if (!dragging) return;
  if (after == null) body.appendChild(dragging);
  else body.insertBefore(dragging, after);
}
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.pk-card:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
async function onProjectColDrop(ev, columnId) {
  ev.preventDefault();
  const cardId = projectDrag.cardId || ev.dataTransfer.getData('text/plain');
  if (!cardId) return;
  const body = ev.currentTarget.querySelector('.pk-col-body');
  const order = [...body.querySelectorAll('.pk-card')].map(el => el.dataset.cardId);
  const toIndex = order.indexOf(cardId);
  await moveCard(cardId, columnId, toIndex < 0 ? order.length : toIndex);
}

/* ---------- Progress ---------- */
function destroyProjectChart() {
  if (projectChart) {
    try { projectChart.destroy(); } catch (e) {}
    projectChart = null;
  }
}

function renderProgressHtml(projectId) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p) return '<div class="empty-msg">Loyiha topilmadi</div>';
  const cards = projectCardsOf(projectId);
  const cols = projectColumnsOf(projectId);
  const doneIds = doneColumnIds(projectId);
  const doneCount = cards.filter(c => doneIds.has(c.column_id)).length;
  const overdue = cards.filter(c => {
    if (doneIds.has(c.column_id) || !c.deadline) return false;
    const d = new Date(c.deadline);
    return !isNaN(d.getTime()) && d < new Date();
  }).length;
  const pct = cards.length ? Math.round((doneCount / cards.length) * 100) : 0;

  let avgHtml = '';
  const completed = cards.filter(c => c.completed_at && c.created_at);
  if (completed.length) {
    const avgMs = completed.reduce((s, c) => s + (new Date(c.completed_at) - new Date(c.created_at)), 0) / completed.length;
    const days = Math.max(0, Math.round(avgMs / 86400000));
    avgHtml = `<div class="proj-stat"><b>${days} kun</b><span>O'rtacha bajarilish</span></div>`;
  }

  const memberBars = projectMembersOf(projectId).map(u => {
    const mine = cards.filter(c => c.assignee_user_id === u.id);
    const mineDone = mine.filter(c => doneIds.has(c.column_id)).length;
    const mp = mine.length ? Math.round((mineDone / mine.length) * 100) : 0;
    return `
      <div class="proj-member-bar">
        <div class="proj-member-bar-head">${userAvatarHtml(u, 'proj-avatar sm')} ${escapeHtml(u.display_name)}</div>
        <div class="proj-progress"><div class="proj-progress-track"><div class="proj-progress-fill" style="width:${mp}%"></div></div>
        <span>${mineDone}/${mine.length}</span></div>
      </div>`;
  }).join('');

  return `
    <div class="pk-toolbar">
      <button type="button" class="btn-ghost" onclick="openProjectBoard('${projectId}')">← Doska</button>
      <h2 class="proj-title" style="margin:0;">📊 ${escapeHtml(p.name)} — Progress</h2>
      <div class="pk-toolbar-actions">
        <button type="button" class="btn-ghost" onclick="openProjectsList()">Loyihalar</button>
      </div>
    </div>
    <div class="proj-stats">
      <div class="proj-stat"><b>${cards.length}</b><span>Jami kartochka</span></div>
      <div class="proj-stat"><b>${doneCount}</b><span>Bajarildi</span></div>
      <div class="proj-stat"><b>${overdue}</b><span>Muddati o'tgan</span></div>
      ${avgHtml}
    </div>
    <div class="proj-progress-layout">
      <div class="panel proj-chart-panel">
        <div class="proj-doughnut-wrap">
          <canvas id="chart-project-progress"></canvas>
          <div class="proj-doughnut-center"><b id="proj-pct-center">${pct}%</b><span>bajarildi</span></div>
        </div>
      </div>
      <div class="panel">
        <h2 style="font-size:14px;margin:0 0 12px;">A'zolar bo'yicha</h2>
        ${memberBars || '<p class="help-text">Tayinlangan kartochkalar yo\'q</p>'}
      </div>
    </div>`;
}

function drawProjectProgressChart(projectId) {
  destroyProjectChart();
  const canvas = document.getElementById('chart-project-progress');
  if (!canvas || typeof Chart === 'undefined') return;
  const cols = projectColumnsOf(projectId);
  const cards = projectCardsOf(projectId);
  const labels = cols.map(c => c.name);
  const data = cols.map(c => cards.filter(x => x.column_id === c.id).length);
  const colors = cols.map(c => c.color || '#64748B');
  const pct = projectProgressPct(projectId);
  const center = document.getElementById('proj-pct-center');
  if (center) center.textContent = pct + '%';

  projectChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.length ? data : [1],
        backgroundColor: data.some(n => n > 0) ? colors : [cssVar('--border') || '#334155'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: cssVar('--text-soft') || '#94a3b8', boxWidth: 12, padding: 14 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw || 0;
              const sum = (ctx.dataset.data || []).reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${v} (${Math.round(v / sum * 100)}%)`;
            }
          }
        }
      }
    }
  });
}

/* ---------- Modals ---------- */
function openCreateProjectModal() {
  const colorOpts = PROJECT_COLORS.map((c, i) =>
    `<label class="proj-swatch"><input type="radio" name="proj-color" value="${c.id}" ${i === 0 ? 'checked' : ''}><span style="background:${c.id}"></span></label>`
  ).join('');
  const iconOpts = PROJECT_ICONS.map((ic, i) =>
    `<label class="proj-icon-pick"><input type="radio" name="proj-icon" value="${ic}" ${i === 0 ? 'checked' : ''}><span>${ic}</span></label>`
  ).join('');

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal wide">
        <h3>+ Yangi loyiha</h3>
        <div class="field"><label>Nom</label><input type="text" id="np-name" placeholder="Masalan: Marketing kampaniyasi"></div>
        <div class="field"><label>Tavsif</label><textarea id="np-desc" rows="2" placeholder="Qisqa tavsif (ixtiyoriy)"></textarea></div>
        <div class="field"><label>Rang</label><div class="proj-swatches">${colorOpts}</div></div>
        <div class="field"><label>Icon</label><div class="proj-icons">${iconOpts}</div></div>
        <div class="field"><label>Tur</label>
          <div class="proj-type-row">
            <label class="assignee-check"><input type="radio" name="np-type" value="personal" checked onchange="toggleNewProjectMembers()"> <span>Shaxsiy</span></label>
            <label class="assignee-check"><input type="radio" name="np-type" value="team" onchange="toggleNewProjectMembers()"> <span>Jamoaviy</span></label>
          </div>
        </div>
        <div class="assignee-multi hidden" id="np-members-wrap">
          <div class="assignee-multi-head">
            <label>A'zolar</label>
            <span class="count" id="np-members-count">0 tanlangan</span>
          </div>
          <div class="assignee-check-list" id="np-members-list"></div>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Bekor</button>
          <button class="btn-blue" onclick="submitCreateProject()">Yaratish</button>
        </div>
      </div>
    </div>`;
  renderAssigneeCheckList('np-members-list', 'np-members-count');
}

function toggleNewProjectMembers() {
  const team = document.querySelector('input[name="np-type"]:checked')?.value === 'team';
  document.getElementById('np-members-wrap')?.classList.toggle('hidden', !team);
}

async function submitCreateProject() {
  const name = document.getElementById('np-name')?.value.trim();
  if (!name) { toast('Loyiha nomini kiriting'); return; }
  const description = document.getElementById('np-desc')?.value.trim() || '';
  const color = document.querySelector('input[name="proj-color"]:checked')?.value || PROJECT_COLORS[0].id;
  const icon = document.querySelector('input[name="proj-icon"]:checked')?.value || '📋';
  const is_personal = document.querySelector('input[name="np-type"]:checked')?.value !== 'team';
  const memberIds = is_personal ? [] : getSelectedAssigneeIds('np-members-list');
  closeModal();
  await createProject({ name, description, color, icon, is_personal }, memberIds);
}

function openCreateCardModal(projectId, columnId) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p) return;
  const cols = projectColumnsOf(projectId);
  const colId = columnId || cols[0]?.id;
  if (!colId) { toast('Avval ustun yarating'); return; }
  const members = p.is_personal
    ? [userById(currentProfile.id)].filter(Boolean)
    : projectMembersOf(projectId);
  const assigneeOpts = members.map(u =>
    `<option value="${u.id}" ${u.id === currentProfile?.id ? 'selected' : ''}>${escapeHtml(u.display_name)}</option>`
  ).join('');
  const colOpts = cols.map(c =>
    `<option value="${c.id}" ${c.id === colId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>+ Kartochka</h3>
        <div class="field"><label>Sarlavha</label><input type="text" id="nc-title" placeholder="Vazifa nomi"></div>
        <div class="field"><label>Tavsif</label><textarea id="nc-desc" rows="3"></textarea></div>
        <div class="field"><label>Ustun</label><select id="nc-column">${colOpts}</select></div>
        <div class="field"><label>Mas'ul</label><select id="nc-assignee"><option value="">—</option>${assigneeOpts}</select></div>
        <div class="field"><label>Prioritet</label>
          <select id="nc-priority">
            <option value="">—</option>
            <option value="Shoshilinch">Shoshilinch</option>
            <option value="Yuqori">Yuqori</option>
            <option value="O'rta">O'rta</option>
            <option value="Past">Past</option>
          </select>
        </div>
        <div class="field"><label>Muddat</label><input type="datetime-local" id="nc-deadline"></div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Bekor</button>
          <button class="btn-blue" onclick="submitCreateCard('${projectId}')">Yaratish</button>
        </div>
      </div>
    </div>`;
}

async function submitCreateCard(projectId) {
  const title = document.getElementById('nc-title')?.value.trim();
  if (!title) { toast('Sarlavha kiriting'); return; }
  const column_id = document.getElementById('nc-column')?.value;
  const payload = {
    title,
    description: document.getElementById('nc-desc')?.value.trim() || '',
    assignee_user_id: document.getElementById('nc-assignee')?.value || null,
    priority: document.getElementById('nc-priority')?.value || '',
    deadline: fromDatetimeLocal(document.getElementById('nc-deadline')?.value)
  };
  closeModal();
  await createCard(projectId, column_id, payload);
}

function openEditProjectCardModal(cardId) {
  const card = state.projectCards.find(c => c.id === cardId);
  if (!card) return;
  const p = state.projects.find(x => x.id === card.project_id);
  if (!p) return;
  const cols = projectColumnsOf(card.project_id);
  const members = p.is_personal
    ? [userById(currentProfile.id)].filter(Boolean)
    : projectMembersOf(card.project_id);
  const assigneeOpts = members.map(u =>
    `<option value="${u.id}" ${u.id === card.assignee_user_id ? 'selected' : ''}>${escapeHtml(u.display_name)}</option>`
  ).join('');
  const colOpts = cols.map(c =>
    `<option value="${c.id}" ${c.id === card.column_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  const adminName = typeof isAdmin === 'function' && isAdmin();
  const titleField = adminName
    ? `<div class="field"><label>Sarlavha</label><input type="text" id="ec-title" value="${escapeHtml(card.title)}"></div>`
    : `<div class="field"><label>Sarlavha <span style="color:var(--text-faint);font-weight:500">(faqat admin)</span></label>
        <input type="text" id="ec-title" value="${escapeHtml(card.title)}" readonly style="opacity:.85;cursor:default;"></div>`;

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Kartochkani tahrirlash</h3>
        ${titleField}
        <div class="field"><label>Tavsif</label><textarea id="ec-desc" rows="3">${escapeHtml(card.description || '')}</textarea></div>
        <div class="field"><label>Ustun</label><select id="ec-column">${colOpts}</select></div>
        <div class="field"><label>Mas'ul</label><select id="ec-assignee"><option value="">—</option>${assigneeOpts}</select></div>
        <div class="field"><label>Prioritet</label>
          <select id="ec-priority">
            <option value="" ${!card.priority ? 'selected' : ''}>—</option>
            <option value="Shoshilinch" ${card.priority === 'Shoshilinch' ? 'selected' : ''}>Shoshilinch</option>
            <option value="Yuqori" ${card.priority === 'Yuqori' ? 'selected' : ''}>Yuqori</option>
            <option value="O'rta" ${card.priority === "O'rta" ? 'selected' : ''}>O'rta</option>
            <option value="Past" ${card.priority === 'Past' ? 'selected' : ''}>Past</option>
          </select>
        </div>
        <div class="field"><label>Muddat</label><input type="datetime-local" id="ec-deadline" value="${toDatetimeLocal(card.deadline)}"></div>
        <div class="modal-actions">
          <button class="btn-ghost" style="color:var(--danger)" onclick="confirmDeleteCard('${card.id}')">O'chirish</button>
          <button class="btn-ghost" onclick="closeModal()">Bekor</button>
          <button class="btn-blue" onclick="submitEditCard('${card.id}')">Saqlash</button>
        </div>
      </div>
    </div>`;
}

async function submitEditCard(cardId) {
  const card = state.projectCards.find(c => c.id === cardId);
  if (!card) return;
  const adminName = typeof isAdmin === 'function' && isAdmin();
  let title = document.getElementById('ec-title')?.value.trim();
  if (!adminName) title = card.title;
  if (!title) { toast('Sarlavha kiriting'); return; }
  const newCol = document.getElementById('ec-column')?.value;
  const patch = {
    title,
    description: document.getElementById('ec-desc')?.value.trim() || '',
    assignee_user_id: document.getElementById('ec-assignee')?.value || null,
    priority: document.getElementById('ec-priority')?.value || '',
    deadline: fromDatetimeLocal(document.getElementById('ec-deadline')?.value)
  };
  closeModal();
  if (newCol && newCol !== card.column_id) {
    await updateCard(cardId, patch);
    await moveCard(cardId, newCol, 9999);
  } else {
    const done = doneColumnIds(card.project_id);
    if (done.has(card.column_id) && !card.completed_at) patch.completed_at = new Date().toISOString();
    await updateCard(cardId, patch);
  }
}

function confirmDeleteCard(id) {
  if (!confirm("Kartochkani o'chirasizmi?")) return;
  closeModal();
  deleteCard(id);
}

function openProjectMembersModal(projectId) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p || !canManageProject(p)) return;
  const selected = projectMembersOf(projectId).map(u => u.id);
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal wide">
        <h3>A'zolarni boshqarish</h3>
        <div class="assignee-multi">
          <div class="assignee-multi-head">
            <label>Jamoa a'zolari</label>
            <span class="count" id="pm-members-count">0 tanlangan</span>
          </div>
          <div class="assignee-check-list" id="pm-members-list"></div>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeModal()">Bekor</button>
          <button class="btn-blue" onclick="submitProjectMembers('${projectId}')">Saqlash</button>
        </div>
      </div>
    </div>`;
  renderAssigneeCheckList('pm-members-list', 'pm-members-count', selected);
}

async function submitProjectMembers(projectId) {
  const ids = getSelectedAssigneeIds('pm-members-list');
  closeModal();
  await setProjectMembers(projectId, ids);
}

async function renderDeletedProjectsPanel() {
  const wrap = document.getElementById('deleted-projects-panel');
  const tbody = document.getElementById('deleted-projects-tbody');
  if (!wrap || !tbody || !isAdmin()) return;
  const rows = await fetchDeletedProjects();
  wrap.classList.remove('hidden');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">O\'chirilgan loyiha yo\'q</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${escapeHtml(p.icon || '')} ${escapeHtml(p.name || '—')}</td>
      <td>${p.is_personal ? 'Shaxsiy' : 'Jamoaviy'}</td>
      <td>${p.deleted_at ? escapeHtml(formatDeadlineDisplay(p.deleted_at)) : '—'}</td>
      <td><button class="btn-blue" style="padding:6px 10px;font-size:11px;" onclick="restoreProject('${p.id}')">↩ Tiklash</button></td>
    </tr>`).join('');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.proj-menu-drop').forEach(el => el.classList.add('hidden'));
});
