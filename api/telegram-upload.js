// Faylni Telegram botiga yuboradi; doimiy saqlash Telegramda (Supabase Storage emas).
//
// 2 usul:
// 1) JSON { storagePath, filename, mime } — brauzer avval task-temp bucket'ga yuklaydi
//    (Vercel 4.5MB limtidan o'tish uchun, 10 MB gacha).
// 2) multipart/form-data — kichik fayllar uchun to'g'ridan-to'g'ri (~3.5 MB).
//
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MAX_DIRECT_BYTES = 3.5 * 1024 * 1024;
const MAX_STAGED_BYTES = 10 * 1024 * 1024;
const TEMP_BUCKET = 'task-temp';

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
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
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

async function downloadFromStorage(supabaseUrl, serviceKey, storagePath) {
  const url = `${supabaseUrl}/storage/v1/object/${TEMP_BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Vaqtinchalik faylni o\'qib bo\'lmadi: ' + (errText || res.status));
  }
  return Buffer.from(await res.arrayBuffer());
}

async function deleteFromStorage(supabaseUrl, serviceKey, storagePath) {
  try {
    await fetch(`${supabaseUrl}/storage/v1/object/${TEMP_BUCKET}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefixes: [storagePath] })
    });
  } catch (e) {
    console.warn('temp delete failed', e);
  }
}

async function sendToTelegram(token, chatId, filename, mime, buffer) {
  const form = new FormData();
  form.append('chat_id', String(chatId).trim());
  form.append('document', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);
  form.append('caption', `📎 ${filename}`);
  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form
  });
  return tgRes.json();
}

function normalizeChatId(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return '';
  // @username qolishi mumkin; raqamli ID afzal
  return s;
}

async function sendDocumentToAnyChat(token, chatIds, filename, mime, buffer) {
  const tried = [];
  let last = null;
  for (const raw of chatIds) {
    const chatId = normalizeChatId(raw);
    if (!chatId || tried.includes(chatId)) continue;
    tried.push(chatId);
    const tgData = await sendToTelegram(token, chatId, filename, mime, buffer);
    if (tgData && tgData.ok) return tgData;
    last = tgData;
  }
  return last || { ok: false, description: 'chat_id yo\'q' };
}

function explainTelegramError(tgData) {
  const desc = String(tgData?.description || 'noma\'lum');
  if (/chat not found/i.test(desc)) {
    return 'Telegram Chat ID topilmadi. Sozlamalarda to\'g\'ri Chat ID kiriting: botga /start yozing, ID ni @userinfobot dan oling, so\'ng «Saqlash va test yuborish» ni bosing.';
  }
  if (/bot was blocked|forbidden/i.test(desc)) {
    return 'Bot bloklangan yoki chatga yozish mumkin emas. Botga /start yuboring.';
  }
  return 'Telegram xatosi: ' + desc;
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

  let stagedPath = null;
  let requestBody = {};

  try {
    const { token, chatId } = await getTelegramSettings(supabaseUrl, serviceKey);
    if (!token) {
      res.status(400).json({ ok: false, error: 'Avval saytda Telegram Bot Token sozlanmagan' });
      return;
    }

    let filename = '';
    let mime = 'application/octet-stream';
    let buffer = null;
    let fallbackChatId = '';

    const ct = String(req.headers['content-type'] || '');

    if (ct.includes('application/json') || ct.includes('text/plain') || !ct.includes('multipart/')) {
      const raw = await readRawBody(req);
      try {
        requestBody = JSON.parse(raw.toString('utf8') || '{}');
      } catch (_) {
        res.status(400).json({ ok: false, error: 'JSON o\'qilmadi' });
        return;
      }
      fallbackChatId = requestBody.fallback_chat_id || requestBody.chat_id || '';

      if (requestBody.storagePath) {
        stagedPath = String(requestBody.storagePath).replace(/^\/+/, '').replace(/\.\./g, '');
        if (!stagedPath || stagedPath.includes('..')) {
          res.status(400).json({ ok: false, error: 'storagePath noto\'g\'ri' });
          return;
        }
        filename = requestBody.filename || stagedPath.split('/').pop() || 'fayl';
        mime = requestBody.mime || mime;
        buffer = await downloadFromStorage(supabaseUrl, serviceKey, stagedPath);
        if (buffer.length > MAX_STAGED_BYTES) {
          await deleteFromStorage(supabaseUrl, serviceKey, stagedPath);
          stagedPath = null;
          res.status(400).json({ ok: false, error: 'Fayl juda katta (maksimum 10 MB)' });
          return;
        }
      } else if (requestBody.data && requestBody.filename) {
        filename = requestBody.filename;
        mime = requestBody.mime || mime;
        buffer = Buffer.from(requestBody.data, 'base64');
        if (buffer.length > MAX_DIRECT_BYTES) {
          res.status(413).json({
            ok: false,
            error: 'Base64 juda katta. Brauzer staging orqali yuklasin (10 MB gacha).'
          });
          return;
        }
      } else {
        res.status(400).json({ ok: false, error: 'storagePath yoki (filename+data) kerak' });
        return;
      }
    } else {
      const raw = await readRawBody(req);
      if (raw.length > MAX_DIRECT_BYTES + 64 * 1024) {
        res.status(413).json({
          ok: false,
          error: 'To\'g\'ridan-to\'g\'ri yuklash limiti ~3.5 MB. Staging ishlaydi (10 MB).'
        });
        return;
      }
      const parts = parseMultipart(raw, ct);
      const filePart = parts.find((p) => p.name === 'file' || p.filename);
      const chatPart = parts.find((p) => p.name === 'fallback_chat_id' || p.name === 'chat_id');
      if (chatPart?.data) fallbackChatId = chatPart.data.toString('utf8');
      if (!filePart || !filePart.data?.length) {
        res.status(400).json({ ok: false, error: 'file maydoni topilmadi' });
        return;
      }
      filename = filePart.filename || 'fayl';
      mime = filePart.mime || mime;
      buffer = filePart.data;
    }

    const chatCandidates = [chatId, fallbackChatId].filter(Boolean);
    if (!chatCandidates.length) {
      res.status(400).json({
        ok: false,
        error: 'Telegram Chat ID sozlanmagan. Sozlamalarga Chat ID kiriting yoki profilingizga Telegram ID qo\'ying.'
      });
      return;
    }

    if (!filename || !buffer?.length) {
      res.status(400).json({ ok: false, error: 'Fayl bo\'sh' });
      return;
    }
    if (buffer.length > MAX_STAGED_BYTES) {
      res.status(400).json({ ok: false, error: 'Fayl juda katta (maksimum 10 MB)' });
      return;
    }

    const tgData = await sendDocumentToAnyChat(token, chatCandidates, filename, mime, buffer);

    if (stagedPath) {
      await deleteFromStorage(supabaseUrl, serviceKey, stagedPath);
      stagedPath = null;
    }

    if (!tgData.ok) {
      res.status(400).json({ ok: false, error: explainTelegramError(tgData) });
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
    if (stagedPath) {
      try {
        await deleteFromStorage(supabaseUrl, serviceKey, stagedPath);
      } catch (_) {}
    }
    const msg = String(e.message || e);
    if (/413|entity too large|payload/i.test(msg)) {
      res.status(413).json({ ok: false, error: 'So\'rov juda katta — staging (10 MB) yo\'lini ishlating' });
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
