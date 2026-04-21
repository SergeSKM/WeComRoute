const { Router } = require('express');
const logger = require('./logger');
const { getKfId } = require('./kf-map');

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

      let { receiver_id, type, content, openKfId } = payload;
      if (!receiver_id) {
        logger.warn('Missing receiver_id in BPMSoft payload');
        return res.status(200).json({ ok: true });
      }

      const userId = receiver_id;
      const isExternal = userId.startsWith('wm') || userId.startsWith('wo');

      // Если openKfId не передан, но пользователь внешний – пытаемся восстановить из хранилища
      if (isExternal && !openKfId) {
        openKfId = getKfId(userId);
        if (openKfId) {
          logger.info('Restored openKfId from storage', { userId, openKfId });
        } else {
          logger.error('No openKfId for external user, cannot reply', { userId });
          return res.status(200).json({ ok: false, error: 'Missing openKfId' });
        }
      }

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

        case 'file': {
          const fileUrl = content?.text;
          if (fileUrl) {
            try {
              const mediaId = await wecomClient.uploadMedia(fileUrl, 'file');
              if (isExternal && openKfId) {
                await wecomClient.sendKfText(userId, openKfId, `[File]: ${fileUrl}`);
              } else {
                await wecomClient.sendFile(userId, mediaId);
              }
            } catch (err) {
              logger.warn('File upload failed, sending as text link', { error: err.message });
              if (isExternal && openKfId) {
                await wecomClient.sendKfText(userId, openKfId, `[File]: ${fileUrl}`);
              } else {
                await wecomClient.sendText(userId, `[File]: ${fileUrl}`);
              }
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
            if (isExternal && openKfId) {
              await wecomClient.sendKfText(userId, openKfId, text);
            } else {
              await wecomClient.sendText(userId, text);
            }
          }
          break;
        }

        case 'operator_info':
          logger.info('Operator info received', { operatorInfo: content, userId });
          break;

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