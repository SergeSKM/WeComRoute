const express = require('express');
const xml2js = require('xml2js');
const { getSignature, decrypt } = require('@wecom/crypto');
const logger = require('./logger');

/**
 * Create WeCom callback routes.
 *
 * @param {object} opts
 * @param {string} opts.token          - WeCom callback Token
 * @param {string} opts.encodingAESKey - WeCom EncodingAESKey (43-char base64)
 * @param {string} opts.corpId         - WeCom Corp ID
 * @param {object} opts.bpmsoftClient  - BPMSoft OCC client instance
 */
function createWeComRouter({ token, encodingAESKey, corpId, bpmsoftClient }) {
  const router = express.Router();

  // ── Helpers ──────────────────────────────────────────────

  /**
   * Verify WeCom callback signature.
   */
  function verifySignature(msgSignature, timestamp, nonce, encrypted) {
    const calculated = getSignature(token, timestamp, nonce, encrypted);
    return calculated === msgSignature;
  }

  /**
   * Decrypt WeCom encrypted message and return parsed XML object.
   */
  async function decryptMessage(encryptedText) {
    const { message, id } = decrypt(encodingAESKey, encryptedText);
    logger.debug('Decrypted message', { corpId: id });
    const parsed = await xml2js.parseStringPromise(message, { explicitArray: false });
    return parsed.xml || parsed;
  }

  // ── GET /wecom — Callback URL verification ──────────────

  router.get('/', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    logger.info('WeCom callback verification request', { timestamp, nonce });

    if (!msg_signature || !timestamp || !nonce || !echostr) {
      logger.warn('Missing verification parameters');
      return res.status(400).send('Missing parameters');
    }

    // Verify signature
    if (!verifySignature(msg_signature, timestamp, nonce, echostr)) {
      logger.warn('Callback verification signature mismatch');
      return res.status(403).send('Invalid signature');
    }

    // Decrypt echostr and return plaintext
    try {
      const { message } = decrypt(encodingAESKey, echostr);
      logger.info('Callback URL verified successfully');
      res.status(200).send(message);
    } catch (err) {
      logger.error('Failed to decrypt echostr', { error: err.message });
      res.status(500).send('Decryption failed');
    }
  });

  // ── POST /wecom — Receive messages from WeCom ──────────

  router.post('/', express.text({ type: ['text/xml', 'application/xml'] }), async (req, res) => {
    const { msg_signature, timestamp, nonce } = req.query;

    try {
      // 1. Parse outer XML to get <Encrypt> field
      const outerXml = await xml2js.parseStringPromise(req.body, { explicitArray: false });
      const encrypted = outerXml.xml?.Encrypt;

      if (!encrypted) {
        logger.warn('No <Encrypt> field in callback body');
        return res.status(400).send('Missing Encrypt field');
      }

      // 2. Verify signature
      if (!verifySignature(msg_signature, timestamp, nonce, encrypted)) {
        logger.warn('Message signature mismatch');
        return res.status(403).send('Invalid signature');
      }

      // 3. Decrypt message
      const msg = await decryptMessage(encrypted);

      const msgType = msg.MsgType;
      const fromUser = msg.FromUserName;   // WeCom UserId or ExternalUserId
      const content = msg.Content || '';

      logger.info('Received WeCom message', {
        from: fromUser,
        msgType,
        msgId: msg.MsgId,
      });

      // 4. Route message to BPMSoft OCC
      if (!bpmsoftClient) {
        logger.warn('BPMSoft client not configured, message not forwarded');
        return res.status(200).send('success');
      }

      switch (msgType) {
        case 'text':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'text',
            text: content,
          });
          break;

        case 'image':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'image',
            text: msg.PicUrl || '[Image message]',
          });
          break;

        case 'voice':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'text',
            text: '[Voice message]',
          });
          break;

        case 'video':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'text',
            text: '[Video message]',
          });
          break;

        case 'location':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'text',
            text: `[Location] ${msg.Label || ''} (${msg.Location_X}, ${msg.Location_Y})`,
          });
          break;

        case 'link':
          await bpmsoftClient.sendMessage(fromUser, {
            type: 'text',
            text: `[Link] ${msg.Title || ''}\n${msg.Url || ''}`,
          });
          break;

        case 'event':
          logger.info('WeCom event received', {
            event: msg.Event,
            eventKey: msg.EventKey,
          });
          // Events (subscribe, enter_agent, etc.) are logged but not forwarded
          break;

        default:
          logger.info('Unhandled WeCom message type', { msgType });
          break;
      }

      // WeCom expects "success" or empty response within 5 seconds
      res.status(200).send('success');
    } catch (err) {
      logger.error('Error processing WeCom message', { error: err.message, stack: err.stack });
      // Always respond to prevent WeCom retries
      res.status(200).send('success');
    }
  });

  return router;
}

module.exports = createWeComRouter;
