// task-temp bucket yo'q bo'lsa yaratadi (service role).
// Brauzer yuklashdan oldin chaqiriladi — "Bucket not found" ni oldini oladi.
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'task-temp';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan' });
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // Mavjudmi?
    const getRes = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, { headers });
    if (getRes.ok) {
      res.status(200).json({ ok: true, created: false, bucket: BUCKET });
      return;
    }

    const createRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: BUCKET,
        name: BUCKET,
        public: false,
        file_size_limit: 10485760,
        allowed_mime_types: null
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '');
      // Conflict = allaqachon bor
      if (createRes.status === 409 || /already|exists|duplicate/i.test(errText)) {
        res.status(200).json({ ok: true, created: false, bucket: BUCKET });
        return;
      }
      res.status(createRes.status).json({
        ok: false,
        error: 'Bucket yaratilmadi: ' + (errText || createRes.status)
      });
      return;
    }

    res.status(200).json({ ok: true, created: true, bucket: BUCKET });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
