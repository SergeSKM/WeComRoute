require('dotenv').config();

const express = require('express');
const logger = require('./logger');
const WeChatClient = require('./wechat-client');
const BPMSoftOCCClient = require('./bpmsoft-client');
const createWeChatRouter = require('./routes-wechat');
const createBPMSoftRouter = require('./routes-bpmsoft');

// ─── Валидация конфигурации ───────────────────────────────────────────
// WeChat — обязательные (без них вебхук не заработает)
const requiredVars = ['WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'WECHAT_TOKEN'];
for (const v of requiredVars) {
  if (!process.env[v]) {
    logger.error(`Missing required env variable: ${v}`);
    process.exit(1);
  }
}

// BPMSoft — предупреждение (можно настроить позже, сервис запустится)
const bpmsoftVars = ['BPMSOFT_APP_ID', 'BPMSOFT_CHANNEL_ID'];
for (const v of bpmsoftVars) {
  if (!process.env[v]) {
    logger.warn(`BPMSoft env variable not set: ${v} — BPMSoft integration will not work until configured`);
  }
}

// ─── Инициализация клиентов ───────────────────────────────────────────
const wechatClient = new WeChatClient({
  appId: process.env.WECHAT_APP_ID,
  appSecret: process.env.WECHAT_APP_SECRET,
});

const bpmsoftClient = new BPMSoftOCCClient({
  connectorUrl: process.env.BPMSOFT_OCC_CONNECTOR_URL || 'https://connector.ai.bpmsoft.ru',
  appId: process.env.BPMSOFT_APP_ID,
  channelId: process.env.BPMSOFT_CHANNEL_ID,
});

// ─── Express-приложение ───────────────────────────────────────────────
const app = express();

// WeChat отправляет XML — парсим как text, чтобы xml2js мог обработать
app.use('/wechat', express.text({ type: ['text/xml', 'application/xml'] }));

// Для BPMSoft и остальных — JSON
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'wechat-bpmsoft-bridge',
    timestamp: new Date().toISOString(),
    config: {
      wechatAppId: process.env.WECHAT_APP_ID ? '***configured***' : 'MISSING',
      bpmsoftConnector: process.env.BPMSOFT_OCC_CONNECTOR_URL || 'default',
      bpmsoftAppId: process.env.BPMSOFT_APP_ID ? '***configured***' : 'MISSING',
      bpmsoftChannelId: process.env.BPMSOFT_CHANNEL_ID ? '***configured***' : 'MISSING',
    },
  });
});

// ─── Роуты ────────────────────────────────────────────────────────────

// WeChat webhook: GET /wechat (verification), POST /wechat (messages)
app.use(
  '/wechat',
  createWeChatRouter({
    wechatToken: process.env.WECHAT_TOKEN,
    bpmsoftClient,
  })
);

// BPMSoft OCC Пользовательский канал:
// Документация требует адрес в формате: адрес/Home/InputJSON
// POST /Home/InputJSON — приём сообщений от операторов/ботов BPMSoft
app.use(
  '/Home/InputJSON',
  createBPMSoftRouter({
    wechatClient,
  })
);

// ─── 404 ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Запуск ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`WeChat-BPMSoft Bridge started on port ${PORT}`);
  logger.info('Endpoints:');
  logger.info(`  WeChat webhook:     GET|POST /wechat`);
  logger.info(`  BPMSoft incoming:   POST     /Home/InputJSON`);
  logger.info(`  Health check:       GET      /health`);
});
