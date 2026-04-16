const axios = require('axios');
const logger = require('./logger');

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

class WeComClient {
  constructor({ corpId, corpSecret, agentId }) {
    this.corpId = corpId;
    this.corpSecret = corpSecret;
    this.agentId = agentId;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Get or refresh WeCom access_token.
   * Token is valid for 7200s (2 hours), we refresh 5 minutes before expiry.
   */
  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }

    try {
      const res = await axios.get(`${WECOM_API_BASE}/gettoken`, {
        params: { corpid: this.corpId, corpsecret: this.corpSecret },
      });

      if (res.data.errcode !== 0) {
        throw new Error(`WeCom token error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      this.accessToken = res.data.access_token;
      this.tokenExpiresAt = now + res.data.expires_in * 1000;
      logger.info('WeCom access_token refreshed', { expiresIn: res.data.expires_in });
      return this.accessToken;
    } catch (err) {
      logger.error('Failed to get WeCom access_token', { error: err.message });
      throw err;
    }
  }

  /**
   * Send a text message to a WeCom user (external contact or internal).
   */
  async sendText(toUser, content) {
    const token = await this.getAccessToken();
    const payload = {
      touser: toUser,
      msgtype: 'text',
      agentid: this.agentId,
      text: { content },
    };

    try {
      const res = await axios.post(`${WECOM_API_BASE}/message/send?access_token=${token}`, payload);

      if (res.data.errcode !== 0) {
        logger.error('WeCom sendText failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`WeCom send error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      logger.info('Message sent to WeCom user', { toUser, msgtype: 'text' });
      return res.data;
    } catch (err) {
      logger.error('Failed to send text message', { toUser, error: err.message });
      throw err;
    }
  }

  /**
   * Upload a temporary media file (image) to WeCom and return media_id.
   * Media URL is downloaded first, then uploaded as multipart form.
   */
  async uploadMedia(mediaUrl, type = 'image') {
    const token = await this.getAccessToken();
    const FormData = require('form-data');

    try {
      // Download the media file
      const downloadRes = await axios.get(mediaUrl, { responseType: 'stream' });
      const contentType = downloadRes.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';

      // Upload to WeCom
      const form = new FormData();
      form.append('media', downloadRes.data, {
        filename: `upload.${ext}`,
        contentType,
      });

      const res = await axios.post(
        `${WECOM_API_BASE}/media/upload?access_token=${token}&type=${type}`,
        form,
        { headers: form.getHeaders() }
      );

      if (res.data.errcode && res.data.errcode !== 0) {
        throw new Error(`WeCom upload error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      logger.info('Media uploaded to WeCom', { type, mediaId: res.data.media_id });
      return res.data.media_id;
    } catch (err) {
      logger.error('Failed to upload media', { mediaUrl, error: err.message });
      throw err;
    }
  }

  /**
   * Send an image message to a WeCom user.
   */
  async sendImage(toUser, mediaId) {
    const token = await this.getAccessToken();
    const payload = {
      touser: toUser,
      msgtype: 'image',
      agentid: this.agentId,
      image: { media_id: mediaId },
    };

    try {
      const res = await axios.post(`${WECOM_API_BASE}/message/send?access_token=${token}`, payload);

      if (res.data.errcode !== 0) {
        logger.error('WeCom sendImage failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`WeCom send error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      logger.info('Image sent to WeCom user', { toUser, mediaId });
      return res.data;
    } catch (err) {
      logger.error('Failed to send image message', { toUser, error: err.message });
      throw err;
    }
  }

  /**
   * Send a file message to a WeCom user.
   */
  async sendFile(toUser, mediaId) {
    const token = await this.getAccessToken();
    const payload = {
      touser: toUser,
      msgtype: 'file',
      agentid: this.agentId,
      file: { media_id: mediaId },
    };

    try {
      const res = await axios.post(`${WECOM_API_BASE}/message/send?access_token=${token}`, payload);

      if (res.data.errcode !== 0) {
        logger.error('WeCom sendFile failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`WeCom send error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      logger.info('File sent to WeCom user', { toUser, mediaId });
      return res.data;
    } catch (err) {
      logger.error('Failed to send file message', { toUser, error: err.message });
      throw err;
    }
  }
}

module.exports = WeComClient;
