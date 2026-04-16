const axios = require('axios');
const logger = require('./logger');

class BPMSoftOCCClient {
  /**
   * @param {object} opts
   * @param {string} opts.connectorUrl — адрес коннектора BPMSoft OCC (BPMSoftOCCOperatoHost)
   * @param {string} opts.appId        — AppId (секретный ключ из таблицы Channel коннектора)
   * @param {string} opts.channelId    — ChannelId (GUID, полученный в тестовом hook при добавлении канала)
   */
  constructor({ connectorUrl, appId, channelId }) {
    this.connectorUrl = connectorUrl.replace(/\/$/, '');
    this.appId = appId;
    this.channelId = channelId;
  }

  /**
   * Отправить сообщение от клиента WeChat в BPMSoft OCC
   *
   * Документация: POST {HOST}/api/v1.0/sendmessage/{AppId}/{ChannelId}
   *
   * @param {object} opts
   * @param {string} opts.senderId   — уникальный идентификатор клиента (WeChat OpenID)
   * @param {string} opts.senderName — имя клиента
   * @param {string} [opts.avatar]   — URL аватара клиента (опционально)
   * @param {string} opts.type       — тип сообщения: text, image, file, location
   * @param {string} [opts.text]     — текст сообщения (для type=text)
   * @param {object} [opts.attachment] — вложение (для type=image/file/location)
   */
  async sendMessage({ senderId, senderName, avatar, type = 'text', text, attachment }) {
    const url = `${this.connectorUrl}/api/v1.0/sendmessage/${this.appId}/${this.channelId}`;

    const payload = {
      sender: {
        id: senderId,
        name: senderName || `WeChat User ${senderId.substring(0, 8)}`,
      },
      message: {
        type,
      },
    };

    // Аватар (опционально)
    if (avatar) {
      payload.sender.avatar = avatar;
    }

    // Заполняем поля в зависимости от типа
    if (type === 'text') {
      payload.message.text = text;
    } else if (type === 'image' && attachment) {
      payload.message.attachment = { image: attachment.image };
    } else if (type === 'file' && attachment) {
      payload.message.attachment = {
        file: {
          name: attachment.name,
          url: attachment.url,
          size: attachment.size,
        },
      };
    } else if (type === 'location' && attachment) {
      payload.message.attachment = {
        location: { lat: attachment.lat, lng: attachment.lng },
      };
    }

    logger.info('Sending to BPMSoft OCC', {
      url,
      payload: JSON.stringify(payload),
    });

    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      logger.info('Message forwarded to BPMSoft OCC', {
        senderId,
        type,
        status: res.status,
        response: res.data,
      });

      return res.data;
    } catch (err) {
      logger.error('Failed to forward message to BPMSoft OCC', {
        senderId,
        type,
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
