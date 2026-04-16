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
 *   "receiver_id": "UserId пользователя в WeCom",
 *   "type": "text|buttons|file|image|location|operator_info",
 *   "content": { "text": "...", "buttons": [] },
 *   "operatorInfo": { "OperatorPhotoLink": "...", "OperatorName": "..." }
 * }
 *
 * ВАЖНО: Для корректной работы необходимо возвращать 200 OK на КАЖДЫЙ запрос.
 */
function createBPMSoftRouter({ wecomClient }) {
  const router = Router();

  // ─── POST / — приём сообщений от BPMSoft OCC ─────────────────────────
  router.post('/', async (req, res) => {
    try {
      const payload = req.body;

      logger.info('BPMSoft OCC message received', { payload });

      // ── Тестовый hook при добавлении канала ──────────────────────────
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
        return res.status(200).json({ ok: true });
      }

      // receiver_id — UserId пользователя WeCom
      const userId = receiver_id;

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (text) {
            await wecomClient.sendText(userId, text);
          }
          break;
        }

        case 'buttons': {
          // Кнопочное сообщение — отправляем как текст с перечислением кнопок
          let text = content?.text || '';
          if (content?.buttons && content.buttons.length > 0) {
            text += '\n\n' + content.buttons.map((btn, i) => `${i + 1}. ${btn}`).join('\n');
          }
          if (text) {
            await wecomClient.sendText(userId, text);
          }
          break;
        }

        case 'image': {
          // content.text содержит ссылку на изображение
          const imageUrl = content?.text;
          if (imageUrl) {
            try {
              const mediaId = await wecomClient.uploadMedia(imageUrl, 'image');
              await wecomClient.sendImage(userId, mediaId);
            } catch (err) {
              logger.warn('Image upload failed, sending as text link', { error: err.message });
              await wecomClient.sendText(userId, `[Image]: ${imageUrl}`);
            }
          }
          break;
        }

        case 'file': {
          // content.text содержит ссылку на файл
          const fileUrl = content?.text;
          if (fileUrl) {
            try {
              const mediaId = await wecomClient.uploadMedia(fileUrl, 'file');
              await wecomClient.sendFile(userId, mediaId);
            } catch (err) {
              logger.warn('File upload failed, sending as text link', { error: err.message });
              await wecomClient.sendText(userId, `[File]: ${fileUrl}`);
            }
          }
          break;
        }

        case 'location': {
          const loc = content?.text;
          if (loc) {
            const text = typeof loc === 'object'
              ? `[Location]: ${loc.lat}, ${loc.lng}`
              : `[Location]: ${loc}`;
            await wecomClient.sendText(userId, text);
          }
          break;
        }

        case 'operator_info': {
          logger.info('Operator info received', { operatorInfo, userId });
          break;
        }

        default:
          logger.warn('Unknown message type from BPMSoft', { type, payload });
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Error processing BPMSoft message', {
        error: err.message,
        stack: err.stack,
      });
      return res.status(200).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createBPMSoftRouter;
