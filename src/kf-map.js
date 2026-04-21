const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Хранилище: external_userid -> open_kfid
const MAP_FILE = path.join('/tmp', 'kf_external_map.json');
let externalToKf = new Map();

function loadMap() {
    try {
        if (fs.existsSync(MAP_FILE)) {
            const data = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
            externalToKf = new Map(Object.entries(data));
            logger.info('Loaded external->kf map', { count: externalToKf.size });
        }
    } catch (err) {
        logger.error('Failed to load map', { error: err.message });
    }
}

function saveMap() {
    try {
        const obj = Object.fromEntries(externalToKf);
        fs.writeFileSync(MAP_FILE, JSON.stringify(obj));
    } catch (err) {
        logger.error('Failed to save map', { error: err.message });
    }
}

function setKfId(externalUserId, openKfId) {
    if (!externalUserId || !openKfId) return;
    externalToKf.set(externalUserId, openKfId);
    saveMap();
    logger.debug('Saved KF mapping', { externalUserId, openKfId });
}

function getKfId(externalUserId) {
    return externalToKf.get(externalUserId);
}

// Загружаем при старте
loadMap();

module.exports = { setKfId, getKfId };