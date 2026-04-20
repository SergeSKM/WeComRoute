const { Router } = require('express');
const logger = require('./logger');

function createBPMSoftRouter({ wecomClient }) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const payload = req.body;
      logger.info('BPMSoft OCC message received', { payload });

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

      // 🔑 Ключевое условие: если ID начинается на "wm" или "wo" — это клиент
      const isExternal = userId.startsWith('wm') || userId.startsWith('wo');

      switch (type) {
        case 'text': {
          const text = content?.text;
          if (text) {
            if (isExternal && openKfId) {
              // ✅ Используем правильный метод для клиента
              await wecomClient.sendKfText(userId, openKfId, text);
            } else {
              // ✅ Используем старый метод для сотрудника
              await wecomClient.sendText(userId, text);
            }
          }
          break;
        }
        // ... другие типы сообщений (обрабатываются по тому же принципу)
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