const express = require('express');
const xml2js = require('xml2js');
const axios = require('axios');
const { getSignature, decrypt } = require('@wecom/crypto');
const logger = require('./logger');

// Хранилище курсоров для каждого open_kfid (в реальном проекте используйте Redis или БД)
const kfCursors = new Map();

function createWeComRouter({ token, encodingAESKey, corpId, bpmsoftClient, wecomClient }) {
  const router = express.Router();

  function verifySignature(msgSignature, timestamp, nonce, encrypted) {
    const calculated = getSignature(token, timestamp, nonce, encrypted);
    return calculated === msgSignature;
  }

  async function decryptMessage(encryptedText) {
    const { message, id } = decrypt(encodingAESKey, encryptedText);
    logger.debug('Decrypted message', { corpId: id, messagePreview: message.substring(0, 200) });
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
    logger.debug('POST /wecom called', { msg_signature, timestamp, nonce, bodyLength: req.body?.length });

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
      logger.debug('Decrypted message structure', { msgType: msg.MsgType, event: msg.Event });

      // ──────────────────────────────────────────────────────────
      // ОБРАБОТКА СОБЫТИЙ ОТ КЛИЕНТОВ (WeChat Customer Service)
      // ──────────────────────────────────────────────────────────
      if (msg.MsgType === 'event' && msg.Event === 'kf_msg_or_event') {
        const openKfId = msg.OpenKfId;
        const syncToken = msg.Token;
        logger.info('KF event received', { openKfId, syncToken });

        try {
          const accessToken = await wecomClient.getAccessToken();
          const syncUrl = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${accessToken}`;

          // Получаем сохранённый курсор для этого open_kfid
          let cursor = kfCursors.get(openKfId) || '';
          let allMessages = [];
          let nextCursor = null;
          let hasMore = true;

          while (hasMore) {
            const syncPayload = {
              token: syncToken,
              open_kfid: openKfId,
              cursor: cursor,
              limit: 100
            };
            logger.debug('Calling sync_msg', { url: syncUrl, payload: syncPayload });

            const syncResponse = await axios.post(syncUrl, syncPayload, {
              headers: { 'Content-Type': 'application/json' }
            });

            if (syncResponse.data.errcode && syncResponse.data.errcode !== 0) {
              logger.error('sync_msg failed', { errcode: syncResponse.data.errcode, errmsg: syncResponse.data.errmsg });
              break;
            }

            const msgList = syncResponse.data.msg_list || [];
            allMessages.push(...msgList);

            nextCursor = syncResponse.data.next_cursor;
            if (nextCursor) {
              cursor = nextCursor;
              // Продолжаем забирать следующую страницу
            } else {
              hasMore = false;
            }
          }

          // Сохраняем последний курсор для следующего раза
          if (nextCursor) {
            kfCursors.set(openKfId, nextCursor);
            logger.info('Saved cursor for open_kfid', { openKfId, cursor: nextCursor });
          }

          logger.info(`sync_msg returned ${allMessages.length} total messages (after cursor)`);

          // Для избежания дубликатов в пределах одного вызова можно использовать Set по msgid,
          // но курсор уже гарантирует, что старые сообщения не повторяются (если правильно сохранять).
          // Однако на всякий случай отфильтруем по msgid за последние 5 минут (опционально).
          const processedMsgIds = new Set();

          for (const customerMsg of allMessages) {
            const msgId = customerMsg.msgid;
            if (processedMsgIds.has(msgId)) {
              logger.debug('Duplicate message skipped', { msgId });
              continue;
            }
            processedMsgIds.add(msgId);

            const msgType = customerMsg.msgtype || customerMsg.MsgType;
            const externalUserId = customerMsg.external_userid || customerMsg.from;

            if (!externalUserId) {
              logger.warn('No external user ID in message', { msg: customerMsg });
              continue;
            }

            if (msgType === 'text') {
              const messageText = customerMsg.text?.content || '';
              logger.info('Forwarding customer text to BPMSoft', { externalUserId, messageText, openKfId });

              if (bpmsoftClient) {
                await bpmsoftClient.sendMessage(externalUserId, {
                  type: 'text',
                  text: messageText,
                  openKfId: openKfId
                });
              } else {
                logger.error('bpmsoftClient is not available');
              }
            } else if (msgType === 'image') {
              const mediaId = customerMsg.image?.media_id;
              logger.info('Forwarding customer image to BPMSoft', { externalUserId, mediaId, openKfId });
              if (bpmsoftClient) {
                await bpmsoftClient.sendMessage(externalUserId, {
                  type: 'text',
                  text: `[Image message, media_id: ${mediaId}]`,
                  openKfId: openKfId
                });
              }
            } else if (msgType === 'event') {
              logger.info('Ignoring customer event', { event: customerMsg.event });
            } else {
              logger.info('Unhandled customer message type', { msgtype: msgType });
            }
          }
        } catch (err) {
          logger.error('Error processing KF event', { error: err.message, stack: err.stack });
        }
        return res.status(200).send('success');
      }

      // ──────────────────────────────────────────────────────────
      // ОБРАБОТКА СООБЩЕНИЙ ОТ СОТРУДНИКОВ (внутренние)
      // ──────────────────────────────────────────────────────────
      const msgType = msg.MsgType;
      const fromUser = msg.FromUserName;
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