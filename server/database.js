/**
 * Database Module
 * PostgreSQL database connection and operations
 */

const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
// Support both connection string and individual variables
let poolConfig;

if (process.env.DATABASE_URL) {
    // Use connection string (recommended for Neon, Render, etc.)
    // Remove channel_binding if present (can cause issues)
    let connectionString = process.env.DATABASE_URL;
    if (connectionString.includes('channel_binding=require')) {
        connectionString = connectionString.replace(/[?&]channel_binding=require/g, '');
        console.log('⚠️  Removido channel_binding=require da string de conexão (pode causar problemas)');
    }
    
    poolConfig = {
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false
        },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000, // Increased to 15 seconds for Neon
        query_timeout: 30000,
        statement_timeout: 30000,
    };
} else {
    // Use individual variables
    poolConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'holly_bot',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased to 10 seconds
        query_timeout: 30000,
        statement_timeout: 30000,
    };
}

const pool = new Pool(poolConfig);

// Test connection on first query
let connectionTested = false;

async function testConnection() {
    if (connectionTested) return true;
    
    try {
        console.log('   Tentando conectar ao banco de dados Neon...');
        // Use a longer timeout for Neon
        const queryPromise = pool.query('SELECT NOW()');
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout após 20 segundos')), 20000)
        );
        
        await Promise.race([queryPromise, timeoutPromise]);
        connectionTested = true;
        const dbInfo = process.env.DATABASE_URL 
            ? 'via DATABASE_URL (Neon)' 
            : `${process.env.DB_USER || 'postgres'}@${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'holly_bot'}`;
        console.log(`✅ Conectado ao banco de dados PostgreSQL ${dbInfo}`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar ao banco de dados:', error.message);
        if (error.code) {
            console.error(`   Código: ${error.code}`);
        }
        if (error.host) {
            console.error(`   Host: ${error.host}`);
        }
        return false;
    }
}

pool.on('error', (err) => {
    console.error('❌ Erro inesperado no banco de dados:', err);
    // Don't exit, let it fallback to JSON
});

// Initialize database tables
async function initializeDatabase() {
    try {
        // Test connection first
        const connected = await testConnection();
        if (!connected) {
            throw new Error('Não foi possível conectar ao banco de dados');
        }
        
        // Create servers table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                guild_id VARCHAR(20) PRIMARY KEY,
                prefix VARCHAR(5) DEFAULT '!',
                bot_present BOOLEAN DEFAULT false,
                last_seen TIMESTAMP,
                modules JSONB DEFAULT '{"moderation": true, "fun": true, "utility": true, "music": false}'::jsonb,
                stats JSONB DEFAULT '{"commandsExecuted": 0, "commandsByCategory": {"moderation": 0, "fun": 0, "utility": 0, "music": 0, "other": 0}, "lastCommandTime": null, "uniqueUsers": []}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add bot_present and last_seen columns if they don't exist (for existing databases)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='servers' AND column_name='bot_present') THEN
                    ALTER TABLE servers ADD COLUMN bot_present BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='servers' AND column_name='last_seen') THEN
                    ALTER TABLE servers ADD COLUMN last_seen TIMESTAMP;
                END IF;
            END $$;
        `);

        // Create index for faster queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_servers_updated_at ON servers(updated_at)
        `);

        // Add TikTok integration column if it doesn't exist
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='servers' AND column_name='tiktok_config') THEN
                    ALTER TABLE servers ADD COLUMN tiktok_config JSONB DEFAULT '{"enabled": false, "username": "", "channelId": "", "notifyVideo": true, "notifyLive": true, "lastVideoId": null, "lastLiveStatus": false}'::jsonb;
                END IF;
            END $$;
        `);

        // Create server_permissions table for managing who can configure servers
        await pool.query(`
            CREATE TABLE IF NOT EXISTS server_permissions (
                id SERIAL PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                added_by VARCHAR(20),
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id),
                FOREIGN KEY (guild_id) REFERENCES servers(guild_id) ON DELETE CASCADE
            )
        `);

        // Create index for faster permission queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_server_permissions_guild_user 
            ON server_permissions(guild_id, user_id)
        `);

        // Create administrators table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS administrators (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(20) UNIQUE NOT NULL,
                added_by VARCHAR(20) NOT NULL,
                role VARCHAR(20) DEFAULT 'admin',
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create index for faster admin queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_administrators_user_id 
            ON administrators(user_id)
        `);

        // Create user_sessions table for persisting Discord OAuth sessions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_cache (
                guild_id VARCHAR(255) PRIMARY KEY,
                channels JSONB DEFAULT '[]'::jsonb,
                roles JSONB DEFAULT '[]'::jsonb,
                emojis JSONB DEFAULT '[]'::jsonb,
                channels_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                roles_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                emojis_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS user_sessions (
                user_id VARCHAR(20) PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create index for faster session queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at 
            ON user_sessions(expires_at)
        `);

        await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS profile_json JSONB`);
        await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS profile_cached_at TIMESTAMPTZ`);
        await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS guilds_json JSONB`);
        await pool.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS guilds_cached_at TIMESTAMPTZ`);

        console.log('✅ Tabelas do banco de dados inicializadas');
        return true;
    } catch (error) {
        console.error('❌ Erro ao inicializar banco de dados:', error.message);
        if (error.code) {
            console.error(`   Código: ${error.code}`);
        }
        if (error.host) {
            console.error(`   Host: ${error.host}`);
        }
        throw error; // Re-throw to let dataStore know it failed
    }
}

