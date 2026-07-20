// Auth user yaratish / parolni 123456 ga tiklash (service role).
// Vercel env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Client Authorization: Bearer <user access_token> (faqat admin)

const DEFAULT_PASSWORD = '123456';

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function getAuthUserByJwt(supabaseUrl, serviceKey, jwt) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function isAdminUser(supabaseUrl, serviceKey, me) {
  // 1) auth_user_id bog'langan bo'lsa
  const byId = await fetch(
    `${supabaseUrl}/rest/v1/app_users?auth_user_id=eq.${me.id}&role=eq.admin&is_active=eq.true&select=id`,
    { headers: headers(serviceKey) }
  );
  const idRows = await byId.json();
  if (Array.isArray(idRows) && idRows.length > 0) return true;

  // 2) email orqali admin (auth_user_id hali bog'lanmagan bo'lsa ham)
  const email = (me.email || '').toLowerCase();
  if (!email) return false;
  const byEmail = await fetch(
    `${supabaseUrl}/rest/v1/app_users?email=ilike.${encodeURIComponent(email)}&role=eq.admin&is_active=eq.true&select=id`,
    { headers: headers(serviceKey) }
  );
  const emailRows = await byEmail.json();
  return Array.isArray(emailRows) && emailRows.length > 0;
}

async function findAuthUserByEmail(supabaseUrl, serviceKey, email) {
  const target = email.toLowerCase();
  // Bir necha sahifa bo'ylab qidirish
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: headers(serviceKey),
    });
    const data = await res.json();
    const users = data.users || [];
    const found = users.find((u) => (u.email || '').toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) break;
  }
  return null;
}

async function setPassword(supabaseUrl, serviceKey, userId, display_name) {
  const body = { password: DEFAULT_PASSWORD, email_confirm: true };
  if (display_name) body.user_metadata = { display_name };
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: headers(serviceKey),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function createAuthUser(supabaseUrl, serviceKey, email, display_name) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(serviceKey),
    body: JSON.stringify({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: display_name || '' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data, status: res.status };
}

async function linkAppUser(supabaseUrl, serviceKey, email, authUserId) {
  await fetch(`${supabaseUrl}/rest/v1/app_users?email=ilike.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { ...headers(serviceKey), Prefer: 'return=minimal' },
    body: JSON.stringify({ auth_user_id: authUserId }),
  });
}

async function ensurePasswordUser(supabaseUrl, serviceKey, email, display_name) {
  let user = await findAuthUserByEmail(supabaseUrl, serviceKey, email);
  if (user) {
    const upd = await setPassword(supabaseUrl, serviceKey, user.id, display_name);
    if (!upd.ok) {
      return { ok: false, error: upd.data.msg || upd.data.message || 'Parol o‘rnatilmadi' };
    }
    await linkAppUser(supabaseUrl, serviceKey, email, user.id);
    return { ok: true, auth_user_id: user.id };
  }

  const created = await createAuthUser(supabaseUrl, serviceKey, email, display_name);
  if (created.ok && created.data?.id) {
    await linkAppUser(supabaseUrl, serviceKey, email, created.data.id);
    return { ok: true, auth_user_id: created.data.id };
  }

  // Allaqachon mavjud bo'lishi mumkin — qayta qidirib parol qo'yamiz
  const msg = (created.data.msg || created.data.message || '').toLowerCase();
  if (msg.includes('already') || msg.includes('registered') || created.status === 422) {
    user = await findAuthUserByEmail(supabaseUrl, serviceKey, email);
    if (user) {
      const upd = await setPassword(supabaseUrl, serviceKey, user.id, display_name);
      if (!upd.ok) {
        return { ok: false, error: upd.data.msg || upd.data.message || 'Parol o‘rnatilmadi' };
      }
      await linkAppUser(supabaseUrl, serviceKey, email, user.id);
      return { ok: true, auth_user_id: user.id };
    }
  }

  return {
    ok: false,
    error: created.data.msg || created.data.message || 'Auth user yaratilmadi. Vercel SUPABASE_SERVICE_ROLE_KEY ni tekshiring.',
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({
      ok: false,
      error: 'Server sozlanmagan: Vercel Environment Variables ga SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY qo‘ying',
    });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) {
      res.status(401).json({ ok: false, error: 'Avtorizatsiya kerak' });
      return;
    }

    const me = await getAuthUserByJwt(supabaseUrl, serviceKey, jwt);
    if (!me?.id) {
      res.status(401).json({ ok: false, error: 'Sessiya yaroqsiz' });
      return;
    }
    if (!(await isAdminUser(supabaseUrl, serviceKey, me))) {
      res.status(403).json({
        ok: false,
        error: 'Faqat admin. app_users da emailingiz role=admin ekanini tekshiring.',
      });
      return;
    }

    const { action, email, display_name } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      res.status(400).json({ ok: false, error: 'Email kerak' });
      return;
    }
    if (action !== 'create' && action !== 'reset') {
      res.status(400).json({ ok: false, error: 'action: create | reset' });
      return;
    }

    const result = await ensurePasswordUser(supabaseUrl, serviceKey, normalizedEmail, display_name);
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error });
      return;
    }
    res.status(200).json({
      ok: true,
      auth_user_id: result.auth_user_id,
      default_password: DEFAULT_PASSWORD,
      reset: action === 'reset',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
