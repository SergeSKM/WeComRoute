# WeChat ↔ BPMSoft OCC Bridge

Middleware-сервис для интеграции WeChat Official Account с BPMSoft OCC через Custom Channel.

## Архитектура

```
┌──────────────┐     XML/HTTP      ┌─────────────────────┐      JSON/HTTP      ┌──────────────────┐
│              │  ───────────────►  │                     │  ─────────────────►  │                  │
│  WeChat User │   POST /wechat    │   WeChat-BPMSoft    │   Custom Channel    │  BPMSoft OCC     │
│  (клиент)    │                   │      Bridge         │   Connector API     │  (оператор CRM)  │
│              │  ◄───────────────  │   (этот сервис)     │  ◄─────────────────  │                  │
└──────────────┘   Customer Svc    └─────────────────────┘  POST /bpmsoft/out  └──────────────────┘
                     API                   │
                                           │  GET /health
                                           │  POST /bpmsoft/send (тест)
```

### Потоки сообщений

**Входящие (WeChat → BPMSoft):**
1. Клиент пишет в WeChat Official Account
2. WeChat отправляет XML на `POST /wechat`
3. Bridge парсит XML, извлекает OpenID + текст
4. Bridge отправляет JSON в BPMSoft OCC Connector API (`/services/custom/{channelId}/incoming`)
5. Оператор видит сообщение в интерфейсе BPMSoft CRM

**Исходящие (BPMSoft → WeChat):**
1. Оператор отвечает в BPMSoft CRM
2. BPMSoft OCC Connector отправляет POST на `POST /bpmsoft/outgoing`
3. Bridge получает JSON с `clientId` (OpenID) и текстом
4. Bridge отправляет сообщение через WeChat Customer Service API
5. Клиент получает ответ в WeChat

## Быстрый старт

### 1. WeChat Sandbox

1. Перейди на https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login
2. Авторизуйся через QR-код в WeChat
3. Запиши `appID` и `appsecret`
4. Придумай Token (любая строка)
5. URL и Token заполнишь после деплоя (или с ngrok для локальной разработки)

### 2. Локальная разработка

```bash
# Клонируй репо
cp .env.example .env
# Заполни .env значениями из sandbox

npm install
npm run dev

# В другом терминале — пробрось через ngrok:
ngrok http 8080

# Скопируй https URL из ngrok в настройки sandbox:
# URL: https://xxxxx.ngrok.io/wechat
# Token: значение из .env
```

### 3. Деплой на Amvera

```bash
# Установи Amvera CLI (если ещё нет)
pip install amvera

# Создай проект
amvera project create wechat-bpmsoft-bridge

# Задай переменные окружения в панели Amvera:
# WECHAT_APP_ID, WECHAT_APP_SECRET, WECHAT_TOKEN,
# BPMSOFT_OCC_CONNECTOR_URL, BPMSOFT_CHANNEL_ID

# Деплой через git push
git init
git remote add amvera https://git.amvera.ru/<username>/wechat-bpmsoft-bridge.git
git add .
git commit -m "initial"
git push amvera master
```

После деплоя Amvera даст URL вида `https://wechat-bpmsoft-bridge-<user>.amvera.io`.

Укажи `https://wechat-bpmsoft-bridge-<user>.amvera.io/wechat` как URL в настройках WeChat Sandbox.

### 4. Настройка BPMSoft OCC

1. Открой Дизайнер системы → Настройка чатов BPMSoft OCC
2. В детали «Каналы» нажми «+»
3. Выбери «Пользовательский канал (Custom Channel)»
4. Укажи Webhook URL для исходящих: `https://wechat-bpmsoft-bridge-<user>.amvera.io/bpmsoft/outgoing`
5. Запиши Channel ID и укажи его в переменной `BPMSOFT_CHANNEL_ID`
6. Привяжи оператора к каналу
7. Синхронизируй

## API Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/wechat` | Верификация webhook (WeChat challenge) |
| POST | `/wechat` | Приём входящих сообщений от WeChat (XML) |
| POST | `/bpmsoft/outgoing` | Приём исходящих сообщений от BPMSoft OCC |
| POST | `/bpmsoft/send` | Ручная отправка сообщения в WeChat (для тестов) |
| GET | `/health` | Health check |

### Тестовая отправка

```bash
curl -X POST https://your-app.amvera.io/bpmsoft/send \
  -H "Content-Type: application/json" \
  -d '{"openId": "oXXXX_user_open_id", "text": "Привет из BPMSoft!"}'
```

## Переменные окружения

| Переменная | Обязательная | Описание |
|------------|:---:|----------|
| `WECHAT_APP_ID` | ✅ | AppID из WeChat Sandbox / Official Account |
| `WECHAT_APP_SECRET` | ✅ | AppSecret из WeChat |
| `WECHAT_TOKEN` | ✅ | Token для верификации webhook |
| `BPMSOFT_OCC_CONNECTOR_URL` | | URL коннектора OCC (по умолчанию: https://connector.ai.bpmsoft.ru) |
| `BPMSOFT_CHANNEL_ID` | | ID пользовательского канала в BPMSoft OCC |
| `BPMSOFT_OCC_OUTGOING_WEBHOOK_SECRET` | | Секрет для проверки запросов от BPMSoft |
| `PORT` | | Порт сервера (по умолчанию: 8080) |
| `LOG_LEVEL` | | Уровень логирования (по умолчанию: info) |

## Важные замечания

- **WeChat Sandbox** не поддерживает шифрование сообщений — это нормально для тестирования
- **Customer Service API** (отправка сообщений) работает только в течение 48 часов после последнего сообщения от пользователя
- Для продакшена потребуется верифицированный Service Account с китайским юрлицом
- URL коннектора BPMSoft OCC и формат Custom Channel API могут отличаться в зависимости от версии — уточняй в документации или у техподдержки BPMSoft