// Get server configuration
async function getServerConfig(guildId) {
    try {
        const result = await pool.query(
            'SELECT * FROM servers WHERE guild_id = $1',
            [guildId]
        );

        if (result.rows.length === 0) {
            // Create default config
            return await createDefaultConfig(guildId);
        }

        const row = result.rows[0];
        const stats = row.stats || {};
        
        // Handle uniqueUsers - ensure it's always a Set
        let uniqueUsers = new Set();
        if (stats.uniqueUsers) {
            if (Array.isArray(stats.uniqueUsers)) {
                uniqueUsers = new Set(stats.uniqueUsers);
            } else if (typeof stats.uniqueUsers === 'object' && stats.uniqueUsers !== null) {
                // If it's an object, try to convert to array
                try {
                    uniqueUsers = new Set(Object.values(stats.uniqueUsers));
                } catch (e) {
                    uniqueUsers = new Set();
                }
            }
        }
        
        const tiktokConfig = row.tiktok_config || {
            enabled: false,
            username: '',
            channelId: '',
            notifyVideo: true,
            notifyLive: true,
            lastVideoId: null,
            lastLiveStatus: false
        };
        
        return {
            prefix: row.prefix,
            nickname: stats.nickname || null,
            botPresent: row.bot_present || false,
            lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
            notifications: stats.notifications || {
                memberJoin: { enabled: false, channelId: null, message: '', useEmbed: false, embed: null },
                memberLeave: { enabled: false, channelId: null, message: '', useEmbed: false, embed: null }
            },
            modules: row.modules,
            tiktok: tiktokConfig,
            stats: {
                ...stats,
                nickname: stats.nickname || null,
                uniqueUsers: uniqueUsers
            }
        };
    } catch (error) {
        console.error('Erro ao buscar configuração do servidor:', error);
        throw error;
    }
}

