// task-temp bucketni ta'minlaydi va service-role signed upload URL qaytaradi.
// Shu bilan brauzer RLS/policy'siz 10 MB gacha yuklay oladi.
// Vercel env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'task-temp';

async function ensureBucket(supabaseUrl, serviceKey) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
  const getRes = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, { headers });
  if (getRes.ok) return;
  const createRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: 10485760
    })
  });
  if (!createRes.ok && createRes.status !== 409) {
    const t = await createRes.text().catch(() => '');
    if (!/already|exists|duplicate/i.test(t)) {
      throw new Error('Bucket yaratilmadi: ' + (t || createRes.status));
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan' });
    return;
  }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const filename = String(body.filename || 'fayl').replace(/[/\\]/g, '_').slice(0, 120);
    const mime = body.mime || 'application/octet-stream';
    const folder = String(body.folder || 'uploads').replace(/[^\w-]/g, '').slice(0, 80) || 'uploads';

    await ensureBucket(supabaseUrl, serviceKey);

    const storagePath = `${folder}/${Date.now()}_${filename}`;
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };

    // Signed upload URL (service role)
    const signRes = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      }
    );
    const signJson = await signRes.json().catch(() => ({}));
    if (!signRes.ok) {
      res.status(signRes.status).json({
        ok: false,
        error: signJson.message || signJson.error || 'Signed URL olinmadi'
      });
      return;
    }

    const token = signJson.token;
    const signedUrl = signJson.url
      ? (signJson.url.startsWith('http')
          ? signJson.url
          : `${supabaseUrl}/storage/v1${signJson.url.startsWith('/') ? '' : '/'}${signJson.url}`)
      : `${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`;

    res.status(200).json({
      ok: true,
      bucket: BUCKET,
      storagePath,
      token,
      signedUrl,
      mime
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
