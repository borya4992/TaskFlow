// Auth user yaratish / parolni 123456 ga tiklash (service role).
// Vercel env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Client Authorization: Bearer <user access_token> (faqat admin)

const DEFAULT_PASSWORD = '123456';

async function supabaseHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function getAuthUserByJwt(supabaseUrl, anonOrServiceKey, jwt) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonOrServiceKey,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function isAdminUser(supabaseUrl, serviceKey, authUserId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/app_users?auth_user_id=eq.${authUserId}&role=eq.admin&is_active=eq.true&select=id`,
    { headers: await supabaseHeaders(serviceKey) }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function findAuthUserByEmail(supabaseUrl, serviceKey, email) {
  // Prefer list filter if available; fallback scan
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
    headers: await supabaseHeaders(serviceKey),
  });
  const data = await res.json();
  const users = data.users || [];
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function linkAppUser(supabaseUrl, serviceKey, email, authUserId) {
  await fetch(`${supabaseUrl}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      ...(await supabaseHeaders(serviceKey)),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ auth_user_id: authUserId }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
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
    if (!(await isAdminUser(supabaseUrl, serviceKey, me.id))) {
      res.status(403).json({ ok: false, error: 'Faqat admin' });
      return;
    }

    const { action, email, display_name } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      res.status(400).json({ ok: false, error: 'Email kerak' });
      return;
    }

    if (action === 'create') {
      let user = await findAuthUserByEmail(supabaseUrl, serviceKey, normalizedEmail);
      if (user) {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
          method: 'PUT',
          headers: await supabaseHeaders(serviceKey),
          body: JSON.stringify({
            password: DEFAULT_PASSWORD,
            email_confirm: true,
            user_metadata: { display_name: display_name || user.user_metadata?.display_name || '' },
          }),
        });
      } else {
        const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: await supabaseHeaders(serviceKey),
          body: JSON.stringify({
            email: normalizedEmail,
            password: DEFAULT_PASSWORD,
            email_confirm: true,
            user_metadata: { display_name: display_name || '' },
          }),
        });
        const created = await createRes.json();
        if (!createRes.ok) {
          res.status(500).json({
            ok: false,
            error: created.msg || created.message || 'Auth user yaratilmadi (parol uzunligi 4+ bo‘lishi kerak — Supabase Auth sozlamalarini tekshiring)',
          });
          return;
        }
        user = created;
      }
      await linkAppUser(supabaseUrl, serviceKey, normalizedEmail, user.id);
      res.status(200).json({ ok: true, auth_user_id: user.id, default_password: DEFAULT_PASSWORD });
      return;
    }

    if (action === 'reset') {
      const user = await findAuthUserByEmail(supabaseUrl, serviceKey, normalizedEmail);
      if (!user) {
        // Create if missing
        const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: await supabaseHeaders(serviceKey),
          body: JSON.stringify({
            email: normalizedEmail,
            password: DEFAULT_PASSWORD,
            email_confirm: true,
          }),
        });
        const created = await createRes.json();
        if (!createRes.ok) {
          res.status(500).json({ ok: false, error: created.msg || created.message || 'User topilmadi va yaratilmadi' });
          return;
        }
        await linkAppUser(supabaseUrl, serviceKey, normalizedEmail, created.id);
        res.status(200).json({ ok: true, reset: true, default_password: DEFAULT_PASSWORD });
        return;
      }
      const upd = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: await supabaseHeaders(serviceKey),
        body: JSON.stringify({ password: DEFAULT_PASSWORD, email_confirm: true }),
      });
      const updData = await upd.json();
      if (!upd.ok) {
        res.status(500).json({ ok: false, error: updData.msg || updData.message || 'Parol tiklanmadi' });
        return;
      }
      await linkAppUser(supabaseUrl, serviceKey, normalizedEmail, user.id);
      res.status(200).json({ ok: true, reset: true, default_password: DEFAULT_PASSWORD });
      return;
    }

    res.status(400).json({ ok: false, error: 'action: create | reset' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
