const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const LOST_STATUS_ID = String(process.env.KOMMO_LOST_STATUS_ID);

// защита от дублей
const processedLeads = new Set();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    let leads = [];

    if (body?.leads?.status) {
      leads = body.leads.status;
    } else if (body['leads[status][0][id]']) {
      leads = [
        {
          id: body['leads[status][0][id]'],
          status_id: body['leads[status][0][status_id]'],
          updated_at: body['leads[status][0][updated_at]'],
        },
      ];
    }

    if (!leads.length) {
      return res.status(200).json({ ok: true });
    }

    for (const lead of leads) {
      const leadId = lead.id;
      const statusId = String(lead.status_id);
      const updatedAt = lead.updated_at || '';

      const dedupeKey = `${leadId}_${updatedAt}`;

      if (processedLeads.has(dedupeKey)) {
        console.log('⏭ Дубль вебхука пропущен');
        continue;
      }

      processedLeads.add(dedupeKey);

      console.log(`Lead ${leadId}, status: ${statusId}, expected lost: ${LOST_STATUS_ID}`);

      if (statusId !== LOST_STATUS_ID) {
        console.log('⏭ Не статус проиграно');
        continue;
      }

      const leadData = await getLeadData(leadId);
      const notes = await getLeadNotes(leadId);

      const context = buildContext(leadData, notes);

      if (context.includes('Переписки нет')) {
        console.log('⏭ Нет переписки — анализ пропущен');
        continue;
      }

      const analysis = await analyzeWithAI(context);
      await addNoteToLead(leadId, analysis);

      console.log(`✅ Анализ добавлен в сделку ${leadId}`);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('🔥 Общая ошибка:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getLeadData(leadId) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}?with=contacts`,
    {
      headers: {
        Authorization: `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.json();
}

async function getLeadNotes(leadId) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes?limit=100`,
    {
      headers: {
        Authorization: `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  return data?._embedded?.notes || [];
}

function extractNoteText(note) {
  if (note.note_type !== 'message_in' && note.note_type !== 'message_out') {
    return '';
  }

  if (note?.params?.text) return note.params.text;

  if (note?.params?.message?.text) return note.params.message.text;

  if (Array.isArray(note?.params?.message)) {
    return note.params.message.map(m => m.text).filter(Boolean).join(' ');
  }

  return '';
}

function buildContext(lead, notes) {
  const budget = lead.price || 0;
  const name = lead.name || 'Без названия';

  const fields = lead.custom_fields_values || [];
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = f.values?.[0]?.value || '';
  }

  const chat = notes
    .map(extractNoteText)
    .filter(Boolean)
    .join('\n');

  if (!chat) {
    return 'Переписки нет';
  }

  return `
Сделка: ${name}
Бюджет: ${budget}
Город: ${fieldMap['Город'] || 'не указан'}
Размер ковра: ${fieldMap['Размер ковра'] || 'не указан'}

Переписка клиента и менеджера:
${chat}
  `.trim();
}

async function analyzeWithAI(context) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты РОП. Анализируешь только переписку.

Игнорируй поля сделки.
Определи:
1. Где клиент потерял интерес
2. Ошибку менеджера
3. Конкретное действие для дожима

Формат:
🔴 Причина отказа:
💬 Где сломалась коммуникация:
💡 Что должен был сделать менеджер:`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  const data = await response.json();
  return `🤖 AI-анализ:\n\n${data.choices?.[0]?.message?.content || 'Ошибка анализа'}`;
}

async function addNoteToLead(leadId, text) {
  await fetch(`https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KOMMO_TOKEN}`,
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