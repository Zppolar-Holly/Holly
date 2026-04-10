const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'uma_chave_bem_segura';

function getCookieOptions() {
    const isProduction = process.env.NODE_ENV === 'production';

    let sameOrigin = true;
    try {
        sameOrigin = new URL(BASE_URL).origin === new URL(FRONTEND_URL).origin;
    } catch {
        sameOrigin = true;
    }

    // Cross-site cookies (frontend != API) require SameSite=None + Secure.
    const sameSite = sameOrigin ? 'lax' : 'none';
    const secure = sameOrigin ? isProduction : true;

    return {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
    };
}

// Try to use database for sessions, fallback to Map
let db = null;
let useDatabase = false;
try {
    if (process.env.DATABASE_URL || process.env.DB_HOST) {
        db = require('./database');
        useDatabase = true;
    }
} catch (error) {
    console.warn('⚠️  Banco de dados não disponível para sessões, usando Map em memória');
}

// Fallback to Map if database not available
const sessionStore = new Map();

function authenticateToken(req, res, next) {
    const token = req.cookies.holly_token;
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        return next();
    } catch (err) {
        // If token expired, try to refresh if refresh token exists
        if (err.name === 'TokenExpiredError') {
            // Clear expired token
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

async function callback(req, res) {
    try {
        const { code } = req.query;
        if (!code) {
            return res.redirect(`${FRONTEND_URL}/dashboard?error=no_code`);
        }

        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const userId = userRes.data.id;
        const expiresAt = Date.now() + expires_in * 1000;
        
        // Save session to database if available, otherwise use Map
        if (useDatabase && db && db.setSession) {
            await db.setSession(userId, access_token, refresh_token, expiresAt);
        } else {
            sessionStore.set(userId, {
                access_token,
                refresh_token,
                expires_at: expiresAt
            });
        }

        const jwtToken = jwt.sign({ user_id: userId, username: userRes.data.username }, JWT_SECRET, { expiresIn: '30d' });

        res.cookie('holly_token', jwtToken, getCookieOptions());

        return res.redirect(`${FRONTEND_URL}/dashboard`);
    } catch (err) {
        const discordErr = err.response?.data;
        const reason =
            discordErr?.error_description ||
            discordErr?.error ||
            err.message ||
            'unknown';

        // Não inclui tokens/segredos; só a razão (ex: invalid_grant, redirect_uri mismatch).
        console.error('Erro no callback:', discordErr || err.message);
        return res.redirect(
            `${FRONTEND_URL}/dashboard?error=auth_failed&reason=${encodeURIComponent(String(reason).slice(0, 200))}`
        );
    }
}

async function refreshAccessToken(userId, session) {
    try {
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: session.refresh_token
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const expiresAt = Date.now() + expires_in * 1000;

        // Save updated session to database if available
        if (useDatabase && db && db.setSession) {
            await db.setSession(userId, access_token, refresh_token, expiresAt);
        } else {
            sessionStore.set(userId, {
                access_token,
                refresh_token,
                expires_at: expiresAt
            });
        }

        console.log(`🔄 Token do Discord renovado para usuário ${userId}`);
        return access_token;
    } catch (err) {
        console.error('Erro ao renovar token do Discord:', err.response?.data || err.message);
        
        // Delete session from database or Map
        if (useDatabase && db && db.deleteSession) {
            await db.deleteSession(userId);
        } else {
            sessionStore.delete(userId);
        }
        
        return null;
    }
}

async function getValidAccessToken(userId) {
    let session = null;
    
    // Try to get session from database first, then fallback to Map
    if (useDatabase && db && db.getSession) {
        session = await db.getSession(userId);
    } else {
        session = sessionStore.get(userId);
    }
    
    if (!session) return null;

    if (Date.now() >= session.expires_at) {
        return refreshAccessToken(userId, session);
    }

    return session.access_token;
}

async function logout(req, res) {
    if (req.user?.user_id) {
        // Delete session from database or Map
        if (useDatabase && db && db.deleteSession) {
            await db.deleteSession(req.user.user_id);
        } else {
            sessionStore.delete(req.user.user_id);
        }
    }

    // Use the same cookie attributes to guarantee deletion in all browsers.
    const { httpOnly, secure, sameSite, path } = getCookieOptions();
    res.clearCookie('holly_token', { httpOnly, secure, sameSite, path });

    return res.status(200).json({ message: 'Logout realizado com sucesso' });
}

// Badge system
const OWNER_ID = '909204567042981978';

function getUserBadges(userId) {
    const badges = [];
    
    // Owner badge - usando imagem do Discord (Partnered Server Owner)
    if (userId === OWNER_ID) {
        badges.push({
            id: 'owner',
            name: 'Owner',
            // URL da badge do Discord - pode precisar ser ajustada
            // Alternativas: usar imagem local ou URL do Discord CDN
            imageUrl: '/images/badges/partnered-server-owner.png',
            fallbackIcon: '👑',
            description: 'Owner'
        });
    }
    
    // Premium badge (placeholder - não implementado ainda)
    // badges.push({
    //     id: 'premium',
    //     name: 'Premium',
    //     imageUrl: 'https://cdn.discordapp.com/badge-icons/premium.png',
    //     description: 'Membro Premium'
    // });
    
    return badges;
}

async function getUserData(req, res) {
    try {
        const token = await getValidAccessToken(req.user.user_id);
        if (!token) {
            // Token expired or session lost (server restart)
            console.warn(`⚠️ Sessão não encontrada para usuário ${req.user.user_id} - servidor pode ter reiniciado`);
            return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        }

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000
        });

        const userId = userRes.data.id;
        const badges = getUserBadges(userId);

        return res.json({ 
            ...userRes.data, 
            plan: 'free',
            badges: badges
        });
    } catch (err) {
        // If it's a 401 from Discord, the token is invalid
        if (err.response && err.response.status === 401) {
            console.warn(`⚠️ Token do Discord inválido para usuário ${req.user.user_id}`);
            // Clear the session
            if (req.user?.user_id) {
                if (useDatabase && db && db.deleteSession) {
                    await db.deleteSession(req.user.user_id);
                } else {
                    sessionStore.delete(req.user.user_id);
                }
            }
            return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        }
        console.error('Erro ao buscar usuário:', err.message);
        return res.status(500).json({ error: 'Erro ao buscar usuário' });
    }
}

async function getUserGuilds(req, res) {
    try {
        const token = await getValidAccessToken(req.user.user_id);
        if (!token) {
            return res.status(401).json({ error: 'Sessão expirada' });
        }

        const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });

        return res.json(guildsRes.data);
    } catch (err) {
        console.error('Erro ao buscar servidores:', err.message);
        return res.status(500).json({ error: 'Erro ao buscar servidores' });
    }
}

// Check if user is administrator
async function isUserAdministrator(userId) {
    const OWNER_ID = '909204567042981978';
    
    // Owner is always admin
    if (userId === OWNER_ID) {
        return true;
    }
    
    // Check database
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
    isUserAdministrator
};

