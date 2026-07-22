// file_id orqali Telegramdan faylni oladi va brauzerga uzatadi (proksi).
// Bot tokenini brauzerga chiqarmaslik uchun fayl shu server orqali "oqiziladi".
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

module.exports = async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }

  try {
    const fileId = req.query.file_id;
    const asName = req.query.name || 'fayl';
    if (!fileId) {
      res.status(400).json({ ok: false, error: 'file_id kerak' });
      return;
    }

    const settingsRes = await fetch(`${supabaseUrl}/rest/v1/settings?id=eq.1&select=telegram_token`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const settingsRows = await settingsRes.json();
    const token = settingsRows?.[0]?.telegram_token || '';
    if (!token) {
      res.status(400).json({ ok: false, error: 'Telegram token sozlanmagan' });
      return;
    }

    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const meta = await metaRes.json();
    if (!meta.ok) {
      res.status(404).json({ ok: false, error: "Fayl topilmadi yoki Telegramda muddati o'tgan" });
      return;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
    if (!fileRes.ok) {
      res.status(502).json({ ok: false, error: "Faylni yuklab bo'lmadi" });
      return;
    }

    const buf = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asName)}"`);
    res.status(200).send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