// Create default server configuration
async function createDefaultConfig(guildId) {
    const defaultConfig = {
        prefix: '!',
        nickname: null,
        modules: {
            moderation: true,
            fun: true,
            utility: true,
            music: false
        },
        stats: {
            commandsExecuted: 0,
            commandsByCategory: {
                moderation: 0,
                fun: 0,
                utility: 0,
                music: 0,
                other: 0
            },
            lastCommandTime: null,
            uniqueUsers: [],
            nickname: null
        }
    };
    
    try {
        await pool.query(
            `INSERT INTO servers (guild_id, prefix, bot_present, last_seen, modules, stats)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (guild_id) DO NOTHING`,
            [guildId, defaultConfig.prefix, false, null, JSON.stringify(defaultConfig.modules), JSON.stringify(defaultConfig.stats)]
        );

        return {
            ...defaultConfig,
            botPresent: false,
            lastSeen: null,
            stats: {
                ...defaultConfig.stats,
                uniqueUsers: new Set()
            }
        };
    } catch (error) {
        console.error('Erro ao criar configuração padrão:', error);
        throw error;
    }
}

// Update server prefix
async function setServerPrefix(guildId, prefix) {
    try {
        await pool.query(
            'UPDATE servers SET prefix = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [prefix, guildId]
        );
        return await getServerConfig(guildId);
    } catch (error) {
        console.error('Erro ao atualizar prefixo:', error);
        throw error;
    }
}

// Update server nickname
async function setServerNickname(guildId, nickname) {
    try {
        const config = await getServerConfig(guildId);
        const nicknameValue = nickname && nickname.trim() ? nickname.trim() : null;
        
        // Store nickname in stats JSONB
        const updatedStats = {
            ...config.stats,
            nickname: nicknameValue
        };
        
        await pool.query(
            'UPDATE servers SET stats = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [JSON.stringify(updatedStats), guildId]
        );
        
        return await getServerConfig(guildId);
    } catch (error) {
        console.error('Erro ao atualizar nickname:', error);
        throw error;
    }
}

// Update server nickname
async function setServerNickname(guildId, nickname) {
    try {
        // Store nickname in stats JSONB for now (or add separate column)
        const config = await getServerConfig(guildId);
        config.nickname = nickname && nickname.trim() ? nickname.trim() : null;
        
        // Update in database - store in stats JSONB
        await pool.query(
            'UPDATE servers SET stats = jsonb_set(COALESCE(stats, \'{}\'::jsonb), \'{nickname}\', $1::jsonb), updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [JSON.stringify(config.nickname), guildId]
        );
        
        return await getServerConfig(guildId);
    } catch (error) {
        console.error('Erro ao atualizar nickname:', error);
        throw error;
    }
}

// Update TikTok configuration
async function updateTikTokConfig(guildId, tiktokConfig) {
    try {
        await pool.query(
            'UPDATE servers SET tiktok_config = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [JSON.stringify(tiktokConfig), guildId]
        );
        return await getServerConfig(guildId);
    } catch (error) {
        console.error('Erro ao atualizar configuração TikTok:', error);
        throw error;
    }
}

// Get all servers with TikTok enabled
async function getTikTokEnabledServers() {
    try {
        const result = await pool.query(
            `SELECT guild_id, tiktok_config FROM servers 
             WHERE tiktok_config->>'enabled' = 'true' 
             AND tiktok_config->>'username' != '' 
             AND tiktok_config->>'channelId' != ''`
        );
        return result.rows.map(row => ({
            guildId: row.guild_id,
            tiktok: row.tiktok_config
        }));
    } catch (error) {
        console.error('Erro ao buscar servidores com TikTok habilitado:', error);
        return [];
    }
}

// Update server config (for notifications and other complex updates)
async function updateServerConfig(guildId, config) {
    try {
        // Update notifications in stats JSONB
        if (config.notifications) {
            const currentConfig = await getServerConfig(guildId);
            const updatedStats = {
                ...currentConfig.stats,
                notifications: config.notifications
            };
            
            await pool.query(
                'UPDATE servers SET stats = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
                [JSON.stringify(updatedStats), guildId]
            );
        }
        
        return await getServerConfig(guildId);
    } catch (error) {
        console.error('Erro ao atualizar configuração:', error);
        throw error;
    }
}

