// AI ASSISTANT — vositalar (tools) ijrosi.
// Bu fayl Claude tanlagan vositani HAQIQIY Supabase amaliga aylantiradi.
// Har bir funksiya sinov uchun mustaqil (faqat fetch orqali REST so'rov yuboradi).

async function sbGet(supabaseUrl, serviceKey, path) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
async function sbPost(supabaseUrl, serviceKey, path, body, extraHeaders = {}) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
async function sbPatch(supabaseUrl, serviceKey, path, body) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function effectiveStatus(t) {
  if (t.status === 'bajarildi') return 'bajarildi';
  if (t.status === 'tekshiruvda') return 'tekshiruvda';
  const dl = t.deadline ? new Date(t.deadline) : null;
  if (dl && !isNaN(dl.getTime()) && dl < new Date()) return 'muddati_otgan';
  return 'jarayonda';
}

async function fetchActiveTasks(supabaseUrl, serviceKey) {
  const r = await sbGet(supabaseUrl, serviceKey, `/rest/v1/tasks?deleted_at=is.null&select=*`);
  return r.ok ? r.data || [] : [];
}
async function fetchActiveStaff(supabaseUrl, serviceKey) {
  const r = await sbGet(
    supabaseUrl, serviceKey,
    `/rest/v1/app_users?is_active=eq.true&select=id,display_name,role`
  );
  return r.ok ? r.data || [] : [];
}

function findEmployeeByName(staffList, name) {
  const target = (name || '').trim().toLowerCase();
  if (!target) return null;
  // Aniq moslik
  let found = staffList.find(u => (u.display_name || '').toLowerCase() === target);
  if (found) return found;
  // Qisman moslik (masalan "Aziz" -> "Aziz Karimov")
  const partial = staffList.filter(u => (u.display_name || '').toLowerCase().includes(target));
  if (partial.length === 1) return partial[0];
  return null; // topilmadi yoki bir nechta mos keldi (aniqlashtirish kerak)
}

const TOOLS = {
  async get_dashboard_summary(args, ctx) {
    const tasks = await fetchActiveTasks(ctx.supabaseUrl, ctx.serviceKey);
    const summary = { jami: tasks.length, jarayonda: 0, tekshiruvda: 0, bajarildi: 0, muddati_otgan: 0 };
    for (const t of tasks) summary[effectiveStatus(t)] = (summary[effectiveStatus(t)] || 0) + 1;
    return summary;
  },

  async get_overdue_tasks(args, ctx) {
    const tasks = await fetchActiveTasks(ctx.supabaseUrl, ctx.serviceKey);
    const staff = await fetchActiveStaff(ctx.supabaseUrl, ctx.serviceKey);
    const byId = new Map(staff.map(s => [s.id, s.display_name]));
    return tasks
      .filter(t => effectiveStatus(t) === 'muddati_otgan')
      .map(t => ({
        title: t.title,
        assignee: byId.get(t.assignee_user_id) || t.assignee || "noma'lum",
        deadline: t.deadline,
      }));
  },

  async get_employee_tasks(args, ctx) {
    const staff = await fetchActiveStaff(ctx.supabaseUrl, ctx.serviceKey);
    const emp = findEmployeeByName(staff, args.employee_name);
    if (!emp) {
      return { error: `"${args.employee_name}" nomli faol xodim topilmadi yoki bir nechta mos keluvchi bor. Aniq to'liq ismni so'rang.` };
    }
    const tasks = await fetchActiveTasks(ctx.supabaseUrl, ctx.serviceKey);
    const mine = tasks.filter(t => t.assignee_user_id === emp.id);
    return {
      employee: emp.display_name,
      tasks: mine.map(t => ({ title: t.title, status: effectiveStatus(t), deadline: t.deadline })),
    };
  },

  async list_employees(args, ctx) {
    const staff = await fetchActiveStaff(ctx.supabaseUrl, ctx.serviceKey);
    return staff.map(s => ({ name: s.display_name, role: s.role }));
  },

  async create_task(args, ctx) {
    if (!args.title || !args.assignee_name || !args.deadline) {
      return { error: 'title, assignee_name va deadline barchasi majburiy.' };
    }
    const staff = await fetchActiveStaff(ctx.supabaseUrl, ctx.serviceKey);
    const emp = findEmployeeByName(staff, args.assignee_name);
    if (!emp) {
      return { error: `"${args.assignee_name}" nomli faol xodim topilmadi yoki bir nechta mos keluvchi bor. Aniq to'liq ismni so'rang.` };
    }
    const deadlineDate = new Date(args.deadline);
    if (isNaN(deadlineDate.getTime())) {
      return { error: `Muddat ("${args.deadline}") tushunarsiz sana. YYYY-MM-DD formatida bering.` };
    }
    if (deadlineDate.getTime() < Date.now() - 24 * 3600 * 1000) {
      return { error: "Muddat o'tmishda bo'lishi mumkin emas." };
    }
    const payload = {
      title: String(args.title).slice(0, 300),
      description: args.description ? String(args.description).slice(0, 2000) : '',
      assignee: emp.display_name,
      assignee_user_id: emp.id,
      deadline: deadlineDate.toISOString(),
      priority: args.priority || "O'rta",
      status: 'jarayonda',
      created_by_user_id: ctx.callerId,
    };
    const r = await sbPost(ctx.supabaseUrl, ctx.serviceKey, '/rest/v1/tasks', payload, { Prefer: 'return=representation' });
    if (!r.ok) return { error: 'Topshiriq yaratilmadi: ' + JSON.stringify(r.data) };
    return { created: true, task: { title: payload.title, assignee: emp.display_name, deadline: payload.deadline } };
  },

  async update_task_status(args, ctx) {
    const validStatuses = ['jarayonda', 'tekshiruvda', 'bajarildi'];
    if (!validStatuses.includes(args.new_status)) {
      return { error: `new_status quyidagilardan biri bo'lishi kerak: ${validStatuses.join(', ')}` };
    }
    const tasks = await fetchActiveTasks(ctx.supabaseUrl, ctx.serviceKey);
    const search = (args.task_title_search || '').toLowerCase();
    const matches = tasks.filter(t => (t.title || '').toLowerCase().includes(search));
    if (matches.length === 0) return { error: `"${args.task_title_search}" bilan mos topshiriq topilmadi.` };
    if (matches.length > 1) {
      return {
        error: `Bir nechta mos topshiriq topildi, aniqroq nom bering: ` +
          matches.map(t => t.title).slice(0, 5).join(' | '),
      };
    }
    const task = matches[0];
    const r = await sbPatch(ctx.supabaseUrl, ctx.serviceKey, `/rest/v1/tasks?id=eq.${task.id}`, { status: args.new_status });
    if (!r.ok) return { error: 'Yangilanmadi: ' + JSON.stringify(r.data) };
    return { updated: true, title: task.title, new_status: args.new_status };
  },
};

module.exports = { TOOLS, effectiveStatus, findEmployeeByName };
