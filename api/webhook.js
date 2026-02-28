export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const body = req.body;

    // === универсальный парсинг webhook ===
    const leadId =
      body?.["leads[status][0][id]"] ??
      body?.leads?.status?.[0]?.id;

    const statusId =
      body?.["leads[status][0][status_id]"] ??
      body?.leads?.status?.[0]?.status_id;

    const lastModified =
      body?.["leads[status][0][last_modified]"] ??
      body?.leads?.status?.[0]?.last_modified;

    if (!leadId || !statusId) {
      console.log("⏭ Нет лида");
      return res.status(200).end();
    }

    console.log(`Lead ${leadId}, status ${statusId}`);

    const LOST_STATUS = String(process.env.KOMMO_LOST_STATUS_ID);

    if (String(statusId) !== LOST_STATUS) {
      console.log("⏭ Не проиграно");
      return res.status(200).end();
    }

    // === дедупликация по last_modified ===
    const dedupeKey = `${leadId}_${lastModified}`;
    if (global.lastProcessed === dedupeKey) {
      console.log("⏭ Дубликат события");
      return res.status(200).end();
    }
    global.lastProcessed = dedupeKey;

    const domain = process.env.KOMMO_DOMAIN;
    const token = process.env.KOMMO_LONG_TOKEN;

    // === получаем переписку ===
    let chatText = "";

    try {
      const linksRes = await fetch(
        `https://${domain}.kommo.com/api/v4/leads/${leadId}/links`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const linksData = await linksRes.json();

      const conversation = linksData?._embedded?.links?.find(
        (l) => l.entity_type === "conversation"
      );

      if (conversation) {
        const convId = conversation.to_entity_id;

        const msgRes = await fetch(
          `https://${domain}.kommo.com/api/v4/conversations/${convId}/messages`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const msgData = await msgRes.json();

        chatText = msgData?._embedded?.messages
          ?.map((m) => m.text)
          .filter(Boolean)
          .join("\n");
      }
    } catch (e) {
      console.log("⏭ Ошибка получения чата");
    }

    if (!chatText) {
      chatText = "Переписка отсутствует";
    }

    // === запрос к OpenAI ===
    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Ты РОП. Проанализируй причину проигрыша сделки.

Переписка:
${chatText}

Дай:
1. Причину отказа
2. Ошибки менеджера
3. Что делать в следующий раз`,
      }),
    });

    const aiData = await aiRes.json();

    const aiText =
      aiData?.output?.[0]?.content?.[0]?.text ??
      "Не удалось получить анализ";

    // === добавляем примечание ===
    await fetch(`https://${domain}.kommo.com/api/v4/leads/${leadId}/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          note_type: "common",
          params: {
            text: `AI-анализ причины отказа:\n\n${aiText}`,
          },
        },
      ]),
    });

    console.log(`✅ Анализ добавлен в сделку ${leadId}`);

    return res.status(200).end();
  } catch (e) {
    console.error(e);
    return res.status(200).end();
  }
}