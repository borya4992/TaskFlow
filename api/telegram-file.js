// file_id orqali Telegramdan faylni oladi va brauzerga uzatadi (proksi / yuklab olish).
// Bot tokenini brauzerga chiqarmaslik uchun fayl shu server orqali "oqiziladi".
// Fayl Telegram serverlarida saqlanadi — Supabase Storage ishlatilmaydi.
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }

  try {
    const fileId = req.query.file_id;
    const asName = String(req.query.name || 'fayl').replace(/[/\\]/g, '_');
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

    const metaRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const meta = await metaRes.json();
    if (!meta.ok) {
      res.status(404).json({
        ok: false,
        error: "Fayl topilmadi yoki Telegramda muddati o'tgan. Qayta yuklang."
      });
      return;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
    if (!fileRes.ok) {
      res.status(502).json({ ok: false, error: "Faylni Telegramdan yuklab bo'lmadi" });
      return;
    }

    const buf = Buffer.from(await fileRes.arrayBuffer());
    const ctype = fileRes.headers.get('content-type') || 'application/octet-stream';
    const asciiName = asName.replace(/[^\x20-\x7E]/g, '_') || 'fayl';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(asName)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