// Update module status
async function setModuleStatus(guildId, moduleName, enabled) {
    try {
        const config = await getServerConfig(guildId);
        config.modules[moduleName] = enabled;
        
        await pool.query(
            'UPDATE servers SET modules = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [JSON.stringify(config.modules), guildId]
        );
        
        return config;
    } catch (error) {
        console.error('Erro ao atualizar módulo:', error);
        throw error;
    }
}

// Track command execution
async function trackCommand(guildId, commandName, category, userId) {
    try {
        const config = await getServerConfig(guildId);
        
        // Update stats
        config.stats.commandsExecuted++;
        config.stats.lastCommandTime = new Date().toISOString();
        
        if (category && config.stats.commandsByCategory[category] !== undefined) {
            config.stats.commandsByCategory[category]++;
        } else {
            config.stats.commandsByCategory.other++;
        }
        
        // Add unique user
        if (userId) {
            if (!(config.stats.uniqueUsers instanceof Set)) {
                config.stats.uniqueUsers = new Set(config.stats.uniqueUsers || []);
            }
            config.stats.uniqueUsers.add(userId);
        }
        
        // Convert Set to array for storage
        const statsToSave = {
            ...config.stats,
            uniqueUsers: Array.from(config.stats.uniqueUsers)
        };
        
        await pool.query(
            'UPDATE servers SET stats = $1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $2',
            [JSON.stringify(statsToSave), guildId]
        );
    } catch (error) {
        console.error('Erro ao rastrear comando:', error);
        throw error;
    }
}

// Get server statistics
async function getServerStats(guildId) {
    try {
        const config = await getServerConfig(guildId);
        return {
            prefix: config.prefix,
            commandsExecuted: config.stats.commandsExecuted,
            commandsByCategory: { ...config.stats.commandsByCategory },
            uniqueUsers: config.stats.uniqueUsers.size,
            lastCommandTime: config.stats.lastCommandTime,
            modules: { ...config.modules }
        };
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        throw error;
    }
}

// Get all servers
async function getAllServers() {
    try {
        const result = await pool.query('SELECT guild_id, prefix, bot_present, last_seen, modules, stats FROM servers');
        const servers = [];
        
        for (const row of result.rows) {
            const stats = await getServerStats(row.guild_id);
            servers.push({
                guildId: row.guild_id,
                guild_id: row.guild_id,
                prefix: row.prefix || '!',
                botPresent: row.bot_present || false,
                lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
                modules: row.modules || {},
                stats: {
                    ...stats,
                    uniqueUsers: stats.uniqueUsers || 0
                }
            });
        }
        
        return servers;
    } catch (error) {
        console.error('Erro ao buscar todos os servidores:', error);
        throw error;
    }
}

// Close database connection
async function closeDatabase() {
    await pool.end();
}

// Permission management functions
async function hasPermission(guildId, userId) {
    try {
        const result = await pool.query(
            'SELECT user_id FROM server_permissions WHERE guild_id = $1 AND user_id = $2',
            [guildId, userId]
        );
        return result.rows.length > 0;
    } catch (error) {
        console.error('Erro ao verificar permissão:', error);
        return false;
    }
}

async function addPermission(guildId, userId, addedBy) {
    try {
        await pool.query(
            'INSERT INTO server_permissions (guild_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT (guild_id, user_id) DO NOTHING',
            [guildId, userId, addedBy]
        );
        return true;
    } catch (error) {
        console.error('Erro ao adicionar permissão:', error);
        return false;
    }
}

async function removePermission(guildId, userId) {
    try {
        const result = await pool.query(
            'DELETE FROM server_permissions WHERE guild_id = $1 AND user_id = $2',
            [guildId, userId]
        );
        return result.rowCount > 0;
    } catch (error) {
        console.error('Erro ao remover permissão:', error);
        return false;
    }
}

async function getServerPermissions(guildId) {
    try {
        const result = await pool.query(
            'SELECT user_id, added_by, added_at FROM server_permissions WHERE guild_id = $1 ORDER BY added_at DESC',
            [guildId]
        );
        return result.rows;
    } catch (error) {
        console.error('Erro ao buscar permissões:', error);
        return [];
    }
}

