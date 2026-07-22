// Faylni brauzerdan qabul qiladi (multipart yoki JSON base64) va Telegram botiga yuboradi.
// Multipart afzal — base64 JSON Vercel 4.5MB limtidan tez chiqib ketadi (HTTP 413).
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MAX_BYTES = 3.5 * 1024 * 1024; // Vercel request body ~4.5MB; xavfsiz chegara

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m && (m[1] || m[2]);
  if (!boundary) throw new Error('multipart boundary topilmadi');
  const sep = Buffer.from('--' + boundary);
  const parts = [];
  let start = buffer.indexOf(sep) + sep.length;
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break; // --
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(sep, start);
    if (next < 0) break;
    let part = buffer.slice(start, next);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/i.exec(headers);
      const fileMatch = /filename="([^"]*)"/i.exec(headers);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
      parts.push({
        name: nameMatch ? nameMatch[1] : '',
        filename: fileMatch ? fileMatch[1] : '',
        mime: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
        data: body
      });
    }
    start = next + sep.length;
  }
  return parts;
}

async function getTelegramSettings(supabaseUrl, serviceKey) {
  const settingsRes = await fetch(
    `${supabaseUrl}/rest/v1/settings?id=eq.1&select=telegram_token,telegram_chat_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const settingsRows = await settingsRes.json();
  return {
    token: settingsRows?.[0]?.telegram_token || '',
    chatId: settingsRows?.[0]?.telegram_chat_id || ''
  };
}

async function sendToTelegram(token, chatId, filename, mime, buffer) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);
  form.append('caption', `📎 ${filename}`);
  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form
  });
  return tgRes.json();
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
    const { token, chatId } = await getTelegramSettings(supabaseUrl, serviceKey);
    if (!token || !chatId) {
      res.status(400).json({ ok: false, error: 'Avval saytda Telegram token va Chat ID sozlanmagan' });
      return;
    }

    let filename = '';
    let mime = 'application/octet-stream';
    let buffer = null;

    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      const raw = await readRawBody(req);
      if (raw.length > MAX_BYTES + 64 * 1024) {
        res.status(413).json({ ok: false, error: 'Fayl juda katta (maksimum 3.5 MB). Vercel limitti.' });
        return;
      }
      const parts = parseMultipart(raw, ct);
      const filePart = parts.find((p) => p.name === 'file' || p.filename);
      if (!filePart || !filePart.data?.length) {
        res.status(400).json({ ok: false, error: 'file maydoni topilmadi' });
        return;
      }
      filename = filePart.filename || 'fayl';
      mime = filePart.mime || mime;
      buffer = filePart.data;
    } else {
      // Eski JSON base64 (kichik fayllar uchun) — bodyParser o'chirilgan
      const raw = await readRawBody(req);
      if (raw.length > MAX_BYTES * 1.4 + 1024) {
        res.status(413).json({ ok: false, error: 'Fayl juda katta (maksimum 3.5 MB). Vercel limitti.' });
        return;
      }
      let body = {};
      try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (_) {
        res.status(400).json({ ok: false, error: 'JSON o\'qilmadi — multipart/form-data yuboring' });
        return;
      }
      filename = body.filename || '';
      mime = body.mime || mime;
      if (!filename || !body.data) {
        res.status(400).json({ ok: false, error: 'filename yoki data yetishmayapti' });
        return;
      }
      buffer = Buffer.from(body.data, 'base64');
    }

    if (!filename || !buffer?.length) {
      res.status(400).json({ ok: false, error: 'Fayl bo\'sh' });
      return;
    }
    if (buffer.length > MAX_BYTES) {
      res.status(400).json({
        ok: false,
        error: 'Fayl juda katta (maksimum 3.5 MB). Kichikroq fayl yuboring.'
      });
      return;
    }

    const tgData = await sendToTelegram(token, chatId, filename, mime, buffer);
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
    const msg = String(e.message || e);
    if (/413|entity too large|payload/i.test(msg)) {
      res.status(413).json({ ok: false, error: 'Fayl juda katta (maksimum 3.5 MB)' });
      return;
    }
    res.status(500).json({ ok: false, error: msg });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
