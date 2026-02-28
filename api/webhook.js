export default async function handler(req, res) {
  try {
    const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN; // только поддомен
    const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const leadId = req.body.lead_id;

    if (!leadId) {
      console.log("⏭ Нет lead_id");
      return res.status(200).json({ message: "Нет lead_id" });
    }

    console.log(`Lead ${leadId} — получаем чат`);

    // 1. Получаем связанные чаты сделки
    const linksResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/leads/${leadId}/links`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const linksData = await linksResp.json();

    const conversations = linksData?._embedded?.links?.filter(
      (l) => l.to_entity_type === "conversations"
    );

    if (!conversations || conversations.length === 0) {
      console.log("⏭ Чаты не найдены");
      return res.status(200).json({ message: "Чаты не найдены" });
    }

    const conversationId = conversations[0].to_entity_id;

    console.log(`Conversation ${conversationId}`);

    // 2. Получаем сообщения чата
    const messagesResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/conversations/${conversationId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const messagesData = await messagesResp.json();

    const messages =
      messagesData?._embedded?.messages?.map((m) => m.text).filter(Boolean) ||
      [];

    if (messages.length === 0) {
      console.log("⏭ Сообщений нет");
      return res.status(200).json({ message: "Сообщений нет" });
    }

    const chatText = messages.join("\n");

    console.log("✅ Чат получен");
    console.log(chatText);

    return res.status(200).json({
      lead_id: leadId,
      messages_count: messages.length,
      chat: chatText,
    });
  } catch (e) {
    console.error("❌ Ошибка:", e);
    return res.status(500).json({ error: "Ошибка получения чата" });
  }
}