const axios = require('axios');
const logger = require('./logger');

const WECHAT_API_BASE = 'https://api.weixin.qq.com/cgi-bin';

class WeChatClient {
  constructor({ appId, appSecret }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Получить access_token (кешируется, обновляется автоматически)
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const res = await axios.get(`${WECHAT_API_BASE}/token`, {
        params: {
          grant_type: 'client_credential',
          appid: this.appId,
          secret: this.appSecret,
        },
      });

      if (res.data.errcode) {
        throw new Error(`WeChat token error: ${res.data.errcode} - ${res.data.errmsg}`);
      }

      this.accessToken = res.data.access_token;
      // Обновляем за 5 минут до истечения
      this.tokenExpiresAt = Date.now() + (res.data.expires_in - 300) * 1000;

      logger.info('WeChat access token refreshed', {
        expiresIn: res.data.expires_in,
      });

      return this.accessToken;
    } catch (err) {
      logger.error('Failed to get WeChat access token', { error: err.message });
      throw err;
    }
  }

  /**
   * Отправить текстовое сообщение пользователю WeChat
   * @param {string} openId — OpenID получателя
   * @param {string} text — текст сообщения
   */
  async sendTextMessage(openId, text) {
    const token = await this.getAccessToken();

    try {
      const res = await axios.post(
        `${WECHAT_API_BASE}/message/custom/send?access_token=${token}`,
        {
          touser: openId,
          msgtype: 'text',
          text: { content: text },
        }
      );

      if (res.data.errcode && res.data.errcode !== 0) {
        throw new Error(`WeChat send error: ${res.data.errcode} - ${res.data.errmsg}`);
      }

      logger.info('Message sent to WeChat', { openId, textLength: text.length });
      return res.data;
    } catch (err) {
      logger.error('Failed to send WeChat message', {
        openId,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Отправить изображение пользователю WeChat
   * @param {string} openId — OpenID получателя
   * @param {string} mediaId — media_id загруженного изображения
   */
  async sendImageMessage(openId, mediaId) {
    const token = await this.getAccessToken();

    try {
      const res = await axios.post(
        `${WECHAT_API_BASE}/message/custom/send?access_token=${token}`,
        {
          touser: openId,
          msgtype: 'image',
          image: { media_id: mediaId },
        }
      );

      if (res.data.errcode && res.data.errcode !== 0) {
        throw new Error(`WeChat send image error: ${res.data.errcode} - ${res.data.errmsg}`);
      }

      logger.info('Image sent to WeChat', { openId, mediaId });
      return res.data;
    } catch (err) {
      logger.error('Failed to send WeChat image', { openId, error: err.message });
      throw err;
    }
  }
}

module.exports = WeChatClient;
