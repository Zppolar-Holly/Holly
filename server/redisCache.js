/**
 * Cache opcional via Redis (REDIS_URL). Se não configurado, retorna null em get.
 */

let client = null;
let connectAttempted = false;

function getClient() {
    if (connectAttempted) return client;
    connectAttempted = true;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    try {
        const Redis = require('ioredis');
        client = new Redis(url, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false
        });
        client.on('error', err => {
            console.warn('[Redis]', err.message);
        });
        return client;
    } catch (e) {
        console.warn('REDIS_URL definido mas ioredis nao disponivel:', e.message);
        return null;
    }
}

async function cacheGet(key) {
    const r = getClient();
    if (!r) return null;
    try {
        if (r.status !== 'ready') await r.connect().catch(() => {});
        const v = await r.get(key);
        return v;
    } catch {
        return null;
    }
}

async function cacheSet(key, value, ttlSeconds) {
    const r = getClient();
    if (!r) return false;
    try {
        if (r.status !== 'ready') await r.connect().catch(() => {});
        if (ttlSeconds > 0) {
            await r.set(key, value, 'EX', ttlSeconds);
        } else {
            await r.set(key, value);
        }
        return true;
    } catch {
        return false;
    }
}

async function cacheDel(key) {
    const r = getClient();
    if (!r) return;
    try {
        await r.del(key);
    } catch {
        /* ignore */
    }
}

module.exports = {
    cacheGet,
    cacheSet,
    cacheDel
};
