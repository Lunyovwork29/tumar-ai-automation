// api/webhook.js — Kommo вебхук → OpenAI → примечание в сделку
// Использует Notes + Events (переписка WhatsApp недоступна через внешний API)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
  const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const LOST_STATUS_ID = process.env.KOMMO_LOST_STATUS_ID;

  try {
    const body = req.body;
    console.log("Webhook body:", JSON.stringify(body).slice(0, 500));

    const leads =
      body?.leads?.status ||
      body?.leads?.update ||
      body?.leads?.add ||
      [];

    for (const lead of leads) {
      const leadId = String(lead.id);
      const statusId = String(lead.status_id);

      console.log(`Lead ${leadId}, status: ${statusId}`);

      if (LOST_STATUS_ID && statusId !== String(LOST_STATUS_ID)) {
        console.log("Не нереализовано, пропускаем");
        continue;
      }

      const [leadData, notes, events] = await Promise.all([
        getLeadData(leadId, KOMMO_DOMAIN, KOMMO_TOKEN),
        getLeadNotes(leadId, KOMMO_DOMAIN, KOMMO_TOKEN),
        getLeadEvents(leadId, KOMMO_DOMAIN, KOMMO_TOKEN),
      ]);

      const context = buildContext(leadData, notes, events);
      const analysis = await analyzeWithAI(context, OPENAI_KEY);
      await addNoteToLead(leadId, analysis, KOMMO_DOMAIN, KOMMO_TOKEN);

      console.log(`✅ Анализ добавлен в сделку ${leadId}`);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

async function getLeadData(leadId, domain, token) {
  const r = await fetch(
    `https://${domain}/api/v4/leads/${leadId}?with=contacts,loss_reason`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return r.json();
}

async function getLeadNotes(leadId, domain, token) {
  const r = await fetch(
    `https://${domain}/api/v4/leads/${leadId}/notes?limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  return data?._embedded?.notes || [];
}

async function getLeadEvents(leadId, domain, token) {
  const r = await fetch(
    `https://${domain}/api/v4/events?filter[entity_id]=${leadId}&filter[entity_type]=lead&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  return data?._embedded?.events || [];
}

function buildContext(lead, notes, events) {
  const name = lead.name || "Без названия";
  const budget = lead.price ? `${lead.price} тенге` : "не указан";
  const createdAt = lead.created_at ? new Date(lead.created_at * 1000).toLocaleDateString("ru-RU") : "—";
  const closedAt = lead.closed_at ? new Date(lead.closed_at * 1000).toLocaleDateString("ru-RU") : "—";
  const daysOpen = lead.created_at && lead.closed_at ? Math.round((lead.closed_at - lead.created_at) / 86400) : "—";
  const lossReason = lead.loss_reason?.name || "не указана";

  const fields = lead.custom_fields_values || [];
  const fieldMap = {};
  for (const f of fields) fieldMap[f.field_name] = f.values?.[0]?.value || "";

  const notesText = notes
    .filter((n) => n.params?.text)
    .slice(-20)
    .map((n) => `[${new Date(n.created_at * 1000).toLocaleDateString("ru-RU")}] ${n.params.text}`)
    .join("\n") || "Примечаний нет";

  const eventsText = events
    .slice(-15)
    .map((e) => `[${new Date(e.created_at * 1000).toLocaleDateString("ru-RU")}] ${e.type}: ${e.value_after?.[0]?.note?.text || e.value_after?.[0]?.lead_status?.name || ""}`)
    .filter((e) => !e.endsWith(": "))
    .join("\n") || "Событий нет";

  return `
=== ДАННЫЕ СДЕЛКИ ===
Название: ${name}
Бюджет: ${budget}
Создана: ${createdAt} | Закрыта: ${closedAt} | Дней в работе: ${daysOpen}
Причина отказа в CRM: ${lossReason}

=== КАСТОМНЫЕ ПОЛЯ ===
Размер ковра: ${fieldMap["Размер ковра"] || "не указан"}
Класс ковра: ${fieldMap["Класс ковра"] || "не указан"}
Тип продажи: ${fieldMap["Тип продажи"] || "не указан"}
Город: ${fieldMap["Город"] || "не указан"}
Филиал: ${fieldMap["Филиал"] || "не указан"}

=== ПРИМЕЧАНИЯ МЕНЕДЖЕРА ===
${notesText}

=== ИСТОРИЯ СОБЫТИЙ ===
${eventsText}
`.trim();
}

async function analyzeWithAI(context, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Ты аналитик отдела продаж компании "Tumar" по продаже ручных ковров премиум-класса.
Анализируй данные закрытой сделки и определи ГЛАВНУЮ причину почему клиент не купил.

Возможные причины:
1. 💸 Цена — дорого, не устроила стоимость
2. 🏃 Конкурент — ушёл к другому продавцу
3. 🎯 Не целевой — изначально не наш клиент
4. 😴 Менеджер не дожал — не было follow-up, клиент "остыл"
5. 📦 Нет нужного товара — не нашли подходящий вариант
6. ⏸️ Отложил — личные обстоятельства, перенёс покупку
7. 📵 Нет контакта — клиент перестал отвечать
8. ❓ Другое — опиши кратко

Отвечай ТОЛЬКО в этом формате:
━━━━━━━━━━━━━━━━━━━━
🤖 AI-АНАЛИЗ ПРИЧИНЫ ОТКАЗА
━━━━━━━━━━━━━━━━━━━━
🔴 Причина: [эмодзи + название]
💬 Что произошло: [1-2 предложения конкретно по этой сделке]
💡 Что можно было сделать: [конкретная рекомендация]
━━━━━━━━━━━━━━━━━━━━`,
        },
        { role: "user", content: context },
      ],
      max_tokens: 350,
      temperature: 0.2,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Анализ недоступен";
}

async function addNoteToLead(leadId, text, domain, token) {
  const r = await fetch(`https://${domain}/api/v4/leads/${leadId}/notes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ note_type: "common", params: { text } }]),
  });
  return r.json();
}
