# Tumar AI Automation

Автоматический анализ причин отказа в сделках Kommo CRM через OpenAI.

## Как работает

1. Клиент переходит на этап "Нереализовано" в Kommo
2. Kommo отправляет вебхук на Vercel
3. Код получает полные данные сделки + примечания
4. OpenAI анализирует и определяет причину отказа
5. Результат автоматически добавляется как примечание в сделку

## Переменные окружения (Vercel → Settings → Environment Variables)

```
KOMMO_DOMAIN=tumarcarpets.kommo.com
KOMMO_LONG_TOKEN=<долгосрочный токен из Kommo>
KOMMO_LOST_STATUS_ID=<ID этапа Нереализовано>
OPENAI_API_KEY=<ключ OpenAI>
```

## Как узнать KOMMO_LOST_STATUS_ID

Открой в браузере (будучи залогиненным в Kommo):
```
https://tumarcarpets.kommo.com/api/v4/leads/pipelines
```
Найди в ответе свою воронку и этап "Нереализовано" — скопируй его `id`.

## Вебхук в Kommo

Настройки → Web Hooks → Добавить хук:
- URL: `https://tumar-ai-automation.vercel.app/api/webhook`
- Событие: ✅ Статус сделки изменён
