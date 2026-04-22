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

  // Отправка сотруднику (внутренний чат)
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

  // Отправка внешнему клиенту через API客服
  async sendKfText(externalUserId, openKfId, content) {
    const token = await this.getAccessToken();
    const payload = {
      touser: externalUserId,
      open_kfid: openKfId,
      msgtype: 'text',
      text: { content },
    };

    try {
      const res = await axios.post(`${WECOM_API_BASE}/kf/send_msg?access_token=${token}`, payload);

      if (res.data.errcode !== 0) {
        logger.error('WeCom sendKfText failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`WeCom KF send error: ${res.data.errcode} ${res.data.errmsg}`);
      }

      logger.info('KF message sent to external user', { externalUserId, openKfId, content });
      return res.data;
    } catch (err) {
      logger.error('Failed to send KF text message', { externalUserId, openKfId, error: err.message });
      throw err;
    }
  }

  /**
   * Получить текущее состояние сессии с клиентом
   */
  async getServiceState(openKfId, externalUserId) {
    const token = await this.getAccessToken();
    const url = `${WECOM_API_BASE}/kf/service_state/get?access_token=${token}`;
    const payload = {
      open_kfid: openKfId,
      external_userid: externalUserId
    };
    try {
      const res = await axios.post(url, payload);
      if (res.data.errcode !== 0) {
        logger.error('getServiceState failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`Get service state error: ${res.data.errcode} ${res.data.errmsg}`);
      }
      logger.debug('Service state', { externalUserId, service_state: res.data.service_state });
      return {
        service_state: res.data.service_state,
        servicer_userid: res.data.servicer_userid
      };
    } catch (err) {
      logger.error('Failed to get service state', { error: err.message });
      throw err;
    }
  }

  /**
   * Изменить состояние сессии (например, переоткрыть закрытую)
   * @param {string} openKfId
   * @param {string} externalUserId
   * @param {number} targetState - целевое состояние (3 =人工接待)
   * @param {string} servicerUserid - ID сотрудника, который будет вести диалог (обязательно для state=3)
   */
  async changeServiceState(openKfId, externalUserId, targetState, servicerUserid) {
    const token = await this.getAccessToken();
    const url = `${WECOM_API_BASE}/kf/service_state/trans?access_token=${token}`;
    const payload = {
      open_kfid: openKfId,
      external_userid: externalUserId,
      service_state: targetState,
    };
    if (targetState === 3 && servicerUserid) {
      payload.servicer_userid = servicerUserid;
    }
    try {
      const res = await axios.post(url, payload);
      if (res.data.errcode !== 0) {
        logger.error('changeServiceState failed', { errcode: res.data.errcode, errmsg: res.data.errmsg });
        throw new Error(`Change service state error: ${res.data.errcode} ${res.data.errmsg}`);
      }
      logger.info('Service state changed', { externalUserId, targetState, servicerUserid, msg_code: res.data.msg_code });
      return res.data;
    } catch (err) {
      logger.error('Failed to change service state', { error: err.message });
      throw err;
    }
  }

  // Загрузка медиа (без изменений)
  async uploadMedia(mediaUrl, type = 'image') {
    const token = await this.getAccessToken();
    const FormData = require('form-data');

    try {
      const downloadRes = await axios.get(mediaUrl, { responseType: 'stream' });
      const contentType = downloadRes.headers['content-type'] || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';

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