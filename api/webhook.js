export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).end("ok");
  }

  try {
    const body = req.body;

    const lead =
      body?.leads?.status?.[0] ||
      body?.["leads[status][0]"];

    if (!lead) {
      console.log("⏭ Нет лида");
      return res.status(200).end("ok");
    }

    const leadId = lead.id || lead["id"];
    const statusId = String(lead.status_id || lead["status_id"]);
    const lastModified = lead.last_modified || lead["last_modified"];

    const LOST_STATUS_ID = process.env.LOST_STATUS_ID;

    console.log(`Lead ${leadId}, status ${statusId}`);

    if (statusId !== LOST_STATUS_ID) {
      console.log("⏭ Не проиграно");
      return res.status(200).end("ok");
    }

    const dedupeKey = `${leadId}_${lastModified}`;
    if (global.lastProcessed === dedupeKey) {
      console.log("⏭ Дубликат вебхука");
      return res.status(200).end("ok");
    }
    global.lastProcessed = dedupeKey;

    const accessToken = process.env.KOMMO_ACCESS_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN;

    if (!accessToken || !subdomain) {
      console.log("❌ Нет токена или сабдомена");
      return res.status(200).end("ok");
    }

    // Получаем переписку через Conversations API (работает с Salesbot WhatsApp)
    const conversationsRes = await fetch(
      `https://${subdomain}.kommo.com/api/v4/leads/${leadId}/conversations`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!conversationsRes.ok) {
      const text = await conversationsRes.text();
      console.log("❌ Ошибка conversations:", text);
      return res.status(200).end("ok");
    }

    const conversations = await conversationsRes.json();

    let messagesText = "";

    for (const conv of conversations._embedded?.conversations || []) {
      for (const msg of conv._embedded?.messages || []) {
        if (msg.text) {
          messagesText += msg.text + "\n";
        }
      }
    }

    if (!messagesText.trim()) {
      console.log("⏭ Нет переписки — анализ пропущен");
      return res.status(200).end("ok");
    }

    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Ты аналитик отдела продаж. Определи причину отказа клиента по переписке.\n\nПереписка:\n${messagesText}`,
      }),
    });

    const aiData = await aiRes.json();
    const analysis =
      aiData.output?.[0]?.content?.[0]?.text || "Не удалось определить причину";

    const noteRes = await fetch(
      `https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            note_type: "common",
            params: {
              text: `AI-анализ причины отказа:\n\n${analysis}`,
            },
          },
        ]),
      }
    );

    if (!noteRes.ok) {
      const text = await noteRes.text();
      console.log("❌ Ошибка добавления примечания:", text);
    } else {
      console.log("✅ Анализ добавлен в сделку", leadId);
    }

    return res.status(200).end("ok");
  } catch (e) {
    console.log("❌ Ошибка:", e.message);
    return res.status(200).end("ok");
  }
}