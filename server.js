const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
require('dotenv').config();

const discordAuth = require('./server/auth');
const dataStore = require('./server/dataStore');

// Owner ID (same as in auth.js)
const OWNER_ID = '909204567042981978';

// Check if using database
let useDatabase = false;
let db = null;
try {
    if (process.env.DATABASE_URL || process.env.DB_HOST) {
        db = require('./server/database');
        useDatabase = true;
    }
} catch (error) {
    console.warn('⚠️  Banco de dados não disponível, usando JSON');
}

// Check if user is administrator (owner or added admin)
async function checkAdministrator(req, res, next) {
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    // Owner is always admin
    if (userId === OWNER_ID) {
        req.isOwner = true;
        req.isAdmin = true;
        return next();
    }
    
    // Check if user is in administrators table
    let isAdmin = false;
    if (useDatabase && db && db.isAdministrator) {
        isAdmin = await db.isAdministrator(userId);
    } else if (dataStore.isAdministrator) {
        isAdmin = await dataStore.isAdministrator(userId);
    }
    
    if (!isAdmin) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar esta área.' });
    }
    
    req.isOwner = false;
    req.isAdmin = true;
    next();
}

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Servir arquivos estáticos ANTES de qualquer rota dinâmica
// Isso garante que CSS, JS, imagens sejam servidos corretamente
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d', // Cache por 1 dia
    etag: true,
    lastModified: true
}));
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    })
);

// Rotas de autenticação
app.get('/auth/discord', discordAuth.login);
app.get('/auth/discord/callback', discordAuth.callback);
app.post('/auth/logout', discordAuth.authenticateToken, discordAuth.logout);

// Shared bot instance (will be set when bot starts)
let botClient = null;

// Rotas API
app.get('/api/user', discordAuth.authenticateToken, discordAuth.getUserData);
app.get('/api/user/guilds', discordAuth.authenticateToken, discordAuth.getUserGuilds);

// Get global stats
app.get('/api/stats', discordAuth.authenticateToken, (req, res) => {
    // Try to get real stats from bot, fallback to mock data
    if (botClient && typeof botClient.getStats === 'function') {
        try {
            const stats = botClient.getStats();
            return res.json(stats);
        } catch (error) {
            console.error('Erro ao obter estatísticas do bot:', error);
        }
    }
    
    // Fallback to mock data if bot not available
    const now = new Date();
    const hourly = Array.from({ length: 24 }, (_, index) => {
        const base = 200 + ((index * 37) % 150);
        return base + Math.floor(Math.random() * 50);
    });

    res.json({
        uptime: 99.9,
        commands_24h: hourly.reduce((acc, value) => acc + value, 0),
        unique_users: 1245,
        command_categories: {
            moderation: 42,
            fun: 21,
            utility: 18,
            music: 14,
            other: 5
        },
        commands_by_hour: hourly,
        generated_at: now.toISOString()
    });
});

// Get server-specific stats
app.get('/api/server/:guildId/stats', discordAuth.authenticateToken, async (req, res) => {
    const { guildId } = req.params;
    try {
        const stats = await dataStore.getServerStats(guildId);
        res.json(stats);
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Check if bot is in server
app.get('/api/server/:guildId/bot-present', discordAuth.authenticateToken, async (req, res) => {
    const { guildId } = req.params;
    try {
        let present = false;
        
        // Method 1: Check via bot client cache (most reliable - real-time)
        if (botClient && botClient.guilds && botClient.guilds.cache) {
            const guild = botClient.guilds.cache.get(guildId);
            if (guild) {
                // Bot is definitely in the server - update dataStore to reflect this
                await dataStore.markBotPresent(guildId, true);
                return res.json({ present: true });
            }
        }
        
        // Method 2: Check dataStore botPresent flag (set by bot when joining/leaving)
        try {
            const config = await dataStore.getServerConfig(guildId);
            if (config) {
                // Check botPresent flag first (most reliable indicator)
                if (config.botPresent === true) {
                    // Check if lastSeen is recent (within last 5 minutes) to ensure it's current
                    if (config.lastSeen) {
                        const lastSeen = new Date(config.lastSeen);
                        const now = new Date();
                        const minutesSinceLastSeen = (now - lastSeen) / (1000 * 60);
                        
                        // If last seen more than 5 minutes ago, verify via bot client
                        if (minutesSinceLastSeen > 5 && botClient && botClient.guilds) {
                            // Double-check with bot client
                            const guild = botClient.guilds.cache.get(guildId);
                            present = !!guild;
                            // Update flag if different
                            if (present !== config.botPresent) {
                                await dataStore.markBotPresent(guildId, present);
                            }
                        } else {
                            present = true;
                        }
                    } else {
                        present = true; // No lastSeen timestamp, but marked as present
                    }
                } else {
                    present = false; // Explicitly marked as not present
                }
            }
        } catch (err) {
            // No config found - bot definitely not in server
            console.log(`Servidor ${guildId} não encontrado no dataStore:`, err.message);
            present = false;
        }
        
        res.json({ present });
    } catch (error) {
        console.error('Erro ao verificar presença do bot:', error);
        res.json({ present: false });
    }
});

// Get server configuration
app.get('/api/server/:guildId/config', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    try {
        const config = await dataStore.getServerConfig(guildId);
        // Convert Set to array for JSON response
        const response = {
            ...config,
            stats: {
                ...config.stats,
                uniqueUsers: config.stats.uniqueUsers.size || (config.stats.uniqueUsers instanceof Set ? config.stats.uniqueUsers.size : 0)
            }
        };
        res.json(response);
    } catch (error) {
        console.error('Erro ao buscar configuração:', error);
        res.status(500).json({ error: 'Erro ao buscar configuração' });
    }
});

// Get server permissions
app.get('/api/server/:guildId/permissions', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    try {
        let permissions = [];
        if (useDatabase && db && db.getServerPermissions) {
            permissions = await db.getServerPermissions(guildId);
        } else if (dataStore.getServerPermissions) {
            permissions = await dataStore.getServerPermissions(guildId);
        }
        res.json(permissions);
    } catch (error) {
        console.error('Erro ao buscar permissões:', error);
        res.status(500).json({ error: 'Erro ao buscar permissões' });
    }
});

// Add permission
app.post('/api/server/:guildId/permissions', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    const { userId } = req.body;
    const addedBy = req.user.user_id;
    
    if (!userId) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }
    
    // Only owners can add permissions
    if (!req.isOwner) {
        return res.status(403).json({ error: 'Apenas o dono do servidor pode adicionar permissões' });
    }
    
    try {
        let success = false;
        if (useDatabase && db && db.addPermission) {
            success = await db.addPermission(guildId, userId, addedBy);
        } else if (dataStore.addPermission) {
            success = await dataStore.addPermission(guildId, userId, addedBy);
        }
        
        if (success) {
            res.json({ success: true, message: 'Permissão adicionada com sucesso' });
        } else {
            res.status(500).json({ error: 'Erro ao adicionar permissão' });
        }
    } catch (error) {
        console.error('Erro ao adicionar permissão:', error);
        res.status(500).json({ error: 'Erro ao adicionar permissão' });
    }
});

