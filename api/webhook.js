const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
const KOMMO_TOKEN = process.env.KOMMO_LONG_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const LOST_STATUS_ID = String(process.env.KOMMO_LOST_STATUS_ID);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    let leads = [];

    // Новый формат Kommo
    if (body?.leads?.status) {
      leads = body.leads.status;
    } else if (body?.leads?.add) {
      leads = body.leads.add;
    }
    // Старый формат amoCRM / Kommo
    else if (body['leads[status][0][id]']) {
      leads = [
        {
          id: body['leads[status][0][id]'],
          status_id: body['leads[status][0][status_id]'],
        },
      ];
    }
    // Если когда-нибудь появится робот с JSON
    else if (body?.lead_id) {
      leads = [
        {
          id: body.lead_id,
          status_id: body.status_id,
        },
      ];
    }

    if (!leads.length) {
      console.log('❌ Не найдены сделки в payload');
      return res.status(200).json({ ok: true });
    }

    for (const lead of leads) {
      const leadId = lead.id;
      const statusId = String(lead.status_id);

      console.log(`Lead ${leadId}, status: ${statusId}, expected lost: ${LOST_STATUS_ID}`);

      if (statusId !== LOST_STATUS_ID) {
        console.log('⏭ Не статус "Проиграно"');
        continue;
      }

      const leadData = await getLeadData(leadId);
      if (!leadData?.id) {
        console.log('❌ Ошибка получения сделки из Kommo', leadData);
        continue;
      }

      const notes = await getLeadNotes(leadId);
      const context = buildContext(leadData, notes);

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
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}?with=contacts,pipeline`,
    {
      headers: {
        Authorization: `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log('❌ Kommo getLeadData error:', data);
  }

  return data;
}

async function getLeadNotes(leadId) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes?limit=50`,
    {
      headers: {
        Authorization: `Bearer ${KOMMO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log('❌ Kommo getLeadNotes error:', data);
  }

  return data?._embedded?.notes || [];
}

function buildContext(lead, notes) {
  const budget = lead.price || 0;
  const name = lead.name || 'Без названия';
  const createdAt = new Date(lead.created_at * 1000).toLocaleDateString('ru-RU');
  const closedAt = lead.closed_at
    ? new Date(lead.closed_at * 1000).toLocaleDateString('ru-RU')
    : 'не указана';

  const fields = lead.custom_fields_values || [];
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = f.values?.[0]?.value || '';
  }

  const notesText =
    notes
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
          content: `Ты аналитик отдела продаж компании по продаже ручных ковров премиум-класса.
Определи причину отказа и дай рекомендацию.

Формат ответа:
🔴 Причина отказа: ...
💬 Что произошло: ...
💡 Рекомендация: ...`,
        },
        {
          role: 'user',
          content: context,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.log('❌ OpenAI error:', data);
    return '❌ Ошибка анализа OpenAI';
  }

  const text = data.choices?.[0]?.message?.content || 'Анализ недоступен';
  return `🤖 AI-анализ причины отказа:\n\n${text}`;
}

async function addNoteToLead(leadId, text) {
  const response = await fetch(
    `https://${KOMMO_DOMAIN}/api/v4/leads/${leadId}/notes`,
    {
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
    }
  );

  if (!response.ok) {
    const data = await response.json();
    console.log('❌ Kommo addNote error:', data);
  }
}