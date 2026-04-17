const express = require('express');
const xml2js = require('xml2js');
const axios = require('axios');       // добавлен для sync_msg
const { getSignature, decrypt } = require('@wecom/crypto');
const logger = require('./logger');

function createWeComRouter({ token, encodingAESKey, corpId, bpmsoftClient, wecomClient }) {
  const router = express.Router();

  function verifySignature(msgSignature, timestamp, nonce, encrypted) {
    const calculated = getSignature(token, timestamp, nonce, encrypted);
    return calculated === msgSignature;
  }

  async function decryptMessage(encryptedText) {
    const { message, id } = decrypt(encodingAESKey, encryptedText);
    logger.debug('Decrypted message', { corpId: id });
    const parsed = await xml2js.parseStringPromise(message, { explicitArray: false });
    return parsed.xml || parsed;
  }

  // GET /wecom — верификация URL
  router.get('/', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    logger.info('WeCom callback verification request', { timestamp, nonce });

    if (!msg_signature || !timestamp || !nonce || !echostr) {
      logger.warn('Missing verification parameters');
      return res.status(400).send('Missing parameters');
    }

    if (!verifySignature(msg_signature, timestamp, nonce, echostr)) {
      logger.warn('Callback verification signature mismatch');
      return res.status(403).send('Invalid signature');
    }

    try {
      const { message } = decrypt(encodingAESKey, echostr);
      logger.info('Callback URL verified successfully');
      res.status(200).send(message);
    } catch (err) {
      logger.error('Failed to decrypt echostr', { error: err.message });
      res.status(500).send('Decryption failed');
    }
  });

  // POST /wecom — приём сообщений и событий
  router.post('/', express.text({ type: ['text/xml', 'application/xml'] }), async (req, res) => {
    const { msg_signature, timestamp, nonce } = req.query;

    try {
      const outerXml = await xml2js.parseStringPromise(req.body, { explicitArray: false });
      const encrypted = outerXml.xml?.Encrypt;

      if (!encrypted) {
        logger.warn('No <Encrypt> field in callback body');
        return res.status(400).send('Missing Encrypt field');
      }

      if (!verifySignature(msg_signature, timestamp, nonce, encrypted)) {
        logger.warn('Message signature mismatch');
        return res.status(403).send('Invalid signature');
      }

      const decryptedXml = await decryptMessage(encrypted);
      const msg = decryptedXml;

      // ──────────────────────────────────────────────────────────
      // ОБРАБОТКА СОБЫТИЙ ОТ КЛИЕНТОВ (WeChat Customer Service)
      // ──────────────────────────────────────────────────────────
      if (msg.MsgType === 'event' && msg.Event === 'kf_msg_or_event') {
        const openKfId = msg.OpenKfId;
        const syncToken = msg.Token;
        logger.info('KF event received, fetching messages via sync_msg', { openKfId, syncToken });

        // Получаем access_token из клиента WeCom (уже есть метод)
       // const wecomClient = req.app.locals.wecomClient; // предположим, что мы передадим клиент в app.locals
        // Если не передали, можно получить из глобальной переменной, но лучше передать.
        // В текущей реализации bpmsoftClient есть, но нет wecomClient. Добавим в параметры роутера.
        // Для простоты предположим, что мы передали wecomClient в createWeComRouter.
        // Ниже я покажу, как передать wecomClient из index.js.
        // Пока что используем переменную, которую мы передадим.
        const accessToken = await wecomClient.getAccessToken();

        const syncUrl = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${accessToken}`;
        const syncPayload = {
          token: syncToken,
          open_kfid: openKfId,
          limit: 100
        };

        const syncResponse = await axios.post(syncUrl, syncPayload, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (syncResponse.data.errcode && syncResponse.data.errcode !== 0) {
          logger.error('sync_msg failed', { errcode: syncResponse.data.errcode, errmsg: syncResponse.data.errmsg });
          return res.status(200).send('success'); // всё равно отвечаем success, чтобы WeCom не повторял
        }

        const msgList = syncResponse.data.msg_list || [];
        for (const customerMsg of msgList) {
          if (customerMsg.msgtype === 'text' && customerMsg.from) {
            const externalUserId = customerMsg.from; // ID клиента (wm/wo)
            const messageText = customerMsg.text?.content || '';
            logger.info('Forwarding customer message to BPMSoft', { externalUserId, messageText });

            if (bpmsoftClient) {
              // Передаём также openKfId, чтобы потом можно было ответить
              await bpmsoftClient.sendMessage(externalUserId, {
                type: 'text',
                text: messageText,
                openKfId: openKfId
              });
            }
          }
          // Здесь можно добавить обработку image, voice и т.д.
        }

        return res.status(200).send('success');
      }

      // ──────────────────────────────────────────────────────────
      // ОБРАБОТКА СООБЩЕНИЙ ОТ СОТРУДНИКОВ (внутренние)
      // ──────────────────────────────────────────────────────────
      const msgType = msg.MsgType;
      const fromUser = msg.FromUserName;   // UserId сотрудника
      const content = msg.Content || '';

      logger.info('Received internal WeCom message', { from: fromUser, msgType, content });

      if (bpmsoftClient) {
        switch (msgType) {
          case 'text':
            await bpmsoftClient.sendMessage(fromUser, { type: 'text', text: content });
            break;
          case 'image':
            await bpmsoftClient.sendMessage(fromUser, { type: 'image', text: msg.PicUrl || '[Image]' });
            break;
          // ... другие типы
          default:
            logger.info('Unhandled internal message type', { msgType });
        }
      }

      res.status(200).send('success');
    } catch (err) {
      logger.error('Error processing WeCom message', { error: err.message, stack: err.stack });
      res.status(200).send('success');
    }
  });

  return router;
}

module.exports = createWeComRouter;