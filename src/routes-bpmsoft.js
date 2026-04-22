const { Router } = require('express');
const logger = require('./logger');
const { getKfId } = require('./kf-map');

// ID сотрудника, который будет назначен для переоткрытия сессии
// Укажите реальный UserId менеджера (например, 'annapavlova')
const DEFAULT_SERVICER_USERID = 'annapavlova';

function createBPMSoftRouter({ wecomClient }) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const payload = req.body;
      logger.info('BPMSoft OCC message received', { payload });

      if (payload.id && !payload.type && !payload.receiver_id) {
        logger.info('BPMSoft OCC test hook received', { channelId: payload.id });
        return res.status(200).json({ ok: true });
      }

      let { receiver_id, type, content, openKfId } = payload;
      if (!receiver_id) {
        logger.warn('Missing receiver_id');
        return res.status(200).json({ ok: true });
      }

      const userId = receiver_id;
      const isExternal = userId.startsWith('wm') || userId.startsWith('wo');

      if (isExternal && !openKfId) {
        openKfId = getKfId(userId);
        if (openKfId) {
          logger.info('Restored openKfId from storage', { userId, openKfId });
        } else {
          logger.error('No openKfId for external user, cannot reply', { userId });
          return res.status(200).json({ ok: false, error: 'Missing openKfId' });
        }
      }

      // Исправленная функция sendWithReopen
      const sendWithReopen = async (userId, openKfId, text) => {
        try {
          // 1. Получаем текущее состояние сессии
          const { service_state, servicer_userid } = await wecomClient.getServiceState(openKfId, userId);
          logger.info('Current service state before send', { userId, service_state, servicer_userid });

          // 2. Если сессия не активна (service_state !== 3), пытаемся переоткрыть
          if (service_state !== 3) {
            logger.info('Session not active, attempting to reopen', { userId, service_state });
            const targetServicer = servicer_userid || DEFAULT_SERVICER_USERID;
            await wecomClient.changeServiceState(openKfId, userId, 3, targetServicer);
            logger.info('Session state changed to 3 (manual service)', { userId, targetServicer });
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // 3. Отправляем сообщение
          await wecomClient.sendKfText(userId, openKfId, text);
          logger.info('Message sent successfully after state check', { userId });
        } catch (err) {
          logger.error('Failed to send message after reopen attempt', { error: err.message, stack: err.stack });
          throw err;
        }
      };

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (!text) break;

          if (isExternal && openKfId) {
            await sendWithReopen(userId, openKfId, text);
          } else if (!isExternal) {
            await wecomClient.sendText(userId, text);
          } else {
            logger.error('Cannot send to external user: missing openKfId', { userId, openKfId });
          }
          break;
        }

        case 'image': {
          const imageUrl = content?.text;
          if (imageUrl && isExternal && openKfId) {
            await sendWithReopen(userId, openKfId, `[Image]: ${imageUrl}`);
          } else if (imageUrl && !isExternal) {
            try {
              const mediaId = await wecomClient.uploadMedia(imageUrl, 'image');
              await wecomClient.sendImage(userId, mediaId);
            } catch (err) {
              await wecomClient.sendText(userId, `[Image]: ${imageUrl}`);
            }
          }
          break;
        }

        default:
          logger.warn('Unknown message type', { type });
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