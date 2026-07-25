// TUZATILDI: endi hech kim tashqi bot token bilan bu endpoint orqali xabar yubora olmaydi.
// - Chaqiruvchi albatta login qilgan bo'lishi kerak (Authorization: Bearer <access_token>).
// - Bot tokeni HAR DOIM serverning o'zida, settings jadvalidan olinadi (client'dan kelgan
//   "token" maydoni butunlay e'tiborga olinmaydi).
// - chat_id va text baribir client'dan keladi — chunki turli xodimlarga (turli telegram_id
//   larga) xabar yuborish qonuniy ehtiyoj (masalan notifyUser funksiyasi uchun).
//
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

async function getAuthUserByJwt(supabaseUrl, serviceKey, jwt) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` }
  });
  if (!res.ok) return null;
  return res.json();
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
    // 1) Avtorizatsiya majburiy
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

    // 2) Bot tokenini FAQAT serverdan olamiz — client bergan tokenga ishonmaymiz
    const { chat_id, text } = req.body || {};
    if (!chat_id || !text) {
      res.status(400).json({ ok: false, error: 'chat_id yoki text yetishmayapti' });
      return;
    }

    const settingsRes = await fetch(`${supabaseUrl}/rest/v1/settings?id=eq.1&select=telegram_token`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const settingsRows = await settingsRes.json();
    const token = settingsRows?.[0]?.telegram_token || '';
    if (!token) {
      res.status(400).json({ ok: false, error: 'Telegram bot tokeni sozlanmagan' });
      return;
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
    });
    const data = await tgRes.json();
    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