// Remove permission
app.delete('/api/server/:guildId/permissions/:userId', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId, userId } = req.params;
    
    // Only owners can remove permissions
    if (!req.isOwner) {
        return res.status(403).json({ error: 'Apenas o dono do servidor pode remover permissões' });
    }
    
    try {
        let success = false;
        if (useDatabase && db && db.removePermission) {
            success = await db.removePermission(guildId, userId);
        } else if (dataStore.removePermission) {
            success = await dataStore.removePermission(guildId, userId);
        }
        
        if (success) {
            res.json({ success: true, message: 'Permissão removida com sucesso' });
        } else {
            res.status(500).json({ error: 'Erro ao remover permissão' });
        }
    } catch (error) {
        console.error('Erro ao remover permissão:', error);
        res.status(500).json({ error: 'Erro ao remover permissão' });
    }
});

// Update server prefix
app.post('/api/server/:guildId/prefix', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    const { prefix } = req.body;
    
    if (!prefix || prefix.length > 5) {
        return res.status(400).json({ error: 'Prefix inválido (máximo 5 caracteres)' });
    }
    
    try {
        const config = await dataStore.setServerPrefix(guildId, prefix);
        
        // Notify bot if connected locally
        if (botClient && typeof botClient.updateServerPrefix === 'function') {
            await botClient.updateServerPrefix(guildId, prefix);
        }
        
        res.json({ success: true, prefix: config.prefix });
    } catch (error) {
        console.error('Erro ao atualizar prefixo:', error);
        res.status(500).json({ error: 'Erro ao atualizar prefixo' });
    }
});

// Update server nickname
app.post('/api/server/:guildId/nickname', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    const { nickname } = req.body;
    
    if (nickname && nickname.length > 32) {
        return res.status(400).json({ error: 'Nickname inválido (máximo 32 caracteres)' });
    }
    
    try {
        const config = await dataStore.setServerNickname(guildId, nickname || '');
        
        // Notify bot if connected locally
        if (botClient && typeof botClient.updateServerNickname === 'function') {
            try {
                await botClient.updateServerNickname(guildId, config.nickname);
            } catch (err) {
                console.error('Erro ao atualizar nickname no Discord:', err);
                // Continue anyway - nickname update might fail due to permissions
            }
        }
        
        res.json({ success: true, nickname: config.nickname });
    } catch (error) {
        console.error('Erro ao atualizar nickname:', error);
        res.status(500).json({ error: 'Erro ao atualizar nickname' });
    }
});

