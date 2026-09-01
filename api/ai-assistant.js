// AI ASSISTANT — Google Gemini (bepul daraja) bilan. Faqat direktor/admin foydalana oladi.
// Gemini bilan gaplashadi, kerak bo'lsa TOOLS orqali Supabase'ga amal bajaradi.
//
// Vercel Environment Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY

const { TOOLS } = require('./_toolExecutors');

// Joriy bepul, tez va vositalarni qo'llaydigan model. Agar xato bersa,
// https://ai.google.dev/gemini-api/docs/models dan joriy model nomini tekshiring.
const MODEL = 'gemini-3.6-flash'; // 2026-yil iyulida Google yangiladi (eskisi: gemini-2.0-flash, endi ishlamaydi)

const SYSTEM_PROMPT = `Sen "Traksa" topshiriqlar monitoring tizimidagi AI yordamchisan.
Faqat direktor/admin bilan gaplashyapsan. O'zbek tilida, qisqa va aniq javob ber.
Ma'lumot kerak bo'lsa yoki topshiriq yaratish/o'zgartirish so'ralsa, mos vositadan (function) foydalan.
Agar xodim ismi noaniq bo'lsa (bir nechta mos keluvchi topilsa), taxmin qilma — foydalanuvchidan
aniqlashtirishni so'ra. Muddat berilmagan yoki noaniq bo'lsa, aniq sana so'ra.`;

// Gemini function-calling formatidagi vosita ta'riflari (OpenAPI-subset schema, TYPE'lar katta harf bilan)
const TOOL_DECLARATIONS = [
  {
    name: 'get_dashboard_summary',
    description: "Barcha faol topshiriqlarning umumiy holatini (jami, jarayonda, tekshiruvda, bajarildi, muddati o'tgan) qaytaradi.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_overdue_tasks',
    description: "Muddati o'tib ketgan, hali bajarilmagan barcha topshiriqlar ro'yxatini qaytaradi.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_employee_tasks',
    description: 'Muayyan bitta xodimning barcha faol topshiriqlarini qaytaradi.',
    parameters: {
      type: 'OBJECT',
      properties: { employee_name: { type: 'STRING', description: "Xodimning to'liq yoki qisman ismi" } },
      required: ['employee_name'],
    },
  },
  {
    name: 'list_employees',
    description: "Tizimdagi barcha faol xodimlar ro'yxatini qaytaradi.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'create_task',
    description: 'Yangi topshiriq yaratadi va bitta xodimga tayinlaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Topshiriq sarlavhasi' },
        description: { type: 'STRING', description: "Qo'shimcha tavsif (ixtiyoriy)" },
        assignee_name: { type: 'STRING', description: "Tayinlanadigan xodimning to'liq ismi" },
        deadline: { type: 'STRING', description: 'Muddat, YYYY-MM-DD formatida' },
        priority: { type: 'STRING', enum: ['Past', "O'rta", 'Yuqori', 'Shoshilinch'] },
      },
      required: ['title', 'assignee_name', 'deadline'],
    },
  },
  {
    name: 'update_task_status',
    description: "Mavjud topshiriqning holatini o'zgartiradi. Topshiriq sarlavhaning bir qismi orqali qidiriladi.",
    parameters: {
      type: 'OBJECT',
      properties: {
        task_title_search: { type: 'STRING', description: 'Topshiriq sarlavhasidan qidiruv matni' },
        new_status: { type: 'STRING', enum: ['jarayonda', 'tekshiruvda', 'bajarildi'] },
      },
      required: ['task_title_search', 'new_status'],
    },
  },
];