// Administrator management functions
async function isAdministrator(userId) {
    try {
        const result = await pool.query(
            'SELECT user_id FROM administrators WHERE user_id = $1',
            [userId]
        );
        return result.rows.length > 0;
    } catch (error) {
        console.error('Erro ao verificar administrador:', error);
        return false;
    }
}

async function addAdministrator(userId, addedBy, role = 'admin') {
    try {
        await pool.query(
            'INSERT INTO administrators (user_id, added_by, role) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role',
            [userId, addedBy, role]
        );
        return true;
    } catch (error) {
        console.error('Erro ao adicionar administrador:', error);
        return false;
    }
}

async function removeAdministrator(userId) {
    try {
        const result = await pool.query(
            'DELETE FROM administrators WHERE user_id = $1',
            [userId]
        );
        return result.rowCount > 0;
    } catch (error) {
        console.error('Erro ao remover administrador:', error);
        return false;
    }
}

async function getAllAdministrators() {
    try {
        const result = await pool.query(
            'SELECT user_id, added_by, role, added_at FROM administrators ORDER BY added_at DESC'
        );
        return result.rows;
    } catch (error) {
        console.error('Erro ao buscar administradores:', error);
        return [];
    }
}

// Session management functions
async function getSession(userId) {
    try {
        const result = await pool.query(
            `SELECT access_token, refresh_token, expires_at,
                    profile_json, profile_cached_at, guilds_json, guilds_cached_at
             FROM user_sessions WHERE user_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const row = result.rows[0];
        return {
            access_token: row.access_token,
            refresh_token: row.refresh_token,
            expires_at: row.expires_at.getTime(),
            profile_json: row.profile_json || null,
            profile_cached_at: row.profile_cached_at ? row.profile_cached_at.getTime() : null,
            guilds_json: row.guilds_json || null,
            guilds_cached_at: row.guilds_cached_at ? row.guilds_cached_at.getTime() : null
        };
    } catch (error) {
        console.error('Erro ao buscar sessão:', error);
        return null;
    }
}

/** Atualiza apenas tokens (refresh OAuth). Preserva profile_json / guilds_json. */
async function updateSessionTokens(userId, accessToken, refreshToken, expiresAt) {
    try {
        await pool.query(
            `INSERT INTO user_sessions (user_id, access_token, refresh_token, expires_at, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) 
             DO UPDATE SET 
                 access_token = EXCLUDED.access_token,
                 refresh_token = EXCLUDED.refresh_token,
                 expires_at = EXCLUDED.expires_at,
                 updated_at = CURRENT_TIMESTAMP`,
            [userId, accessToken, refreshToken, new Date(expiresAt)]
        );
        return true;
    } catch (error) {
        console.error('Erro ao salvar sessão:', error);
        return false;
    }
}

/** Login OAuth: tokens + snapshot de perfil e guilds (uma vez por login). */
async function upsertOAuthSession(userId, accessToken, refreshToken, expiresAt, profile, guilds) {
    try {
        await pool.query(
            `INSERT INTO user_sessions (
                user_id, access_token, refresh_token, expires_at,
                profile_json, profile_cached_at, guilds_json, guilds_cached_at, updated_at
            )
             VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id)
             DO UPDATE SET
                 access_token = EXCLUDED.access_token,
                 refresh_token = EXCLUDED.refresh_token,
                 expires_at = EXCLUDED.expires_at,
                 profile_json = EXCLUDED.profile_json,
                 profile_cached_at = EXCLUDED.profile_cached_at,
                 guilds_json = EXCLUDED.guilds_json,
                 guilds_cached_at = EXCLUDED.guilds_cached_at,
                 updated_at = CURRENT_TIMESTAMP`,
            [userId, accessToken, refreshToken, new Date(expiresAt), JSON.stringify(profile), JSON.stringify(guilds)]
        );
        return true;
    } catch (error) {
        console.error('Erro ao salvar sessão OAuth:', error);
        return false;
    }
}

async function mergeSessionProfile(userId, profile) {
    try {
        await pool.query(
            `UPDATE user_sessions
             SET profile_json = $2::jsonb, profile_cached_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1`,
            [userId, JSON.stringify(profile)]
        );
        return true;
    } catch (error) {
        console.error('Erro ao atualizar profile_json:', error);
        return false;
    }
}

async function mergeSessionGuilds(userId, guilds) {
    try {
        await pool.query(
            `UPDATE user_sessions
             SET guilds_json = $2::jsonb, guilds_cached_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1`,
            [userId, JSON.stringify(guilds)]
        );
        return true;
    } catch (error) {
        console.error('Erro ao atualizar guilds_json:', error);
        return false;
    }
}

async function deleteSession(userId) {
    try {
        await pool.query(
            'DELETE FROM user_sessions WHERE user_id = $1',
            [userId]
        );
        return true;
    } catch (error) {
        console.error('Erro ao deletar sessão:', error);
        return false;
    }
}

// Guild cache functions
async function updateGuildCache(guildId, type, data) {
    try {
        const column = type === 'channels' ? 'channels' : type === 'roles' ? 'roles' : 'emojis';
        const timestampColumn = `${column}_updated_at`;
        
        // Get current cache
        const current = await pool.query(
            'SELECT * FROM guild_cache WHERE guild_id = $1',
            [guildId]
        );
        
        if (current.rows.length === 0) {
            // Create new cache entry
            await pool.query(
                `INSERT INTO guild_cache (guild_id, ${column}, ${timestampColumn})
                 VALUES ($1, $2, CURRENT_TIMESTAMP)`,
                [guildId, JSON.stringify(data)]
            );
        } else {
            // Compare and update only if changed
            const currentData = current.rows[0][column] || [];
            const currentDataStr = JSON.stringify(currentData.sort((a, b) => (a.id || '').localeCompare(b.id || '')));
            const newDataStr = JSON.stringify(data.sort((a, b) => (a.id || '').localeCompare(b.id || '')));
            
            if (currentDataStr !== newDataStr) {
                await pool.query(
                    `UPDATE guild_cache 
                     SET ${column} = $1, ${timestampColumn} = CURRENT_TIMESTAMP
                     WHERE guild_id = $2`,
                    [JSON.stringify(data), guildId]
                );
                console.log(`✅ Cache ${type} atualizado para servidor ${guildId}: ${data.length} itens`);
                return true; // Changed
            }
            return false; // No changes
        }
        return true;
    } catch (error) {
        console.error(`Erro ao atualizar cache ${type}:`, error);
        return false;
    }
}

async function getGuildCache(guildId, type) {
    try {
        const result = await pool.query(
            'SELECT * FROM guild_cache WHERE guild_id = $1',
            [guildId]
        );
        
        if (result.rows.length === 0) {
            return [];
        }
        
        const column = type === 'channels' ? 'channels' : type === 'roles' ? 'roles' : 'emojis';
        const data = result.rows[0][column];
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`Erro ao buscar cache ${type}:`, error);
        return [];
    }
}

module.exports = {
    pool,
    initializeDatabase,
    testConnection,
    getServerConfig,
    createDefaultConfig,
    setServerPrefix,
    setServerNickname,
    updateServerConfig,
    updateTikTokConfig,
    getTikTokEnabledServers,
    setModuleStatus,
    trackCommand,
    getServerStats,
    getAllServers,
    closeDatabase,
    hasPermission,
    addPermission,
    removePermission,
    getServerPermissions,
    isAdministrator,
    addAdministrator,
    removeAdministrator,
    getAllAdministrators,
    getSession,
    updateSessionTokens,
    upsertOAuthSession,
    mergeSessionProfile,
    mergeSessionGuilds,
    deleteSession,
    updateGuildCache,
    getGuildCache
};

