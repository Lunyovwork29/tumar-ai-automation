export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const AMO_TOKEN = process.env.AMO_TOKEN;
  const AMO_DOMAIN = process.env.AMO_DOMAIN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  const LOST_STATUS_ID = 143;

  try {
    const leadId = req.body["leads[status][0][id]"];
    const statusId = Number(req.body["leads[status][0][status_id]"]);

    if (statusId !== LOST_STATUS_ID) {
      return res.status(200).end();
    }

    // защита от дублей
    const existingNotes = await amoRequest(
      AMO_DOMAIN,
      AMO_TOKEN,
      `/api/v4/leads/${leadId}/notes`
    );

    const alreadyAnalyzed = existingNotes?._embedded?.notes?.some(n =>
      n.params?.text?.includes("AI-анализ причины отказа")
    );

    if (alreadyAnalyzed) {
      return res.status(200).end();
    }

    // получаем контакт сделки
    const lead = await amoRequest(
      AMO_DOMAIN,
      AMO_TOKEN,
      `/api/v4/leads/${leadId}?with=contacts`
    );

    const contactId =
      lead?._embedded?.contacts?.[0]?.id;

    if (!contactId) {
      console.log("⏭ Нет контакта");
      return res.status(200).end();
    }

    // получаем чаты контакта
    const chats = await amoRequest(
      AMO_DOMAIN,
      AMO_TOKEN,
      `/api/v4/contacts/${contactId}/chats`
    );

    const chatId = chats?._embedded?.chats?.[0]?.id;

    if (!chatId) {
      console.log("⏭ Нет чата у контакта");
      return res.status(200).end();
    }

    // получаем сообщения
    const messages = await amoRequest(
      AMO_DOMAIN,
      AMO_TOKEN,
      `/api/v4/chats/${chatId}/messages`
    );

    const chatText = messages?._embedded?.messages
      ?.map(m => `${m.created_by === 0 ? "Клиент" : "Менеджер"}: ${m.text}`)
      .join("\n");

    if (!chatText) {
      console.log("⏭ Нет переписки");
      return res.status(200).end();
    }

    const context = `
Сделка: ${lead.name}
Бюджет: ${lead.price || "не указан"}

Переписка:
${chatText}
`;

    const aiText = await analyze(context, OPENAI_KEY);

    await amoRequest(
      AMO_DOMAIN,
      AMO_TOKEN,
      `/api/v4/leads/${leadId}/notes`,
      "POST",
      {
        note_type: "common",
        params: { text: aiText }
      }
    );

    console.log(`✅ Анализ добавлен в сделку ${leadId}`);

    return res.status(200).end();
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
}

async function amoRequest(domain, token, path, method = "GET", body) {
  const res = await fetch(`https://${domain}.kommo.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    console.error("❌ Не JSON:", text);
    throw new Error("Kommo returned HTML");
  }
}

async function analyze(context, key) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: `
Ты аналитик продаж.

Проанализируй диалог менеджера с клиентом.

Напиши:

Причина отказа:
Что произошло в диалоге:
Ошибки менеджера:
Что делать иначе:

Коротко.

${context}
`
    })
  });

  const data = await res.json();
  return `AI-анализ причины отказа:\n\n${data.output_text}`;
}