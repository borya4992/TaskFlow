// Telegram Login Widget orqali kirish — serverda hash tekshiriladi va Supabase sessiyasi yaratiladi.
// Vercel Environment Variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');

function verifyTelegramAuth(data, botToken) {
  const checkHash = data.hash;
  if (!checkHash || !botToken) return false;
  const payload = { ...data };
  delete payload.hash;
  const dataCheckString = Object.keys(payload)
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return hmac === checkHash;
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
    const tgData = req.body || {};
    const telegramId = String(tgData.id || '');
    if (!telegramId) {
      res.status(400).json({ ok: false, error: 'Telegram ma\'lumoti yetishmayapti' });
      return;
    }

    const settingsRes = await fetch(`${supabaseUrl}/rest/v1/settings?id=eq.1&select=telegram_token`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const settingsRows = await settingsRes.json();
    const botToken = settingsRows?.[0]?.telegram_token || '';
    if (!botToken || !verifyTelegramAuth(tgData, botToken)) {
      res.status(403).json({ ok: false, error: 'Telegram tasdiqlanmadi. Bot token sozlamalarida to\'g\'ri ekanligini tekshiring.' });
      return;
    }

    const invitedRes = await fetch(`${supabaseUrl}/rest/v1/rpc/is_user_invited`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_telegram_id: telegramId }),
    });
    const invited = await invitedRes.json();
    if (!invited) {
      res.status(403).json({ ok: false, error: 'Siz tizimga kiritilmagansiz. Admin bilan bog\'laning.' });
      return;
    }

    const email = `tg_${telegramId}@taskflow.internal`;
    const password = crypto.createHash('sha256').update(`${botToken}:${telegramId}`).digest('hex');

    let authUserId = null;

    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const listData = await listRes.json();
    const existing = (listData.users || []).find((u) => u.email === email);

    if (existing) {
      authUserId = existing.id;
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password, email_confirm: true }),
      });
    } else {
      const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { telegram_id: telegramId, auth_method: 'telegram' },
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        res.status(500).json({ ok: false, error: created.msg || created.message || 'Auth user yaratilmadi' });
        return;
      }
      authUserId = created.id;
    }

    await fetch(`${supabaseUrl}/rest/v1/app_users?telegram_id=eq.${encodeURIComponent(telegramId)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        auth_user_id: authUserId,
        telegram_username: tgData.username || null,
        display_name: [tgData.first_name, tgData.last_name].filter(Boolean).join(' ') || tgData.username || 'Telegram user',
      }),
    });

    const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const session = await tokenRes.json();
    if (!tokenRes.ok) {
      res.status(500).json({ ok: false, error: session.error_description || session.msg || 'Sessiya yaratilmadi' });
      return;
    }

    const profileRes = await fetch(`${supabaseUrl}/rest/v1/app_users?auth_user_id=eq.${authUserId}&select=*`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const profiles = await profileRes.json();

    res.status(200).json({
      ok: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
      user: profiles[0] || null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
