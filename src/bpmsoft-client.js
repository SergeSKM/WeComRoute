const axios = require('axios');
const logger = require('./logger');

class BPMSoftOCCClient {
  /**
   * @param {object} opts
   * @param {string} opts.connectorUrl — адрес коннектора BPMSoft OCC (BPMSoftOCCOperatorHost)
   * @param {string} opts.appId        — AppId (секретный ключ из таблицы Channel коннектора)
   * @param {string} opts.channelId    — ChannelId (GUID, полученный в тестовом hook при добавлении канала)
   */
  constructor({ connectorUrl, appId, channelId }) {
    this.connectorUrl = connectorUrl.replace(/\/$/, '');
    this.appId = appId;
    this.channelId = channelId;
  }

  async sendMessage(senderId, message) {
    const url = `${this.connectorUrl}/api/v1.0/sendmessage/${this.appId}/${this.channelId}`;

    const payload = {
      sender: {
        id: senderId,
        name: `WeCom User ${senderId.substring(0, 8)}`,
      },
      message: {
        type: message.type || 'text',
        text: message.text,
        // Добавляем openKfId, если он передан (для ответа клиенту)
        openKfId: message.openKfId || null,
      },
    };

    logger.info('Sending to BPMSoft OCC', { url, senderId, type: message.type, hasOpenKfId: !!message.openKfId });

    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      logger.info('Message forwarded to BPMSoft OCC', { senderId, type: message.type, status: res.status });
      return res.data;
    } catch (err) {
      logger.error('Failed to forward message to BPMSoft OCC', {
        senderId,
        type: message.type,
        url,
        error: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      throw err;
    }
  }
}

module.exports = BPMSoftOCCClient;