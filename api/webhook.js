export default async function handler(req, res) {
  try {
    const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
    const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const leadId = req.body.lead_id;

    if (!leadId) {
      return res.status(200).json({ message: "Нет lead_id" });
    }

    console.log(`Lead ${leadId}`);

    const notesResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/leads/${leadId}/notes?limit=250`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
        },
      }
    );

    const notesData = await notesResp.json();

    const messages =
      notesData?._embedded?.notes
        ?.map((n) => n.params?.text)
        .filter(Boolean) || [];

    if (messages.length === 0) {
      console.log("⏭ Текстовых заметок нет");
      return res.status(200).json({ message: "Текстовых заметок нет" });
    }

    const chatText = messages.join("\n");

    console.log("✅ Текст заметок получен");

    return res.status(200).json({
      lead_id: leadId,
      messages_count: messages.length,
      chat: chatText,
    });
  } catch (e) {
    console.error("❌ Ошибка:", e);
    return res.status(500).json({ error: "Ошибка получения заметок" });
  }
}