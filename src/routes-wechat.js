const { Router } = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');
const logger = require('./logger');

/**
 * Роут для приёма сообщений от WeChat
 *
 * WeChat отправляет:
 *   GET  /wechat — верификация webhook (echostr challenge)
 *   POST /wechat — входящие сообщения в XML-формате
 *
 * Сообщения пересылаются в BPMSoft OCC через SendMessage API:
 *   POST {connectorUrl}/api/v1.0/sendmessage/{AppId}/{ChannelId}
 */
function createWeChatRouter({ wechatToken, bpmsoftClient }) {
  const router = Router();

  // ─── GET /wechat — верификация webhook сервера ──────────────────────
  router.get('/', (req, res) => {
    const { signature, timestamp, nonce, echostr } = req.query;

    // Формируем проверочную строку по алгоритму WeChat
    const arr = [wechatToken, timestamp, nonce].sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');

    if (hash === signature) {
      logger.info('WeChat webhook verified successfully');
      return res.send(echostr);
    }

    logger.warn('WeChat webhook verification failed', { signature, hash });
    return res.status(403).send('Verification failed');
  });

  // ─── POST /wechat — входящие сообщения ──────────────────────────────
  router.post('/', async (req, res) => {
    try {
      // WeChat присылает XML в raw body
      const xmlBody = req.body;

      if (!xmlBody || typeof xmlBody !== 'string') {
        logger.warn('Empty or non-string body received from WeChat');
        return res.send('success');
      }

      // Парсим XML → JS объект
      const parsed = await xml2js.parseStringPromise(xmlBody, {
        explicitArray: false,
      });
      const msg = parsed.xml;

      logger.info('WeChat message received', {
        msgType: msg.MsgType,
        from: msg.FromUserName,
        to: msg.ToUserName,
      });

      // Обрабатываем сообщения по типу
      if (msg.MsgType === 'text') {
        logger.info('WeChat text message to forward', {
          from: msg.FromUserName,
          text: msg.Content,
          textLength: msg.Content?.length,
        });
        // Текстовое сообщение → BPMSoft OCC SendMessage (type: text)
        await bpmsoftClient.sendMessage({
          senderId: msg.FromUserName,      // OpenID пользователя WeChat
          senderName: null,                // BPMSoft покажет ID; можно обогатить через User Info API
          type: 'text',
          text: msg.Content,
        });
      } else if (msg.MsgType === 'image') {
        // Изображение → BPMSoft OCC SendMessage (type: image)
        await bpmsoftClient.sendMessage({
          senderId: msg.FromUserName,
          senderName: null,
          type: 'image',
          attachment: { image: msg.PicUrl },
        });
      } else if (msg.MsgType === 'event') {
        // Подписка / отписка
        if (msg.Event === 'subscribe') {
          logger.info('User subscribed', { openId: msg.FromUserName });
          await bpmsoftClient.sendMessage({
            senderId: msg.FromUserName,
            senderName: null,
            type: 'text',
            text: '[User subscribed to WeChat Official Account]',
          });
        } else if (msg.Event === 'unsubscribe') {
          logger.info('User unsubscribed', { openId: msg.FromUserName });
        }
      } else {
        logger.info('Unsupported message type, skipping', {
          msgType: msg.MsgType,
        });
      }

      // WeChat требует ответ "success" или пустую строку в течение 5 секунд
      res.send('success');
    } catch (err) {
      logger.error('Error processing WeChat message', { error: err.message });
      res.send('success'); // Всё равно отвечаем, чтобы WeChat не ретраил
    }
  });

  return router;
}

module.exports = createWeChatRouter;
