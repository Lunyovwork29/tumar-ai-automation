// api/webhook.js — Kommo вебхук → OpenAI → примечание в сделку

const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN; // tumarcarpets.kommo.com
const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ID этапа "Закрыто и нереализовано" в Kommo
// Узнать можно через: GET https://tumarcarpets.kommo.com/api/v4/leads/pipelines
const LOST_STATUS_ID = process.env.KOMMO_LOST_STATUS_ID; // например "143"

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    // Kommo шлёт данные в leads[status] при смене статуса
    const leads = body?.leads?.status || body?.leads?.add || [];

    for (const lead of leads) {
      const leadId = lead.id;
      const statusId = String(lead.status_id);

      console.log(`Lead ${leadId}, status: ${statusId}, expected lost: ${LOST_STATUS_ID}`);

      // Проверяем что это именно "Нереализовано"
      if (statusId !== String(LOST_STATUS_ID)) {
        console.log('Not a lost deal, skipping');
        continue;
      }

      // Получаем полные данные сделки
      const leadData = await getLeadData(leadId);

      // Получаем примечания сделки
      const notes = await getLeadNotes(leadId);

      // Формируем контекст для GPT
      const context = buildContext(leadData, notes);

      // Анализируем через OpenAI
      const analysis = await analyzeWithAI(context);

      // Пишем примечание в Kommo
      await addNoteToLead(leadId, analysis);

      console.log(`✅ Анализ добавлен в сделку ${leadId}`);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Получить данные сделки
async function getLeadData(leadId) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}?with=contacts,pipeline`,
    {
      headers: {
        'Authorization': `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
}

// Получить примечания сделки
async function getLeadNotes(leadId) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes?limit=50`,
    {
      headers: {
        'Authorization': `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const data = await response.json();
  return data?._embedded?.notes || [];
}

// Собрать контекст для GPT
function buildContext(lead, notes) {
  const budget = lead.price || 0;
  const name = lead.name || 'Без названия';
  const createdAt = new Date(lead.created_at * 1000).toLocaleDateString('ru-RU');
  const closedAt = new Date(lead.closed_at * 1000).toLocaleDateString('ru-RU');

  // Кастомные поля
  const fields = lead.custom_fields_values || [];
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = f.values?.[0]?.value || '';
  }

  // Примечания текстом
  const notesText = notes
    .filter(n => n.note_type === 'common' || n.note_type === 4)
    .map(n => `- ${n.params?.text || ''}`)
    .join('\n') || 'Примечаний нет';

  return `
Название сделки: ${name}
Бюджет: ${budget} тенге
Дата создания: ${createdAt}
Дата закрытия: ${closedAt}
Размер ковра: ${fieldMap['Размер ковра'] || 'не указан'}
Класс ковра: ${fieldMap['Класс ковра'] || 'не указан'}
Тип продажи: ${fieldMap['Тип продажи'] || 'не указан'}
Город: ${fieldMap['Город'] || 'не указан'}

Примечания менеджера:
${notesText}
  `.trim();
}

// Анализ через OpenAI
async function analyzeWithAI(context) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты аналитик отдела продаж компании по продаже ручных ковров премиум-класса.
Анализируй закрытые сделки и определяй причину почему клиент не купил.

Возможные причины:
1. Цена — клиента не устроила стоимость / дорого
2. Конкурент — ушёл к другому продавцу
3. Не целевой — изначально не подходил под целевую аудиторию
4. Менеджер не дожал — потеря контакта, долго думал, не было follow-up
5. Нет нужного товара — не нашли подходящий ковёр по размеру/классу
6. Личные обстоятельства — отложил покупку, финансовые трудности
7. Нет контакта — менеджер не дозвонился, клиент перестал отвечать
8. Другое — опиши кратко

Отвечай строго в формате:
🔴 Причина отказа: [название причины]
💬 Что произошло: [1-2 предложения конкретно по этой сделке]
💡 Рекомендация: [что можно было сделать иначе]`,
        },
        {
          role: 'user',
          content: `Проанализируй эту закрытую сделку:\n\n${context}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || 'Анализ недоступен';
  return `🤖 AI-анализ причины отказа:\n\n${text}`;
}

// Добавить примечание в сделку
async function addNoteToLead(leadId, text) {
  await fetch(`https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KOMMO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        note_type: 'common',
        params: { text },
      },
    ]),
  });
}
