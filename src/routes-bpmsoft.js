const { Router } = require('express');
const logger = require('./logger');

function createBPMSoftRouter({ wecomClient }) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const payload = req.body;
      logger.info('BPMSoft OCC message received', { payload });

      // Тестовый hook при добавлении канала
      if (payload.id && !payload.type && !payload.receiver_id) {
        logger.info('BPMSoft OCC test hook received (channel registration)', { channelId: payload.id });
        return res.status(200).json({ ok: true });
      }

      const { channel_id, receiver_id, type, content, operatorInfo, openKfId } = payload;
      if (!receiver_id) {
        logger.warn('Missing receiver_id in BPMSoft payload');
        return res.status(200).json({ ok: true });
      }

      const userId = receiver_id; // может быть UserId сотрудника или external_userid клиента

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (text) {
            // Определяем, кому отправляем: если userId начинается с wm/wo — это клиент, используем KF API
            const isExternal = userId.startsWith('wm') || userId.startsWith('wo');
            if (isExternal && openKfId) {
              await wecomClient.sendKfText(userId, openKfId, text);
            } else {
              // Внутренний сотрудник
              await wecomClient.sendText(userId, text);
            }
          }
          break;
        }

        case 'buttons': {
          let text = content?.text || '';
          if (content?.buttons && content.buttons.length > 0) {
            text += '\n\n' + content.buttons.map((btn, i) => `${i + 1}. ${btn}`).join('\n');
          }
          if (text) {
            const isExternal = userId.startsWith('wm') || userId.startsWith('wo');
            if (isExternal && openKfId) {
              await wecomClient.sendKfText(userId, openKfId, text);
            } else {
              await wecomClient.sendText(userId, text);
            }
          }
          break;
        }

        case 'image': {
          const imageUrl = content?.text;
          if (imageUrl) {
            try {
              const mediaId = await wecomClient.uploadMedia(imageUrl, 'image');
              // Для изображений тоже нужно определить тип получателя
              const isExternal = userId.startsWith('wm') || userId.startsWith('wo');
              if (isExternal && openKfId) {
                // Для KF отправка изображений аналогична тексту, только другой msgtype
                // В wecom-client.js нужно добавить метод sendKfImage, но для простоты можно отправить ссылку
                await wecomClient.sendKfText(userId, openKfId, `[Image]: ${imageUrl}`);
              } else {
                await wecomClient.sendImage(userId, mediaId);
              }
            } catch (err) {
              logger.warn('Image upload failed, sending as text link', { error: err.message });
              const isExternal = userId.startsWith('wm') || userId.startsWith('wo');
              if (isExternal && openKfId) {
                await wecomClient.sendKfText(userId, openKfId, `[Image]: ${imageUrl}`);
              } else {
                await wecomClient.sendText(userId, `[Image]: ${imageUrl}`);
              }
            }
          }
          break;
        }

        // Аналогично для file, location и т.д. (можно добавить по аналогии)

        default:
          logger.warn('Unknown message type from BPMSoft', { type, payload });
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Error processing BPMSoft message', { error: err.message, stack: err.stack });
      return res.status(200).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createBPMSoftRouter;