// Get server channels
app.get('/api/server/:guildId/channels', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    try {
        // Try to get channels via bot client first (most reliable and doesn't need user token)
        // Note: This only works if bot is running in the same process as the web server
        if (botClient && botClient.guilds && botClient.guilds.cache) {
            const guild = botClient.guilds.cache.get(guildId);
            if (guild && guild.channels && guild.channels.cache) {
                const channels = Array.from(guild.channels.cache.values())
                    .filter(ch => ch && ch.isTextBased && ch.isTextBased())
                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                
                if (channels.length > 0) {
                    console.log(`✅ Canais carregados via bot client: ${channels.length} canais`);
                    return res.json(channels);
                }
            }
        } else {
            // Bot client not available (bot running separately) - check cache first
            console.log(`ℹ️  Bot client não disponível (bot rodando separadamente). Verificando cache...`);
            
            // Check cache for channels from bot
            // Check memory cache first
            const cached = channelsCache.get(guildId);
            if (cached && (Date.now() - cached.timestamp) < CHANNELS_CACHE_TTL) {
                // Filter only text channels from cached data
                const textChannels = cached.channels
                    .filter(ch => ch.isText || ch.type === 0 || ch.type === 5)
                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                console.log(`✅ Canais carregados do cache em memória: ${textChannels.length} canais`);
                return res.json(textChannels);
            }
            
            // Check database cache
            if (useDatabase && db && db.getGuildCache) {
                const dbChannels = await db.getGuildCache(guildId, 'channels');
                if (dbChannels && dbChannels.length > 0) {
                    const textChannels = dbChannels
                        .filter(ch => ch.isText || ch.type === 0 || ch.type === 5)
                        .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                    console.log(`✅ Canais carregados do cache do banco de dados: ${textChannels.length} canais`);
                    // Also update memory cache
                    channelsCache.set(guildId, {
                        channels: dbChannels,
                        timestamp: Date.now()
                    });
                    return res.json(textChannels);
                }
            }
            
            console.log(`⚠️ Canais não encontrados no cache. Usando token do usuário como fallback...`);
            // Note: Bot should send channels periodically, but if not in cache, we'll try user token as fallback
        }

        // Fallback: try with user token (required when bot runs separately and cache is empty)
        try {
            let token = await discordAuth.getValidAccessToken(req.user.user_id);
            if (!token) {
                console.warn('⚠️ Token do usuário não disponível para buscar canais');
            } else {
                // Try to fetch channels
                try {
                    const channelsRes = await axios.get(`https://discord.com/api/guilds/${guildId}/channels`, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 10000
                    });
                    const textChannels = channelsRes.data
                        .filter(ch => ch.type === 0 || ch.type === 5) // TEXT_CHANNEL or NEWS_CHANNEL
                        .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                    
                    console.log(`✅ Canais carregados via token do usuário: ${textChannels.length} canais`);
                    return res.json(textChannels);
                } catch (apiErr) {
                    // If it's a 401, try to refresh token and retry
                    if (apiErr.response && apiErr.response.status === 401) {
                        console.warn('⚠️ Token do usuário expirado ou inválido (401) - tentando renovar...');
                        
                        // Try to get a fresh token (getValidAccessToken handles refresh automatically)
                        const newToken = await discordAuth.getValidAccessToken(req.user.user_id);
                        if (newToken && newToken !== token) {
                            // Token was refreshed, retry request
                            console.log('🔄 Token renovado automaticamente, tentando novamente...');
                            try {
                                const retryRes = await axios.get(`https://discord.com/api/guilds/${guildId}/channels`, {
                                    headers: { Authorization: `Bearer ${newToken}` },
                                    timeout: 10000
                                });
                                const textChannels = retryRes.data
                                    .filter(ch => ch.type === 0 || ch.type === 5)
                                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                                
                                console.log(`✅ Canais carregados após renovação: ${textChannels.length} canais`);
                                return res.json(textChannels);
                            } catch (retryErr) {
                                console.warn('⚠️ Falha ao buscar canais mesmo após renovar token:', retryErr.message);
                            }
                        }
                        
                        // Try bot client one more time if available (unlikely but worth trying)
                        if (botClient && botClient.guilds && botClient.guilds.cache) {
                            console.log('   Tentando usar bot client como fallback...');
                            const guild = botClient.guilds.cache.get(guildId);
                            if (guild && guild.channels && guild.channels.cache) {
                                const channels = Array.from(guild.channels.cache.values())
                                    .filter(ch => ch && ch.isTextBased && ch.isTextBased())
                                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                                console.log(`✅ Canais carregados via bot client (fallback): ${channels.length} canais`);
                                return res.json(channels);
                            }
                        }
                        
                        // Return empty array - user needs to refresh the page to get new token
                        console.warn('   Retornando lista vazia. O usuário precisa atualizar a página para obter novo token.');
                    } else {
                        throw apiErr; // Re-throw if not 401
                    }
                }
            }
        } catch (err) {
            if (err.code === 'ECONNABORTED') {
                console.warn('⚠️ Timeout ao buscar canais com token do usuário');
            } else if (err.response && err.response.status !== 401) {
                // Only log if not 401 (already handled above)
                console.error('Erro ao buscar canais com token do usuário:', err.message || err);
            }
        }

        // If both methods fail, return empty array (user can refresh)
        console.warn('⚠️ Não foi possível carregar canais. Retornando lista vazia.');
        res.json([]);
    } catch (error) {
        console.error('Erro ao buscar canais:', error);
        res.status(500).json({ error: 'Erro ao buscar canais' });
    }
});

// Endpoint for bot to send roles (protected with secret token)
app.post('/api/bot/roles', express.json(), async (req, res) => {
    const { secret, guildId, roles } = req.body;
    
    // Verify secret token
    const expectedSecret = process.env.BOT_SYNC_SECRET || 'default_secret_change_me';
    if (secret !== expectedSecret) {
        console.warn('⚠️ Tentativa de enviar cargos com secret inválido');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!guildId || !roles) {
        return res.status(400).json({ error: 'guildId e roles são obrigatórios' });
    }
    
    try {
        // Cache roles in memory
        rolesCache.set(guildId, {
            roles: roles,
            timestamp: Date.now()
        });
        
        // Save to database cache
        if (useDatabase && db && db.updateGuildCache) {
            await db.updateGuildCache(guildId, 'roles', roles);
        }
        
        console.log(`✅ Cargos recebidos do bot para servidor ${guildId}: ${roles.length} cargos`);
        res.json({ success: true, message: 'Cargos recebidos com sucesso' });
    } catch (error) {
        console.error('Erro ao processar cargos do bot:', error);
        res.status(500).json({ error: 'Erro ao processar cargos' });
    }
});

