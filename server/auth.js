const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const discordGateway = require('./discordGateway');
const redisCache = require('./redisCache');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'uma_chave_bem_segura';

/** TTL para servir /users/@me e guilds sem bater no Discord (ms) */
const PROFILE_CACHE_TTL_MS = Number(process.env.DISCORD_PROFILE_CACHE_MS) || 10 * 60 * 1000;
const GUILDS_CACHE_TTL_MS = Number(process.env.DISCORD_GUILDS_CACHE_MS) || 10 * 60 * 1000;

let db = null;
let useDatabase = false;
try {
    if (process.env.DATABASE_URL || process.env.DB_HOST) {
        db = require('./database');
        useDatabase = true;
    }
} catch (error) {
    console.warn('Banco de dados nao disponivel para sessoes, usando Map em memoria');
}

const sessionStore = new Map();

function getCookieOptions() {
    const isProduction = process.env.NODE_ENV === 'production';

    let sameOrigin = true;
    try {
        sameOrigin = new URL(BASE_URL).origin === new URL(FRONTEND_URL).origin;
    } catch {
        sameOrigin = true;
    }

    const sameSite = sameOrigin ? 'lax' : 'none';
    const secure = sameOrigin ? isProduction : true;

    return {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000
    };
}

function normalizeProfile(p) {
    if (p == null) return null;
    if (typeof p === 'string') {
        try {
            return JSON.parse(p);
        } catch {
            return null;
        }
    }
    return p;
}

function normalizeGuilds(g) {
    if (g == null) return null;
    if (typeof g === 'string') {
        try {
            return JSON.parse(g);
        } catch {
            return null;
        }
    }
    return g;
}

async function getSession(userId) {
    if (useDatabase && db && db.getSession) {
        return db.getSession(userId);
    }
    return sessionStore.get(userId) || null;
}

async function persistAfterOAuth(userId, access_token, refresh_token, expiresAt, profile, guilds) {
    const now = Date.now();
    if (useDatabase && db && db.upsertOAuthSession) {
        await db.upsertOAuthSession(userId, access_token, refresh_token, expiresAt, profile, guilds);
    }
    const prev = sessionStore.get(userId) || {};
    sessionStore.set(userId, {
        ...prev,
        access_token,
        refresh_token,
        expires_at: expiresAt,
        profile_json: profile,
        profile_cached_at: now,
        guilds_json: guilds,
        guilds_cached_at: now
    });

    const pTtl = Math.max(60, Math.floor(PROFILE_CACHE_TTL_MS / 1000));
    const gTtl = Math.max(60, Math.floor(GUILDS_CACHE_TTL_MS / 1000));
    await redisCache.cacheSet(`holly:discord:profile:${userId}`, JSON.stringify(profile), pTtl);
    await redisCache.cacheSet(`holly:discord:guilds:${userId}`, JSON.stringify(guilds), gTtl);
}

async function persistTokenRefresh(userId, access_token, refresh_token, expiresAt) {
    if (useDatabase && db && db.updateSessionTokens) {
        await db.updateSessionTokens(userId, access_token, refresh_token, expiresAt);
    }
    const prev = sessionStore.get(userId) || {};
    sessionStore.set(userId, {
        ...prev,
        access_token,
        refresh_token,
        expires_at: expiresAt
    });
}

function authenticateToken(req, res, next) {
    const token = req.cookies.holly_token;
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        return next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            res.clearCookie('holly_token');
            return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        }
        return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
}

function login(req, res) {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds'
    });

    return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
}

/**
 * OAuth callback: 1x troca de code, 1x @me, 1x guilds — sem retry (code só vale uma vez).
 */
async function callback(req, res) {
    try {
        const { code } = req.query;
        if (!code) {
            return res.redirect(`${FRONTEND_URL}/dashboard?error=no_code`);
        }

        const tokenResponse = await discordGateway.enqueueDiscordTask(() =>
            axios.post(
                'https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            )
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const expiresAt = Date.now() + expires_in * 1000;

        const userRes = await discordGateway.enqueueDiscordTask(() =>
            axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${access_token}` },
                timeout: 10000
            })
        );

        const guildsRes = await discordGateway.enqueueDiscordTask(() =>
            axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${access_token}` },
                timeout: 15000
            })
        );

        const userId = userRes.data.id;
        await persistAfterOAuth(userId, access_token, refresh_token, expiresAt, userRes.data, guildsRes.data);

        const jwtToken = jwt.sign({ user_id: userId, username: userRes.data.username }, JWT_SECRET, {
            expiresIn: '30d'
        });

        res.cookie('holly_token', jwtToken, getCookieOptions());

        return res.redirect(`${FRONTEND_URL}/dashboard`);
    } catch (err) {
        const discordErr = err.response?.data;
        const status = err.response?.status;
        const retryAfterHeader = err.response?.headers?.['retry-after'];
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
        const reason =
            discordErr?.error_description ||
            discordErr?.error ||
            (status === 429
                ? `rate_limited_429${Number.isFinite(retryAfterSeconds) ? `_retry_after_${retryAfterSeconds}s` : ''}`
                : err.message) ||
            'unknown';

        console.error('Erro no callback:', discordErr || err.message);
        return res.redirect(
            `${FRONTEND_URL}/dashboard?error=auth_failed&reason=${encodeURIComponent(String(reason).slice(0, 200))}`
        );
    }
}

