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

      const { receiver_id, type, content, openKfId } = payload;
      if (!receiver_id) {
        logger.warn('Missing receiver_id in BPMSoft payload');
        return res.status(200).json({ ok: true });
      }

      const userId = receiver_id;
      const isExternal = userId.startsWith('wm') || userId.startsWith('wo');

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (text) {
            if (isExternal && openKfId) {
              await wecomClient.sendKfText(userId, openKfId, text);
            } else {
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
              if (isExternal && openKfId) {
                // Для KF отправка изображений – можно использовать sendKfText с ссылкой или реализовать sendKfImage
                await wecomClient.sendKfText(userId, openKfId, `[Image]: ${imageUrl}`);
              } else {
                await wecomClient.sendImage(userId, mediaId);
              }
            } catch (err) {
              logger.warn('Image upload failed, sending as text link', { error: err.message });
              if (isExternal && openKfId) {
                await wecomClient.sendKfText(userId, openKfId, `[Image]: ${imageUrl}`);
              } else {
                await wecomClient.sendText(userId, `[Image]: ${imageUrl}`);
              }
            }
          }
          break;
        }

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