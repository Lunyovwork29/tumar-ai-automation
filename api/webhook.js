import fetch from "node-fetch";

const SUBDOMAIN = "tumarcarpets";
const BASE_URL = `https://${SUBDOMAIN}.kommo.com`;

const CLIENT_ID = process.env.KOMMO_CLIENT_ID;
const CLIENT_SECRET = process.env.KOMMO_CLIENT_SECRET;
const REDIRECT_URI = process.env.KOMMO_REDIRECT_URI;

let accessToken = process.env.KOMMO_ACCESS_TOKEN;
let refreshToken = process.env.KOMMO_REFRESH_TOKEN;

async function refreshAccessToken() {
  const res = await fetch(`${BASE_URL}/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json();

  accessToken = data.access_token;
  refreshToken = data.refresh_token;

  console.log("🔄 Token refreshed");
}

async function kommoFetch(url, options = {}) {
  if (!accessToken) {
    throw new Error("No access token");
  }

  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    await refreshAccessToken();
    return kommoFetch(url, options);
  }

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    console.error("❌ Не JSON:", text.slice(0, 200));
    throw new Error("Kommo returned HTML instead of JSON");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;

  console.log("Webhook received:", body);

  const leadId = body["leads[status][0][id]"];
  const statusId = body["leads[status][0][status_id]"];

  if (!leadId || !statusId) {
    return res.status(200).json({ ok: true });
  }

  const LOST_STATUS_ID = "143";

  if (statusId !== LOST_STATUS_ID) {
    console.log("⏭ Не проигранная сделка");
    return res.status(200).json({ ok: true });
  }

  console.log(`Lead ${leadId} проиграна. Получаем чат.`);

  try {
    const lead = await kommoFetch(`/api/v4/leads/${leadId}?with=contacts`);

    const contactId =
      lead._embedded?.contacts?.[0]?.id;

    if (!contactId) {
      console.log("⏭ Нет контакта");
      return res.status(200).json({ ok: true });
    }

    const chats = await kommoFetch(
      `/api/v4/contacts/${contactId}/chats`
    );

    const chatId = chats?._embedded?.chats?.[0]?.id;

    if (!chatId) {
      console.log("⏭ Нет чата");
      return res.status(200).json({ ok: true });
    }

    const messages = await kommoFetch(
      `/api/v4/chats/${chatId}/messages`
    );

    const chatText = messages?._embedded?.messages
      ?.map((m) => m.text)
      .filter(Boolean)
      .join("\n");

    if (!chatText) {
      console.log("⏭ Нет переписки");
      return res.status(200).json({ ok: true });
    }

    const analysisText = `AI-анализ переписки:

${chatText.slice(0, 1500)}`;

    await kommoFetch(`/api/v4/leads/${leadId}/notes`, {
      method: "POST",
      body: JSON.stringify([
        {
          note_type: "common",
          params: { text: analysisText },
        },
      ]),
    });

    console.log(`✅ Анализ добавлен в сделку ${leadId}`);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Ошибка:", e.message);
    return res.status(200).json({ ok: true });
  }
}