async function refreshAccessToken(userId, session) {
    try {
        const tokenResponse = await discordGateway.enqueueDiscordTask(() =>
            axios.post(
                'https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: session.refresh_token
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            )
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const expiresAt = Date.now() + expires_in * 1000;

        await persistTokenRefresh(userId, access_token, refresh_token, expiresAt);

        console.log(`Token do Discord renovado para usuario ${userId}`);
        return access_token;
    } catch (err) {
        console.error('Erro ao renovar token do Discord:', err.response?.data || err.message);

        if (useDatabase && db && db.deleteSession) {
            await db.deleteSession(userId);
        }
        sessionStore.delete(userId);
        await redisCache.cacheDel(`holly:discord:profile:${userId}`);
        await redisCache.cacheDel(`holly:discord:guilds:${userId}`);

        return null;
    }
}

async function getValidAccessToken(userId) {
    const session = await getSession(userId);

    if (!session) return null;

    if (Date.now() >= session.expires_at) {
        return refreshAccessToken(userId, session);
    }

    return session.access_token;
}

async function logout(req, res) {
    const uid = req.user?.user_id;
    if (uid) {
        if (useDatabase && db && db.deleteSession) {
            await db.deleteSession(uid);
        }
        sessionStore.delete(uid);
        await redisCache.cacheDel(`holly:discord:profile:${uid}`);
        await redisCache.cacheDel(`holly:discord:guilds:${uid}`);
    }

    const { httpOnly, secure, sameSite, path } = getCookieOptions();
    res.clearCookie('holly_token', { httpOnly, secure, sameSite, path });

    return res.status(200).json({ message: 'Logout realizado com sucesso' });
}

const OWNER_ID = '909204567042981978';

function getUserBadges(userId) {
    const badges = [];
    if (userId === OWNER_ID) {
        badges.push({
            id: 'owner',
            name: 'Owner',
            imageUrl: '/images/badges/partnered-server-owner.png',
            fallbackIcon: '\uD83D\uDC51',
            description: 'Owner'
        });
    }
    return badges;
}

async function loadProfileFromDiscord(userId, accessToken) {
    const userRes = await discordGateway.enqueueDiscordTask(() =>
        axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000
        })
    );
    const profile = userRes.data;
    const now = Date.now();

    if (useDatabase && db && db.mergeSessionProfile) {
        await db.mergeSessionProfile(userId, profile);
    } else {
        const prev = sessionStore.get(userId) || {};
        sessionStore.set(userId, { ...prev, profile_json: profile, profile_cached_at: now });
    }

    const ttl = Math.max(60, Math.floor(PROFILE_CACHE_TTL_MS / 1000));
    await redisCache.cacheSet(`holly:discord:profile:${userId}`, JSON.stringify(profile), ttl);

    return profile;
}

async function resolveUserProfile(userId) {
    const now = Date.now();
    const redisKey = `holly:discord:profile:${userId}`;
    const redisHit = await redisCache.cacheGet(redisKey);
    if (redisHit) {
        try {
            return JSON.parse(redisHit);
        } catch {
            /* fallthrough */
        }
    }

    const session = await getSession(userId);
    const cached = normalizeProfile(session?.profile_json);
    const cachedAt = session?.profile_cached_at;

    if (cached && cachedAt && now - cachedAt < PROFILE_CACHE_TTL_MS) {
        return cached;
    }

    const pausedUntil = discordGateway.getPauseUntil();
    if (now < pausedUntil && cached) {
        return cached;
    }

    const token = await getValidAccessToken(userId);
    if (!token) {
        const err = new Error('Sessão expirada. Faça login novamente.');
        err.code = 401;
        throw err;
    }

    try {
        return await loadProfileFromDiscord(userId, token);
    } catch (err) {
        if (err.response?.status === 429 && cached) {
            return cached;
        }
        throw err;
    }
}

