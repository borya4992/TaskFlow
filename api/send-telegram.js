// Vercel serverless function (Node.js).
// Bu fayl Telegram xabarini serverdan yuboradi, shu bilan brauzerdagi CORS muammosining oldini oladi.
// Hech qanday qo'shimcha sozlash shart emas — Vercel bu faylni avtomatik /api/send-telegram manziliga aylantiradi.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const { token, chat_id, text } = req.body || {};
    if (!token || !chat_id || !text) {
      res.status(400).json({ ok: false, error: 'token, chat_id yoki text yetishmayapti' });
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
    res.status(500).json({ ok: false, error: e.message });
  }
};