// Endpoint for bot to send emojis (protected with secret token)
app.post('/api/bot/emojis', express.json(), async (req, res) => {
    const { secret, guildId, emojis } = req.body;
    
    // Verify secret token
    const expectedSecret = process.env.BOT_SYNC_SECRET || 'default_secret_change_me';
    if (secret !== expectedSecret) {
        console.warn('⚠️ Tentativa de enviar emojis com secret inválido');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!guildId || !emojis) {
        return res.status(400).json({ error: 'guildId e emojis são obrigatórios' });
    }
    
    try {
        // Cache emojis in memory
        emojisCache.set(guildId, {
            emojis: emojis,
            timestamp: Date.now()
        });
        
        // Save to database cache
        if (useDatabase && db && db.updateGuildCache) {
            await db.updateGuildCache(guildId, 'emojis', emojis);
        }
        
        console.log(`✅ Emojis recebidos do bot para servidor ${guildId}: ${emojis.length} emojis`);
        res.json({ success: true, message: 'Emojis recebidos com sucesso' });
    } catch (error) {
        console.error('Erro ao processar emojis do bot:', error);
        res.status(500).json({ error: 'Erro ao processar emojis' });
    }
});

// Get server roles
app.get('/api/server/:guildId/roles', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    try {
        // Try to get roles via bot client first (most reliable and doesn't need user token)
        if (botClient && botClient.guilds && botClient.guilds.cache) {
            const guild = botClient.guilds.cache.get(guildId);
            if (guild && guild.roles && guild.roles.cache) {
                const roles = Array.from(guild.roles.cache.values())
                    .filter(role => role.id !== guildId) // Exclude @everyone
                    .map(role => ({ id: role.id, name: role.name }));
                
                if (roles.length > 0) {
                    console.log(`✅ Cargos carregados via bot client: ${roles.length} cargos`);
                    return res.json(roles);
                }
            }
        } else {
            // Bot client not available (bot running separately) - check cache first
            console.log(`ℹ️  Bot client não disponível (bot rodando separadamente). Verificando cache...`);
            
            // Check cache for roles from bot
            const cached = rolesCache.get(guildId);
            if (cached && (Date.now() - cached.timestamp) < ROLES_CACHE_TTL) {
                const roles = cached.roles
                    .filter(role => role.id !== guildId) // Exclude @everyone
                    .map(role => ({ id: role.id, name: role.name }));
                console.log(`✅ Cargos carregados do cache (enviados pelo bot): ${roles.length} cargos`);
                return res.json(roles);
            }
            
            console.log(`⚠️ Cargos não encontrados no cache. Retornando lista vazia.`);
        }
    } catch (error) {
        console.error('Erro ao buscar cargos:', error);
        // Return empty array instead of error to prevent page breakage
        res.json([]);
    }
});

// Get server emojis
app.get('/api/server/:guildId/emojis', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    try {
        // Try to get emojis via bot client first (most reliable and doesn't need user token)
        if (botClient && botClient.guilds && botClient.guilds.cache) {
            const guild = botClient.guilds.cache.get(guildId);
            if (guild && guild.emojis && guild.emojis.cache) {
                const emojis = Array.from(guild.emojis.cache.values())
                    .map(emoji => ({
                        id: emoji.id,
                        name: emoji.name,
                        animated: emoji.animated,
                        url: emoji.url,
                        identifier: emoji.identifier
                    }));
                
                if (emojis.length > 0) {
                    console.log(`✅ Emojis carregados via bot client: ${emojis.length} emojis`);
                    return res.json(emojis);
                }
            }
        } else {
            // Bot client not available (bot running separately) - check cache first
            console.log(`ℹ️  Bot client não disponível (bot rodando separadamente). Verificando cache...`);
            
            // Check cache for emojis from bot
            const cached = emojisCache.get(guildId);
            if (cached && (Date.now() - cached.timestamp) < EMOJIS_CACHE_TTL) {
                const emojis = cached.emojis.map(emoji => ({
                    id: emoji.id,
                    name: emoji.name,
                    animated: emoji.animated,
                    url: emoji.url || `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=64`,
                    identifier: emoji.identifier || (emoji.animated ? `a:${emoji.name}:${emoji.id}` : `${emoji.name}:${emoji.id}`)
                }));
                console.log(`✅ Emojis carregados do cache (enviados pelo bot): ${emojis.length} emojis`);
                return res.json(emojis);
            }
            
            console.log(`⚠️ Emojis não encontrados no cache. Retornando lista vazia.`);
        }
        
        // Return empty array if bot is not available and cache is empty
        return res.json([]);
    } catch (error) {
        console.error('Erro ao buscar emojis:', error);
        res.json([]);
    }
});