async function loadGuildsFromDiscord(userId, accessToken) {
    const guildsRes = await discordGateway.enqueueDiscordTask(() =>
        axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000
        })
    );
    const guilds = guildsRes.data;
    const now = Date.now();

    if (useDatabase && db && db.mergeSessionGuilds) {
        await db.mergeSessionGuilds(userId, guilds);
    } else {
        const prev = sessionStore.get(userId) || {};
        sessionStore.set(userId, { ...prev, guilds_json: guilds, guilds_cached_at: now });
    }

    const ttl = Math.max(60, Math.floor(GUILDS_CACHE_TTL_MS / 1000));
    await redisCache.cacheSet(`holly:discord:guilds:${userId}`, JSON.stringify(guilds), ttl);

    return guilds;
}

async function resolveUserGuilds(userId) {
    const now = Date.now();
    const redisKey = `holly:discord:guilds:${userId}`;
    const redisHit = await redisCache.cacheGet(redisKey);
    if (redisHit) {
        try {
            return JSON.parse(redisHit);
        } catch {
            /* fallthrough */
        }
    }

    const session = await getSession(userId);
    const cached = normalizeGuilds(session?.guilds_json);
    const cachedAt = session?.guilds_cached_at;

    if (cached && cachedAt && now - cachedAt < GUILDS_CACHE_TTL_MS) {
        return cached;
    }

    const pausedUntil = discordGateway.getPauseUntil();
    if (now < pausedUntil && cached) {
        return cached;
    }

    const token = await getValidAccessToken(userId);
    if (!token) {
        const err = new Error('Sessão expirada');
        err.code = 401;
        throw err;
    }

    try {
        return await loadGuildsFromDiscord(userId, token);
    } catch (err) {
        if (err.response?.status === 429 && cached) {
            return cached;
        }
        throw err;
    }
}

async function getUserData(req, res) {
    try {
        const userId = req.user.user_id;
        const profile = await resolveUserProfile(userId);
        const badges = getUserBadges(profile.id);
        return res.json({
            ...profile,
            plan: 'free',
            badges
        });
    } catch (err) {
        if (err.code === 401) {
            return res.status(401).json({ error: err.message });
        }
        if (err.response && err.response.status === 401) {
            if (req.user?.user_id) {
                if (useDatabase && db && db.deleteSession) {
                    await db.deleteSession(req.user.user_id);
                } else {
                    sessionStore.delete(req.user.user_id);
                }
            }
            return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        }
        if (err.response?.status === 429) {
            const sec = discordGateway.parseRetryAfterSeconds(err.response);
            res.set('Retry-After', String(sec));
            return res.status(503).json({ error: 'Discord rate limit', retry_after: sec });
        }
        console.error('Erro ao buscar usuário:', err.message);
        return res.status(500).json({ error: 'Erro ao buscar usuário' });
    }
}

async function getUserGuilds(req, res) {
    try {
        const userId = req.user.user_id;
        const guilds = await resolveUserGuilds(userId);
        return res.json(guilds);
    } catch (err) {
        if (err.code === 401) {
            return res.status(401).json({ error: err.message });
        }
        if (err.response?.status === 429) {
            const sec = discordGateway.parseRetryAfterSeconds(err.response);
            res.set('Retry-After', String(sec));
            return res.status(503).json({ error: 'Discord rate limit', retry_after: sec });
        }
        console.error('Erro ao buscar servidores:', err.message);
        return res.status(500).json({ error: 'Erro ao buscar servidores' });
    }
}

/**
 * Uma ida ao backend: user + guilds em sequência (fila Discord já serializa).
 */
async function getBootstrapBundle(req) {
    const userId = req.user.user_id;
    try {
        const user = await resolveUserProfile(userId);
        const guilds = await resolveUserGuilds(userId);
        return {
            user: { ...user, plan: 'free', badges: getUserBadges(user.id) },
            guilds
        };
    } catch (err) {
        if (err.response && err.response.status === 401) {
            if (useDatabase && db && db.deleteSession) {
                await db.deleteSession(userId);
            }
            sessionStore.delete(userId);
            await redisCache.cacheDel(`holly:discord:profile:${userId}`);
            await redisCache.cacheDel(`holly:discord:guilds:${userId}`);
            const e = new Error('Sessão expirada. Faça login novamente.');
            e.code = 401;
            throw e;
        }
        throw err;
    }
}

async function isUserAdministrator(userId) {
    if (userId === OWNER_ID) {
        return true;
    }
    try {
        const dataStore = require('./dataStore');
        if (dataStore.isAdministrator) {
            return await dataStore.isAdministrator(userId);
        }
    } catch (error) {
        console.error('Erro ao verificar administrador:', error);
    }
    return false;
}

module.exports = {
    authenticateToken,
    login,
    callback,
    logout,
    getUserData,
    getUserGuilds,
    getValidAccessToken,
    refreshAccessToken,
    getUserBadges,
    isUserAdministrator,
    getBootstrapBundle
};
