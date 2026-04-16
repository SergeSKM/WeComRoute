require('dotenv').config();

const express = require('express');
const logger = require('./logger');
const WeComClient = require('./wecom-client');
const BPMSoftOCCClient = require('./bpmsoft-client');
const createWeComRouter = require('./routes-wecom');
const createBPMSoftRouter = require('./routes-bpmsoft');

// ─── Валидация конфигурации ───────────────────────────────────────────
// WeCom — обязательные (без них callback не заработает)
const requiredVars = ['WECOM_CORP_ID', 'WECOM_CORP_SECRET', 'WECOM_TOKEN', 'WECOM_ENCODING_AES_KEY', 'WECOM_AGENT_ID'];
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
const wecomClient = new WeComClient({
  corpId: process.env.WECOM_CORP_ID,
  corpSecret: process.env.WECOM_CORP_SECRET,
  agentId: parseInt(process.env.WECOM_AGENT_ID, 10),
});

const bpmsoftClient = new BPMSoftOCCClient({
  connectorUrl: process.env.BPMSOFT_OCC_CONNECTOR_URL || 'https://connector.ai.bpmsoft.ru',
  appId: process.env.BPMSOFT_APP_ID,
  channelId: process.env.BPMSOFT_CHANNEL_ID,
});

// ─── Express-приложение ───────────────────────────────────────────────
const app = express();

// Для BPMSoft и остальных — JSON
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'wecom-bpmsoft-bridge',
    timestamp: new Date().toISOString(),
    config: {
      wecomCorpId: process.env.WECOM_CORP_ID ? '***configured***' : 'MISSING',
      wecomAgentId: process.env.WECOM_AGENT_ID ? '***configured***' : 'MISSING',
      bpmsoftConnector: process.env.BPMSOFT_OCC_CONNECTOR_URL || 'default',
      bpmsoftAppId: process.env.BPMSOFT_APP_ID ? '***configured***' : 'MISSING',
      bpmsoftChannelId: process.env.BPMSOFT_CHANNEL_ID ? '***configured***' : 'MISSING',
    },
  });
});

// ─── Роуты ────────────────────────────────────────────────────────────

// WeCom callback: GET /wecom (verification), POST /wecom (messages)
app.use(
  '/wecom',
  createWeComRouter({
    token: process.env.WECOM_TOKEN,
    encodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
    corpId: process.env.WECOM_CORP_ID,
    bpmsoftClient,
  })
);

// BPMSoft OCC Пользовательский канал:
// POST /Home/InputJSON — приём сообщений от операторов/ботов BPMSoft
app.use(
  '/Home/InputJSON',
  createBPMSoftRouter({
    wecomClient,
  })
);

// ─── 404 ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Запуск ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`WeCom-BPMSoft Bridge started on port ${PORT}`);
  logger.info('Endpoints:');
  logger.info(`  WeCom callback:     GET|POST /wecom`);
  logger.info(`  BPMSoft incoming:   POST     /Home/InputJSON`);
  logger.info(`  Health check:       GET      /health`);
});
