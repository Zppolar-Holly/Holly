/**
 * Unico ponto de saida para chamadas HTTP a API do Discord.
 * - Fila serial (evita rajadas paralelas)
 * - Em 429: respeita Retry-After e pausa novas chamadas ate o fim da pausa
 * - Sem retry automatico na mesma tarefa (code OAuth so pode ser trocado uma vez)
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(response) {
    const raw = response?.headers?.['retry-after'];
    if (raw == null || raw === '') return 5;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.min(Math.max(Math.ceil(n), 1), 3600);
    return 5;
}

let pauseUntil = 0;
/** @type {Promise<unknown>} */
let chain = Promise.resolve();
let lastRequestAt = 0;

const KEY_PAUSE_UNTIL = 'holly:discord:pause_until';
const KEY_EMERGENCY_UNTIL = 'holly:discord:emergency_until';
const KEY_LAST_AT = 'holly:discord:last_at';

// Suavização / anti-burst
const MIN_INTERVAL_MS = Number(process.env.DISCORD_MIN_INTERVAL_MS) || 350; // ~3 req/s global
const POST_PAUSE_RAMP_MS = Number(process.env.DISCORD_POST_PAUSE_RAMP_MS) || 5000;

let redis = null;
try {
    redis = require('./redisCache');
} catch {
    redis = null;
}

function getPauseUntil() {
    return pauseUntil;
}

async function getSharedNumber(key) {
    if (!redis) return null;
    const v = await redis.cacheGet(key);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

async function setSharedNumber(key, n, ttlSeconds) {
    if (!redis) return false;
    return redis.cacheSet(key, String(n), ttlSeconds);
}

function computeSpacing(now, localPauseUntil) {
    // Base spacing
    let wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestAt));

    // Após uma pausa longa, libera gradualmente por alguns segundos
    if (localPauseUntil && now >= localPauseUntil) {
        const since = now - localPauseUntil;
        if (since < POST_PAUSE_RAMP_MS) {
            const extra = Math.ceil(((POST_PAUSE_RAMP_MS - since) / POST_PAUSE_RAMP_MS) * MIN_INTERVAL_MS);
            wait += extra;
        }
    }

    return wait;
}

/**
 * Enfileira uma função que retorna uma Promise (ex.: axios.get).
 * Não reexecuta em caso de erro;429 apenas atualiza pause global e propaga o erro.
 */
function enqueueDiscordTask(task, meta = {}) {
    const run = async () => {
        const now = Date.now();
        // Estado compartilhado entre instâncias (se Redis existir)
        const sharedPauseUntil = (await getSharedNumber(KEY_PAUSE_UNTIL)) || 0;
        const sharedEmergencyUntil = (await getSharedNumber(KEY_EMERGENCY_UNTIL)) || 0;
        const sharedLastAt = (await getSharedNumber(KEY_LAST_AT)) || 0;

        // Modo emergência: bloqueia NOVAS chamadas e deixa a rota responder com cache
        if (now < sharedEmergencyUntil) {
            const err = new Error('discord_emergency_mode');
            err.code = 'DISCORD_EMERGENCY';
            err.retry_after = Math.ceil((sharedEmergencyUntil - now) / 1000);
            throw err;
        }

        // Pause global: bloqueia novas chamadas imediatamente (antes de tocar no task)
        const effectivePauseUntil = Math.max(pauseUntil, sharedPauseUntil);
        pauseUntil = effectivePauseUntil;
        if (now < effectivePauseUntil) {
            const wait = effectivePauseUntil - now;
            const err = new Error('discord_rate_limited');
            err.code = 'DISCORD_PAUSED';
            err.retry_after = Math.ceil(wait / 1000);
            throw err;
        }

        // Anti-burst: aplica espaçamento global e também respeita "last_at" compartilhado
        const localWait = computeSpacing(now, effectivePauseUntil);
        const sharedWait = Math.max(0, MIN_INTERVAL_MS - (now - sharedLastAt));
        const wait = Math.max(localWait, sharedWait);
        if (wait > 0) await sleep(wait);

        try {
            const startedAt = Date.now();
            return await task();
        } catch (err) {
            if (err?.response?.status === 429) {
                const sec = parseRetryAfterSeconds(err.response);
                const until = Date.now() + sec * 1000;
                pauseUntil = Math.max(pauseUntil, until);
                // Compartilha pausa entre instâncias
                await setSharedNumber(KEY_PAUSE_UNTIL, pauseUntil, Math.min(sec + 5, 3600));

                // Modo emergência se o bloqueio for alto
                if (sec > 60) {
                    await setSharedNumber(KEY_EMERGENCY_UNTIL, pauseUntil, Math.min(sec + 5, 3600));
                }

                console.warn(`[Discord] 429 — pausa global de ${sec}s (sem retry automático nesta tarefa)`, meta);
            }
            throw err;
        } finally {
            lastRequestAt = Date.now();
            await setSharedNumber(KEY_LAST_AT, lastRequestAt, 120);

            // Log básico de volume (RPS aproximado por processo e por redis)
            if (redis && meta?.endpoint) {
                const key = `holly:discord:rps:${Math.floor(lastRequestAt / 1000)}`;
                await redis.cacheIncr(key, 3);
            }
        }
    };

    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
}

module.exports = {
    enqueueDiscordTask,
    getPauseUntil,
    parseRetryAfterSeconds
};