// Update notification settings
app.post('/api/server/:guildId/notifications', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    const { type, enabled, channelId, message, embed, deleteAfter } = req.body;
    
    if (!type || (type !== 'memberJoin' && type !== 'memberLeave')) {
        return res.status(400).json({ error: 'Tipo de notificação inválido' });
    }
    
    try {
        const config = await dataStore.getServerConfig(guildId);
        if (!config.notifications) {
            config.notifications = {
                memberJoin: { enabled: false, channelId: null, message: '', embed: null, deleteAfter: 0 },
                memberLeave: { enabled: false, channelId: null, message: '', embed: null, deleteAfter: 0 }
            };
        }
        
        config.notifications[type] = {
            enabled: enabled || false,
            channelId: channelId || null,
            message: message || '',
            embed: embed || null,
            deleteAfter: deleteAfter || 0
        };
        
        await dataStore.updateServerConfig(guildId, { notifications: config.notifications });
        
        res.json({ success: true, notifications: config.notifications });
    } catch (error) {
        console.error('Erro ao atualizar notificações:', error);
        res.status(500).json({ error: 'Erro ao atualizar notificações' });
    }
});

// Update module status
app.post('/api/server/:guildId/module', discordAuth.authenticateToken, checkServerPermission, async (req, res) => {
    const { guildId } = req.params;
    const { module, enabled } = req.body;
    
    if (!module || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    
    try {
        const config = await dataStore.setModuleStatus(guildId, module, enabled);
        res.json({ success: true, modules: config.modules });
    } catch (error) {
        console.error('Erro ao atualizar módulo:', error);
        res.status(500).json({ error: 'Erro ao atualizar módulo' });
    }
});


// Check if user is admin
app.get('/api/user/is-admin', discordAuth.authenticateToken, async (req, res) => {
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.json({ isAdmin: false, isOwner: false });
    }
    
    // Owner is always admin
    if (userId === OWNER_ID) {
        return res.json({ isAdmin: true, isOwner: true });
    }
    
    // Check if user is in administrators table
    let isAdmin = false;
    if (useDatabase && db && db.isAdministrator) {
        isAdmin = await db.isAdministrator(userId);
    } else if (dataStore.isAdministrator) {
        isAdmin = await dataStore.isAdministrator(userId);
    }
    
    res.json({ isAdmin, isOwner: false });
});

// Get all user's servers with stats
app.get('/api/user/servers/stats', discordAuth.authenticateToken, async (req, res) => {
    try {
        const token = await discordAuth.getValidAccessToken(req.user.user_id);
        if (!token) {
            return res.status(401).json({ error: 'Sessão expirada' });
        }

        // Use cached function to avoid rate limits
        const guilds = await getUserGuildsCached(req.user.user_id, token);
        const filteredGuilds = guilds.filter(guild => guild.permissions & 0x20); // Manage server permission
        
        const serversWithStats = filteredGuilds.map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            ...dataStore.getServerStats(guild.id)
        }));

        res.json(serversWithStats);
    } catch (err) {
        console.error('Erro ao buscar servidores:', err.message);
        res.status(500).json({ error: 'Erro ao buscar servidores' });
    }
});

// Function to register bot instance
app.setBotClient = (client) => {
    botClient = client;
    console.log('✅ Bot client registrado no servidor web');
    console.log(`   - Bot disponível: ${botClient ? '✅' : '❌'}`);
    console.log(`   - Database disponível: ${useDatabase && db ? '✅' : '❌'}`);
    
    // Start periodic data sync from bot to site
    if (client && typeof client.getStats === 'function') {
        setInterval(async () => {
            try {
                // Sync bot presence for all guilds
                if (client.guilds && client.guilds.cache) {
                    for (const [guildId, guild] of client.guilds.cache) {
                        await dataStore.markBotPresent(guildId, true);
                    }
                }
            } catch (error) {
                console.error('Erro na sincronização periódica:', error);
            }
        }, 60000); // Sync every minute
    }
};

// In-memory cache for channels (guildId -> { channels, timestamp })
const channelsCache = new Map();
const rolesCache = new Map();
const emojisCache = new Map();
const CHANNELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROLES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const EMOJIS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Endpoint for bot to send channels (protected with secret token)
app.post('/api/bot/channels', express.json(), async (req, res) => {
    const { secret, guildId, channels } = req.body;
    
    // Verify secret token
    const expectedSecret = process.env.BOT_SYNC_SECRET || 'default_secret_change_me';
    if (secret !== expectedSecret) {
        console.warn('⚠️ Tentativa de enviar canais com secret inválido');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!guildId || !channels) {
        return res.status(400).json({ error: 'guildId e channels são obrigatórios' });
    }
    
    try {
        // Cache channels in memory
        channelsCache.set(guildId, {
            channels: channels,
            timestamp: Date.now()
        });
        
        // Save to database cache
        if (useDatabase && db && db.updateGuildCache) {
            await db.updateGuildCache(guildId, 'channels', channels);
        }
        
        console.log(`✅ Canais recebidos do bot para servidor ${guildId}: ${channels.length} canais`);
        res.json({ success: true, message: 'Canais recebidos com sucesso' });
    } catch (error) {
        console.error('Erro ao processar canais do bot:', error);
        res.status(500).json({ error: 'Erro ao processar canais' });
    }
});

