const { Router } = require('express');
const logger = require('./logger');

/**
 * Роут для приёма сообщений от BPMSoft OCC (Пользовательский канал)
 *
 * Документация: "Канал Пользовательский канал v1.9"
 *
 * BPMSoft OCC отправляет POST на адрес, указанный при добавлении канала
 * (формат: адрес/Home/InputJSON).
 *
 * Формат входящего JSON:
 * {
 *   "channel_id": "guid",
 *   "receiver_id": "openId пользователя в WeChat",
 *   "type": "text|buttons|file|image|location|operator_info",
 *   "content": { "text": "...", "buttons": [] },
 *   "operatorInfo": { "OperatorPhotoLink": "...", "OperatorName": "..." }
 * }
 *
 * ВАЖНО: Для корректной работы необходимо возвращать 200 OK на КАЖДЫЙ запрос.
 */
function createBPMSoftRouter({ wechatClient }) {
  const router = Router();

  // ─── POST / — приём сообщений от BPMSoft OCC ─────────────────────────
  // Будет смонтирован на /Home/InputJSON в index.js
  router.post('/', async (req, res) => {
    try {
      const payload = req.body;

      logger.info('BPMSoft OCC message received', { payload });

      // ── Тестовый hook при добавлении канала ──────────────────────────
      // При добавлении канала BPMSoft отправляет { "id": "channel_guid" }
      if (payload.id && !payload.type && !payload.receiver_id) {
        logger.info('BPMSoft OCC test hook received (channel registration)', {
          channelId: payload.id,
        });
        return res.status(200).json({ ok: true });
      }

      // ── Основной обработчик сообщений ───────────────────────────────
      const { channel_id, receiver_id, type, content, operatorInfo } = payload;

      if (!receiver_id) {
        logger.warn('Missing receiver_id in BPMSoft payload', { payload });
        return res.status(200).json({ ok: true }); // Всё равно 200 OK!
      }

      // receiver_id — это OpenID пользователя WeChat
      const openId = receiver_id;

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (text) {
            await wechatClient.sendTextMessage(openId, text);
          }
          break;
        }

        case 'buttons': {
          // Кнопочное сообщение — WeChat Sandbox не поддерживает кнопки,
          // отправляем как текст с перечислением кнопок
          let text = content?.text || '';
          if (content?.buttons && content.buttons.length > 0) {
            text += '\n\n' + content.buttons.map((btn, i) => `${i + 1}. ${btn}`).join('\n');
          }
          if (text) {
            await wechatClient.sendTextMessage(openId, text);
          }
          break;
        }

        case 'image': {
          // content.text содержит ссылку на изображение
          const imageUrl = content?.text;
          if (imageUrl) {
            // WeChat Sandbox: отправляем как текст со ссылкой
            await wechatClient.sendTextMessage(openId, `[Image]: ${imageUrl}`);
          }
          break;
        }

        case 'file': {
          // content.text содержит ссылку на файл
          const fileUrl = content?.text;
          if (fileUrl) {
            await wechatClient.sendTextMessage(openId, `[File]: ${fileUrl}`);
          }
          break;
        }

        case 'location': {
          // content.text содержит объект location { lat, lng }
          // Отправляем как текст
          const loc = content?.text;
          if (loc) {
            const text = typeof loc === 'object'
              ? `[Location]: ${loc.lat}, ${loc.lng}`
              : `[Location]: ${loc}`;
            await wechatClient.sendTextMessage(openId, text);
          }
          break;
        }

        case 'operator_info': {
          // Информация об операторе — логируем, можно не отправлять в WeChat
          logger.info('Operator info received', {
            operatorInfo,
            openId,
          });
          break;
        }

        default:
          logger.warn('Unknown message type from BPMSoft', { type, payload });
      }

      // Документация: "необходимо возвращать 200 ОК на каждый запрос"
      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Error processing BPMSoft message', {
        error: err.message,
        stack: err.stack,
      });
      // Даже при ошибке возвращаем 200, чтобы BPMSoft не ретраил
      return res.status(200).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createBPMSoftRouter;
