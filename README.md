# WeCom ↔ BPMSoft OCC Bridge

Node.js сервис-маршрутизатор для интеграции **WeCom (企业微信)** с **BPMSoft OCC** (on-premise).  
Ретранслирует сообщения из чата WeCom в BPMSoft OCC и обратно.

```
WeCom External Contact  ⇄  WeComRoute  ⇄  BPMSoft OCC Operator
```

## Архитектура

### Входящие (WeCom → BPMSoft)
1. Клиент пишет в WeCom → WeCom вызывает callback `POST /wecom`
2. Сервис расшифровывает сообщение (`@wecom/crypto`) и парсит XML
3. Сообщение пересылается в BPMSoft OCC через API коннектора

### Исходящие (BPMSoft → WeCom)
1. Оператор отвечает в BPMSoft → BPMSoft шлёт `POST /Home/InputJSON`
2. Сервис отправляет сообщение через WeCom API (`qyapi.weixin.qq.com`)
3. Клиент получает ответ в WeCom

---

## Переменные окружения

| Переменная | Обязательная | Описание | Где взять |
|---|---|---|---|
| `WECOM_CORP_ID` | ✅ | ID корпорации (企业ID) | [WeCom Admin](https://work.weixin.qq.com/wework_admin/frame#profile) → Моя организация → Информация об организации → ID корпорации |
| `WECOM_CORP_SECRET` | ✅ | Секрет приложения (Secret) | WeCom Admin → Управление приложениями → Ваше приложение → Secret (нажать "Просмотр") |
| `WECOM_TOKEN` | ✅ | Token для верификации callback URL | WeCom Admin → Управление приложениями → Ваше приложение → Получение сообщений (API接收消息) → Token (генерируется автоматически при настройке) |
| `WECOM_ENCODING_AES_KEY` | ✅ | Ключ шифрования AES (43 символа) | Там же, где Token → EncodingAESKey (генерируется автоматически при настройке) |
| `WECOM_AGENT_ID` | ✅ | ID агента/приложения (AgentId) | WeCom Admin → Управление приложениями → Ваше приложение → AgentId (числовой, отображается вверху страницы) |
| `BPMSOFT_OCC_CONNECTOR_URL` | ✅ | URL коннектора BPMSoft OCC | Адрес вашего BPMSoft OCC Connector, например `https://connector.yourdomain.com` |
| `BPMSOFT_APP_ID` | ⚠️ | AppId канала в BPMSoft | BPMSoft → Настройки → Чаты → Каналы → Пользовательский канал → AppId (из таблицы Channel в БД коннектора) |
| `BPMSOFT_CHANNEL_ID` | ⚠️ | GUID канала в BPMSoft | Приходит в тестовом hook при добавлении канала (JSON: `{"id": "channel_guid"}`) |
| `PORT` | ❌ | Порт сервиса (по умолчанию `8080`) | Для Amvera оставить `8080` |
| `LOG_LEVEL` | ❌ | Уровень логирования (по умолчанию `info`) | Варианты: `error`, `warn`, `info`, `debug` |

> ⚠️ = требуется для интеграции с BPMSoft; сервис запустится без них, но пересылка не будет работать.

---

## Быстрый старт

### 1. Создать приложение в WeCom

1. Войдите в [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. Перейдите в **Управление приложениями** → **Создание приложения**
3. Создайте самостоятельное приложение (自建应用)
4. Запишите **AgentId** и **Secret**
5. В настройках приложения → **Получение сообщений** (API接收消息):
   - URL: `https://your-amvera-app.amvera.io/wecom`
   - Token и EncodingAESKey — сгенерируйте и сохраните

### 2. Настроить BPMSoft OCC

1. В BPMSoft добавьте **Пользовательский канал**
2. Укажите адрес: `https://your-amvera-app.amvera.io/Home/InputJSON`
3. Запишите `AppId` и `ChannelId`

### 3. Локальный запуск

```bash
# Клонировать репозиторий
git clone https://github.com/SergeSKM/WeComRoute.git
cd WeComRoute

# Установить зависимости
npm install

# Заполнить .env
cp .env .env.local
# Отредактировать .env переменными из таблицы выше

# Запуск
npm start

# Разработка (auto-reload)
npm run dev
```

### 4. Деплой на Amvera

1. Подключите Git-репозиторий к проекту Amvera
2. В **Настройки → Переменные окружения** добавьте все переменные из таблицы
3. Amvera автоматически соберёт и запустит контейнер из `Dockerfile`

---

## API Endpoints

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/wecom` | Верификация callback URL от WeCom |
| `POST` | `/wecom` | Приём зашифрованных сообщений от WeCom |
| `POST` | `/Home/InputJSON` | Приём сообщений от BPMSoft OCC |
| `GET` | `/health` | Health check (для мониторинга и Amvera) |

---

## Поддерживаемые типы сообщений

### WeCom → BPMSoft
- ✅ Текст
- ✅ Изображения (PicUrl)
- ✅ Голосовые сообщения (как текст-заглушка)
- ✅ Видео (как текст-заглушка)
- ✅ Геолокация
- ✅ Ссылки

### BPMSoft → WeCom
- ✅ Текст
- ✅ Кнопки (как нумерованный текст)
- ✅ Изображения (загрузка в WeCom Media → отправка по media_id)
- ✅ Файлы (загрузка в WeCom Media → отправка по media_id)
- ✅ Геолокация (как текст)
