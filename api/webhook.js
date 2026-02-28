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

    // 1. Получаем контакт сделки
    const leadResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/leads/${leadId}?with=contacts`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
        },
      }
    );

    const leadData = await leadResp.json();

    const contactId = leadData?._embedded?.contacts?.[0]?.id;

    if (!contactId) {
      console.log("⏭ Контакт не найден");
      return res.status(200).json({ message: "Контакт не найден" });
    }

    console.log(`Contact ${contactId}`);

    // 2. Получаем чаты контакта
    const chatsResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/contacts/${contactId}/chats`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
        },
      }
    );

    const chatsData = await chatsResp.json();

    const chatId = chatsData?._embedded?.chats?.[0]?.id;

    if (!chatId) {
      console.log("⏭ Чат у контакта не найден");
      return res.status(200).json({ message: "Чат у контакта не найден" });
    }

    console.log(`Chat ${chatId}`);

    // 3. Получаем сообщения
    const messagesResp = await fetch(
      `https://${KOMMO_DOMAIN}.kommo.com/api/v4/chats/${chatId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${KOMMO_TOKEN}`,
        },
      }
    );

    const messagesData = await messagesResp.json();

    const messages =
      messagesData?._embedded?.messages
        ?.map((m) => m.text)
        .filter(Boolean) || [];

    if (messages.length === 0) {
      console.log("⏭ Сообщений нет");
      return res.status(200).json({ message: "Сообщений нет" });
    }

    const chatText = messages.join("\n");

    console.log("✅ Чат получен");

    return res.status(200).json({
      lead_id: leadId,
      contact_id: contactId,
      chat_id: chatId,
      messages_count: messages.length,
      chat: chatText,
    });
  } catch (e) {
    console.error("❌ Ошибка:", e);
    return res.status(500).json({ error: "Ошибка получения чата" });
  }
}