async function getAuthUserByJwt(supabaseUrl, serviceKey, jwt) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getCallerStaffRow(supabaseUrl, serviceKey, authUserId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/app_users?auth_user_id=eq.${authUserId}&select=id,display_name,role,is_active,ai_assistant_access`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}

async function callGeminiWithHeaders(apiKey, contents, headers) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      contents,
    }),
  });
  return res;
}

async function callGemini(apiKey, contents) {
  // 1-urinish: standart usul (x-goog-api-key). Google hujjatlarida shu tavsiya etiladi.
  let res = await callGeminiWithHeaders(apiKey, contents, { 'x-goog-api-key': apiKey });

  // 2-urinish (zaxira): ba'zi "AQ." formatidagi kalitlar hozircha faqat OAuth uslubidagi
  // Authorization: Bearer sarlavhasini qabul qilyapti (Google tizimidagi vaqtinchalik
  // beqarorlik tufayli). Aynan shu xato turi chiqsa, avtomatik shu usulni sinaymiz.
  if (!res.ok) {
    const firstErrText = await res.text().catch(() => '');
    const looksLikeAuthTypeIssue =
      res.status === 401 && /oauth|access token|authentication credentials/i.test(firstErrText);
    if (looksLikeAuthTypeIssue) {
      res = await callGeminiWithHeaders(apiKey, contents, { Authorization: `Bearer ${apiKey}` });
    } else {
      throw new Error(`Gemini API xatosi (${res.status}): ${firstErrText}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API xatosi (${res.status}): ${errText} — ikkala autentifikatsiya usuli ham ishlamadi, API kalitini tekshiring.`);
  }
  return res.json();
}

async function saveMessage(supabaseUrl, serviceKey, userId, role, content) {
  await fetch(`${supabaseUrl}/rest/v1/ai_chat_messages`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ user_id: userId, role, content }),
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!supabaseUrl || !serviceKey || !geminiKey) {
    res.status(500).json({ ok: false, error: 'Server sozlanmagan (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY)' });
    return;
  }

  try {
    // 1) Avtorizatsiya
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) { res.status(401).json({ ok: false, error: 'Avtorizatsiya kerak' }); return; }
    const me = await getAuthUserByJwt(supabaseUrl, serviceKey, jwt);
    if (!me?.id) { res.status(401).json({ ok: false, error: 'Sessiya yaroqsiz' }); return; }

    // 2) FAQAT direktor/admin
    const staffRow = await getCallerStaffRow(supabaseUrl, serviceKey, me.id);
    // Ruxsat ikki yo'l bilan: (1) role='admin', yoki (2) admin tomonidan
    // Boshqaruv panelidan alohida ruxsat berilgan (ai_assistant_access=true).
    const isAdmin = staffRow?.role === 'admin';
    const hasGrantedAccess = staffRow?.ai_assistant_access === true;
    if (!staffRow || !staffRow.is_active || !(isAdmin || hasGrantedAccess)) {
      res.status(403).json({ ok: false, error: 'Sizda AI Yordamchidan foydalanish huquqi yo\'q. Admin bilan bog\'laning.' });
      return;
    }

    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ ok: false, error: 'message kerak' });
      return;
    }

    await saveMessage(supabaseUrl, serviceKey, staffRow.id, 'user', message);

    const ctx = { supabaseUrl, serviceKey, callerId: staffRow.id };
    // Gemini formatidagi tarix: role 'user' | 'model', har biri parts massivi bilan
    let contents = [...(Array.isArray(history) ? history : []), { role: 'user', parts: [{ text: message }] }];

    let finalText = '';
    for (let round = 0; round < 5; round++) {
      const response = await callGemini(geminiKey, contents);
      const candidate = response.candidates && response.candidates[0];
      const parts = candidate?.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall);

      if (functionCalls.length === 0) {
        finalText = parts.map((p) => p.text || '').join('\n').trim();
        break;
      }

      contents.push({ role: 'model', parts });

      const functionResponseParts = [];
      for (const p of functionCalls) {
        const { name, args, id: callId } = p.functionCall;
        const executor = TOOLS[name];
        let result;
        if (!executor) {
          result = { error: `Noma'lum vosita: ${name}` };
        } else {
          try {
            result = await executor(args || {}, ctx);
          } catch (e) {
            result = { error: e.message };
          }
        }
        // Gemini 3.x talabi: FunctionResponse mos FunctionCall'ning id'sini
        // ("call_id") o'zida saqlashi kerak, aks holda so'rov rad etilishi mumkin.
        const responsePart = { functionResponse: { name, response: result } };
        if (callId) responsePart.functionResponse.id = callId;
        functionResponseParts.push(responsePart);
      }
      contents.push({ role: 'user', parts: functionResponseParts });
    }

    if (!finalText) {
      finalText = "Kechirasiz, so'rovingizni to'liq bajara olmadim. Iltimos, boshqacharoq so'rab ko'ring.";
    }

    await saveMessage(supabaseUrl, serviceKey, staffRow.id, 'assistant', finalText);

    res.status(200).json({ ok: true, reply: finalText });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