// Endpoint for website to request channels from bot (triggers bot to send channels)
app.post('/api/bot/request-channels', discordAuth.authenticateToken, async (req, res) => {
    const { guildId } = req.body;
    
    if (!guildId) {
        return res.status(400).json({ error: 'guildId é obrigatório' });
    }
    
    try {
        // Clear cache to force refresh
        channelsCache.delete(guildId);
        
        // If bot client is available, trigger immediate sync
        if (botClient && botClient.sendChannelsToWebsite) {
            try {
                await botClient.sendChannelsToWebsite(guildId);
                return res.json({ 
                    success: true, 
                    message: 'Canais solicitados do bot com sucesso'
                });
            } catch (error) {
                console.warn('Erro ao solicitar canais do bot:', error.message);
            }
        }
        
        // Fallback: bot will sync on next cycle
        res.json({ 
            success: true, 
            message: 'Solicitação enviada. Canais serão atualizados em breve.',
            note: 'O bot sincroniza canais automaticamente a cada 2 minutos'
        });
    } catch (error) {
        console.error('Erro ao solicitar canais:', error);
        res.status(500).json({ error: 'Erro ao solicitar canais' });
    }
});

// Endpoint for bot to sync data (protected with secret token)
// Endpoint for bot to register itself
app.post('/api/bot/register', express.json(), async (req, res) => {
    const { secret } = req.body;
    
    // Verify secret token
    const expectedSecret = process.env.BOT_SYNC_SECRET || 'default_secret_change_me';
    if (secret !== expectedSecret) {
        console.warn('⚠️ Tentativa de registro com secret inválido');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Mark bot as active (we can't pass the client object, but we know bot is running)
    console.log('\n' + '='.repeat(60));
    console.log('🤖 BOT REGISTRADO NO SERVIDOR WEB');
    console.log('='.repeat(60));
    
    // Since bot and web server are separate processes, we can't pass the client object
    // But we can mark that bot is active
    botClient = { active: true, registered: true }; // Placeholder object
    
    console.log('='.repeat(60) + '\n');
    
    res.json({ success: true, message: 'Bot registrado com sucesso' });
});

app.post('/api/bot/sync', express.json(), async (req, res) => {
    const { secret, guilds, stats } = req.body;
    
    // Verify secret token
    const expectedSecret = process.env.BOT_SYNC_SECRET || 'default_secret_change_me';
    if (secret !== expectedSecret) {
        console.warn('⚠️ Tentativa de sincronização com secret inválido');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // If bot is syncing, it means bot is active - try to register if not already registered
    if (!botClient || !botClient.active) {
        console.log('🤖 Bot detectado via sync - marcando como ativo...');
        botClient = { active: true, registered: true };
    }
    
    try {
        // Sync bot presence for all guilds
        if (guilds && Array.isArray(guilds)) {
            console.log(`📡 Sincronizando ${guilds.length} servidor(es)...`);
            for (const guildId of guilds) {
                try {
                    await dataStore.markBotPresent(guildId, true);
                } catch (err) {
                    console.error(`   Erro ao marcar servidor ${guildId}:`, err.message);
                }
            }
            console.log('✅ Sincronização concluída');
        } else {
            console.warn('⚠️ Nenhum servidor recebido na sincronização');
        }
        
        res.json({ success: true, message: 'Data synced successfully' });
    } catch (error) {
        console.error('❌ Erro ao sincronizar dados do bot:', error.message);
        if (error.stack) {
            console.error('   Stack:', error.stack.split('\n').slice(0, 3).join('\n'));
        }
        res.status(500).json({ error: 'Erro ao sincronizar dados' });
    }
});

// Endpoint for site to request bot data
app.get('/api/bot/data', discordAuth.authenticateToken, async (req, res) => {
    try {
        if (!botClient || typeof botClient.getStats !== 'function') {
            return res.json({ 
                available: false,
                message: 'Bot não está conectado'
            });
        }
        
        const stats = botClient.getStats();
        const guilds = botClient.guilds ? Array.from(botClient.guilds.cache.keys()) : [];
        
        // Sync bot presence
        for (const guildId of guilds) {
            await dataStore.markBotPresent(guildId, true);
        }
        
        res.json({
            available: true,
            stats,
            guilds,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Erro ao buscar dados do bot:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do bot' });
    }
});

// Administrator routes
// Get all administrators
app.get('/api/admin/administrators', discordAuth.authenticateToken, checkAdministrator, async (req, res) => {
    try {
        let admins = [];
        if (useDatabase && db && db.getAllAdministrators) {
            admins = await db.getAllAdministrators();
        } else if (dataStore.getAllAdministrators) {
            admins = await dataStore.getAllAdministrators();
        }
        res.json(admins);
    } catch (error) {
        console.error('Erro ao buscar administradores:', error);
        res.status(500).json({ error: 'Erro ao buscar administradores' });
    }
});

// Get Discord user info by ID (for admin confirmation)
app.get('/api/discord/user/:userId', discordAuth.authenticateToken, async (req, res) => {
    const { userId } = req.params;
    
    if (!userId) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }
    
    try {
        // Use bot token to fetch user info
        const botToken = process.env.DISCORD_BOT_TOKEN;
        if (!botToken) {
            return res.status(500).json({ error: 'Bot token não configurado' });
        }
        
        const userRes = await axios.get(`https://discord.com/api/users/${userId}`, {
            headers: { Authorization: `Bot ${botToken}` }
        });
        
        res.json({
            id: userRes.data.id,
            username: userRes.data.username,
            discriminator: userRes.data.discriminator,
            avatar: userRes.data.avatar,
            avatarUrl: userRes.data.avatar 
                ? `https://cdn.discordapp.com/avatars/${userRes.data.id}/${userRes.data.avatar}.png?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${parseInt(userRes.data.discriminator || 0) % 5}.png`
        });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        console.error('Erro ao buscar usuário do Discord:', error);
        res.status(500).json({ error: 'Erro ao buscar usuário do Discord' });
    }
});

// Add administrator (only owner can add)
app.post('/api/admin/administrators', discordAuth.authenticateToken, checkAdministrator, async (req, res) => {
    if (!req.isOwner) {
        return res.status(403).json({ error: 'Apenas o dono pode adicionar administradores' });
    }
    
    const { userId, role } = req.body;
    const addedBy = req.user.user_id;
    
    if (!userId) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }
    
    // Can't add owner as admin
    if (userId === OWNER_ID) {
        return res.status(400).json({ error: 'O dono já é administrador' });
    }
    
    try {
        let success = false;
        if (useDatabase && db && db.addAdministrator) {
            success = await db.addAdministrator(userId, addedBy, role || 'admin');
        } else if (dataStore.addAdministrator) {
            success = await dataStore.addAdministrator(userId, addedBy, role || 'admin');
        }
        
        if (success) {
            res.json({ success: true, message: 'Administrador adicionado com sucesso' });
        } else {
            res.status(500).json({ error: 'Erro ao adicionar administrador' });
        }
    } catch (error) {
        console.error('Erro ao adicionar administrador:', error);
        res.status(500).json({ error: 'Erro ao adicionar administrador' });
    }
});

// Remove administrator (only owner can remove)
app.delete('/api/admin/administrators/:userId', discordAuth.authenticateToken, checkAdministrator, async (req, res) => {
    if (!req.isOwner) {
        return res.status(403).json({ error: 'Apenas o dono pode remover administradores' });
    }
    
    const { userId } = req.params;
    
    // Can't remove owner
    if (userId === OWNER_ID) {
        return res.status(400).json({ error: 'Não é possível remover o dono' });
    }
    
    try {
        let success = false;
        if (useDatabase && db && db.removeAdministrator) {
            success = await db.removeAdministrator(userId);
        } else if (dataStore.removeAdministrator) {
            success = await dataStore.removeAdministrator(userId);
        }
        
        if (success) {
            res.json({ success: true, message: 'Administrador removido com sucesso' });
        } else {
            res.status(500).json({ error: 'Erro ao remover administrador' });
        }
    } catch (error) {
        console.error('Erro ao remover administrador:', error);
        res.status(500).json({ error: 'Erro ao remover administrador' });
    }
});

// Get all servers where bot is present (only bot's servers, not owner's)
app.get('/api/admin/servers', discordAuth.authenticateToken, checkAdministrator, async (req, res) => {
    try {
        // Get all servers where bot is currently present
        const servers = [];
        
        if (botClient && botClient.guilds && botClient.guilds.cache) {
            // Iterate through all guilds where bot is present
            for (const [guildId, guild] of botClient.guilds.cache) {
                try {
                    // Get server config from database (if exists)
                    let serverConfig = null;
                    try {
                        serverConfig = await dataStore.getServerConfig(guildId);
                    } catch (err) {
                        // Server not in database yet, use defaults
                        serverConfig = null;
                    }
                    
                    // Format server data
                    servers.push({
                        guildId: guildId,
                        guildName: guild.name || 'Unknown',
                        guildIcon: guild.icon ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png` : null,
                        memberCount: guild.memberCount || 0,
                        prefix: serverConfig?.prefix || '!',
                        botPresent: true, // Bot is definitely present
                        lastSeen: serverConfig?.lastSeen || new Date().toISOString(),
                        stats: {
                            commandsExecuted: serverConfig?.stats?.commandsExecuted || 0,
                            uniqueUsers: serverConfig?.stats?.uniqueUsers?.size || serverConfig?.stats?.uniqueUsers || 0
                        },
                        modules: serverConfig?.modules || {}
                    });
                } catch (err) {
                    console.error(`Erro ao processar servidor ${guildId}:`, err);
                    // Still add server with minimal info
                    servers.push({
                        guildId: guildId,
                        guildName: guild.name || 'Error loading',
                        guildIcon: null,
                        memberCount: 0,
                        botPresent: true,
                        prefix: '!',
                        lastSeen: new Date().toISOString(),
                        stats: { commandsExecuted: 0, uniqueUsers: 0 },
                        modules: {}
                    });
                }
            }
        } else {
            // Bot not connected, return empty array
            console.warn('⚠️ Bot não está conectado, retornando lista vazia');
        }
        
        res.json(servers);
    } catch (error) {
        console.error('Erro ao buscar servidores:', error);
        res.status(500).json({ error: 'Erro ao buscar servidores' });
    }
});

// Rotas estáticas (sem extensão .html)
// IMPORTANTE: Estas rotas devem vir DEPOIS das rotas de API e ANTES do catch-all
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin', discordAuth.authenticateToken, async (req, res) => {
    // Check if user is admin before serving page
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.redirect('/dashboard?error=unauthorized');
    }
    
    // Owner is always admin
    if (userId === OWNER_ID) {
        return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    }
    
    // Check if user is admin
    let isAdmin = false;
    if (useDatabase && db && db.isAdministrator) {
        isAdmin = await db.isAdministrator(userId);
    } else if (dataStore.isAdministrator) {
        isAdmin = await dataStore.isAdministrator(userId);
    }
    
    if (!isAdmin) {
        return res.redirect('/dashboard?error=access_denied');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Cache for guilds to avoid rate limiting
const guildsCache = new Map();
const GUILDS_CACHE_TTL = 60000; // 1 minute cache

// Helper function to get user guilds with caching and rate limit handling
async function getUserGuildsCached(userId, token) {
    const cacheKey = `${userId}_guilds`;
    const cached = guildsCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < GUILDS_CACHE_TTL) {
        return cached.data;
    }
    
    try {
        const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        guildsCache.set(cacheKey, {
            data: guildsRes.data,
            timestamp: Date.now()
        });
        
        return guildsRes.data;
    } catch (error) {
        // Handle rate limit
        if (error.response && error.response.status === 429) {
            const retryAfter = parseFloat(error.response.headers['retry-after'] || error.response.data?.retry_after || 1);
            console.warn(`⚠️ Rate limit atingido. Aguardando ${retryAfter}s...`);
            
            // Return cached data if available, even if expired
            if (cached) {
                console.log('📦 Retornando dados em cache devido ao rate limit');
                return cached.data;
            }
            
            // Wait and retry once
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            try {
                const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return guildsRes.data;
            } catch (retryError) {
                // If still fails, return cached or empty
                console.error('❌ Retry após rate limit falhou:', retryError.message);
                return cached ? cached.data : [];
            }
        }
        throw error;
    }
}

// Helper function to check if user is server owner or has permission
async function checkServerPermission(req, res, next) {
    const { guildId } = req.params;
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    
    try {
        // Get user's guilds to check if they're owner
        const token = await discordAuth.getValidAccessToken(userId);
        if (!token) {
            return res.status(401).json({ error: 'Sessão expirada' });
        }
        
        const guilds = await getUserGuildsCached(userId, token);
        const guild = guilds.find(g => g.id === guildId);
        
        if (!guild) {
            return res.status(404).json({ error: 'Servidor não encontrado' });
        }
        
        // Check if user is owner (owner field is true in Discord API)
        const isOwner = guild.owner === true;
        
        // Check if user has permission in database
        let hasPerm = false;
        if (useDatabase && db && db.hasPermission) {
            hasPerm = await db.hasPermission(guildId, userId);
        } else if (dataStore.hasPermission) {
            hasPerm = await dataStore.hasPermission(guildId, userId);
        }
        
        if (!isOwner && !hasPerm) {
            return res.status(403).json({ error: 'Você não tem permissão para configurar este servidor' });
        }
        
        req.isOwner = isOwner;
        req.guild = guild;
        next();
    } catch (error) {
        console.error('Erro ao verificar permissão:', error.message);
        // Don't fail completely on rate limit, try to continue
        if (error.response && error.response.status === 429) {
            return res.status(429).json({ error: 'Muitas requisições. Tente novamente em alguns segundos.' });
        }
        return res.status(500).json({ error: 'Erro ao verificar permissão' });
    }
}

// Rota para página de configuração do servidor (deve vir depois das rotas de API)
app.get('/server/:guildId', discordAuth.authenticateToken, async (req, res) => {
    // Verificar se é uma requisição de arquivo estático (CSS, JS, etc)
    const requestedPath = req.path;
    if (requestedPath.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
        // Se for um arquivo estático, não processar como rota dinâmica
        return res.status(404).send('Not found');
    }
    
    // Check permissions before serving page
    const { guildId } = req.params;
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.redirect('/dashboard?error=unauthorized');
    }
    
    try {
        const token = await discordAuth.getValidAccessToken(userId);
        if (!token) {
            return res.redirect('/dashboard?error=session_expired');
        }
        
        // Use cached function to avoid rate limits
        const guilds = await getUserGuildsCached(userId, token);
        
        const guild = guilds.find(g => g.id === guildId);
        if (!guild) {
            return res.redirect('/dashboard?error=server_not_found');
        }
        
        const isOwner = guild.owner === true;
        let hasPerm = false;
        
        // Check database permissions
        if (useDatabase && db && db.hasPermission) {
            hasPerm = await db.hasPermission(guildId, userId);
        } else if (dataStore.hasPermission) {
            hasPerm = await dataStore.hasPermission(guildId, userId);
        }
        
        if (!isOwner && !hasPerm) {
            return res.redirect('/dashboard?error=no_permission');
        }
        
        res.sendFile(path.join(__dirname, 'public', 'server-config.html'));
    } catch (error) {
        console.error('Erro ao verificar permissão:', error);
        return res.redirect('/dashboard?error=permission_check_failed');
    }
});

app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌐 SERVIDOR WEB INICIADO`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   - Porta: ${PORT}`);
    console.log(`   - Database: ${useDatabase && db ? '✅ Habilitado' : '❌ Desabilitado'}`);
    console.log(`   - Bot Client: ${botClient ? '✅ Disponível' : '⏳ Aguardando registro'}`);
    console.log('💡 Bot roda separadamente - não tentando carregar bot no servidor web');
    console.log(`${'='.repeat(60)}\n`);
});
