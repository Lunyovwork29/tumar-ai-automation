export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body;

    const leadId = body["leads[status][0][id]"];
    const statusId = body["leads[status][0][status_id]"];
    const lastModified = body["leads[status][0][last_modified]"];

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

    const cacheKey = `lead_${leadId}_${lastModified}`;
    if (global[cacheKey]) {
      console.log("⏭ Дубликат вебхука");
      return res.status(200).end();
    }
    global[cacheKey] = true;

    const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
    const TOKEN = process.env.KOMMO_LONG_TOKEN;

    const notesRes = await fetch(
      `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );

    const notesData = await notesRes.json();

    const textNotes =
      notesData?._embedded?.notes
        ?.map((n) => n.params?.text)
        ?.filter(Boolean)
        ?.join("\n") || "";

    if (!textNotes) {
      console.log("⏭ Нет переписки — анализ пропущен");
      return res.status(200).end();
    }

    const prompt = `
Ты анализируешь причину проигрыша сделки.

Данные из CRM:
Источник: ${body["leads[status][0][custom_fields][0][values][0][value]"] || "-"}
Город: ${body["leads[status][0][custom_fields][1][values][0][value]"] || "-"}
Размер ковра: ${body["leads[status][0][custom_fields][2][values][0][value]"] || "-"}

Переписка:
${textNotes}

Ответ дай в формате:
Причина отказа:
Что произошло:
Рекомендации менеджеру:
`;

    const aiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: prompt,
      }),
    });

    const aiData = await aiRes.json();
    const analysis = aiData.output_text || "Не удалось получить анализ";

    await fetch(`https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
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
    });

    console.log(`✅ Анализ добавлен в сделку ${leadId}`);

    return res.status(200).end();
  } catch (e) {
    console.error("❌ Ошибка:", e);
    return res.status(200).end();
  }
}