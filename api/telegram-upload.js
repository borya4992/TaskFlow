// Faylni brauzerdan qabul qiladi (base64) va Telegram botiga yuboradi.
// Javobda file_id qaytaradi — shuni Supabase'dagi tasks jadvalida saqlaysiz.
// Fayl o'zi Telegram serverlarida turadi, Supabase joyini band qilmaydi.
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (boshqa fayllar bilan bir xil)

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
    const { filename, mime, data } = req.body || {};
    if (!filename || !data) {
      res.status(400).json({ ok: false, error: 'filename yoki data yetishmayapti' });
      return;
    }

    const settingsRes = await fetch(`${supabaseUrl}/rest/v1/settings?id=eq.1&select=telegram_token,telegram_chat_id`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const settingsRows = await settingsRes.json();
    const token = settingsRows?.[0]?.telegram_token || '';
    const chatId = settingsRows?.[0]?.telegram_chat_id || '';
    if (!token || !chatId) {
      res.status(400).json({ ok: false, error: 'Avval saytda Telegram token va Chat ID sozlanmagan' });
      return;
    }

    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > 19 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: 'Fayl juda katta (maksimum ~19 MB)' });
      return;
    }

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);
    form.append('caption', `📎 ${filename}`);

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      res.status(400).json({ ok: false, error: 'Telegram xatosi: ' + (tgData.description || 'nomalum') });
      return;
    }

    const doc = tgData.result.document;
    res.status(200).json({
      ok: true,
      file_id: doc.file_id,
      file_name: doc.file_name || filename,
      file_size: doc.file_size || buffer.length
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};
