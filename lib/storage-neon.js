/**
 * Neon Postgres 存储适配器
 * 提供持久化存储，兼容原有 Redis 接口
 * 并提供额外的数据分析功能
 */

const { neon } = require('@neondatabase/serverless');

/**
 * Neon Postgres 适配器类
 * 实现与 InMemoryRedis 相同的接口，并扩展数据分析功能
 */
class NeonStorage {
    constructor() {
        this.sql = null;
        this.initialized = false;
    }

    /**
     * 初始化数据库连接
     */
    async init() {
        if (this.initialized) return;

        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL 环境变量未配置');
        }

        this.sql = neon(process.env.DATABASE_URL);
        this.initialized = true;

        // 确保表存在
        await this.ensureTableExists();
    }

    /**
     * 确保数据库表存在
     */
    async ensureTableExists() {
        try {
            await this.sql`
                CREATE TABLE IF NOT EXISTS lottery_draws (
                    id SERIAL PRIMARY KEY,
                    root_message_id VARCHAR(255) NOT NULL UNIQUE,
                    winner_id VARCHAR(255) NOT NULL,
                    participant_count INTEGER NOT NULL,
                    chat_id VARCHAR(255) NOT NULL,
                    sender_id VARCHAR(255),
                    lottery_message_id VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `;

            // 创建索引
            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_lottery_draws_root_message_id
                ON lottery_draws(root_message_id);
            `;

            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_lottery_draws_created_at
                ON lottery_draws(created_at DESC);
            `;

            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_lottery_draws_chat_id
                ON lottery_draws(chat_id);
            `;

            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_lottery_draws_winner_id
                ON lottery_draws(winner_id);
            `;

            console.log('[Neon] 数据库表初始化完成');
        } catch (error) {
            console.error('[Neon] 表初始化失败:', error);
            throw error;
        }
    }

    /**
     * 获取抽奖记录（兼容 Redis get 接口）
     * @param {string} key - 格式: "lottery:drawn:{root_message_id}"
     * @returns {Promise<string|null>}
     */
    async get(key) {
        await this.init();

        try {
            // 从 key 中提取 root_message_id
            const rootMessageId = key.replace('lottery:drawn:', '');

            const result = await this.sql`
                SELECT winner_id, participant_count, created_at
                FROM lottery_draws
                WHERE root_message_id = ${rootMessageId}
                LIMIT 1;
            `;

            if (result.length === 0) {
                return null;
            }

            // 返回与 Redis 格式兼容的 JSON 字符串
            return JSON.stringify({
                winnerId: result[0].winner_id,
                participantCount: result[0].participant_count,
                timestamp: new Date(result[0].created_at).getTime()
            });
        } catch (error) {
            console.error('[Neon] 查询失败:', error);
            return null;
        }
    }

    /**
     * 保存抽奖记录（兼容 Redis set 接口）
     * @param {string} key - 格式: "lottery:drawn:{root_message_id}"
     * @param {string} value - JSON 字符串
     * @returns {Promise<string>}
     */
    async set(key, value) {
        await this.init();

        try {
            // 从 key 中提取 root_message_id
            const rootMessageId = key.replace('lottery:drawn:', '');

            // 解析 value
            const data = JSON.parse(value);

            // 插入或更新记录
            await this.sql`
                INSERT INTO lottery_draws (
                    root_message_id,
                    winner_id,
                    participant_count,
                    chat_id,
                    sender_id,
                    lottery_message_id
                )
                VALUES (
                    ${rootMessageId},
                    ${data.winnerId},
                    ${data.participantCount || 0},
                    ${data.chatId || ''},
                    ${data.senderId || ''},
                    ${data.lotteryMessageId || ''}
                )
                ON CONFLICT (root_message_id)
                DO UPDATE SET
                    winner_id = EXCLUDED.winner_id,
                    participant_count = EXCLUDED.participant_count,
                    sender_id = EXCLUDED.sender_id,
                    lottery_message_id = EXCLUDED.lottery_message_id,
                    created_at = CURRENT_TIMESTAMP;
            `;

            console.log(`[Neon] 保存抽奖记录成功: ${rootMessageId}`);
            return 'OK';
        } catch (error) {
            console.error('[Neon] 保存失败:', error);
            throw error;
        }
    }

    /**
     * 删除抽奖记录（兼容 Redis del 接口）
     * @param {string} key - 格式: "lottery:drawn:{root_message_id}"
     * @returns {Promise<number>}
     */
    async del(key) {
        await this.init();

        try {
            const rootMessageId = key.replace('lottery:drawn:', '');

            const result = await this.sql`
                DELETE FROM lottery_draws
                WHERE root_message_id = ${rootMessageId};
            `;

            return result.length > 0 ? 1 : 0;
        } catch (error) {
            console.error('[Neon] 删除失败:', error);
            return 0;
        }
    }

    /**
     * 检查数据库连接是否可用
     * @returns {Promise<boolean>}
     */
    async ping() {
        try {
            await this.init();
            await this.sql`SELECT 1 as ping;`;
            return true;
        } catch (error) {
            console.error('[Neon] Ping 失败:', error);
            return false;
        }
    }

    // ========== 扩展功能：数据分析接口 ==========

    /**
     * 获取所有抽奖记录（带分页）
     * @param {number} limit - 每页数量
     * @param {number} offset - 偏移量
     * @returns {Promise<Array>}
     */
    async getAllDraws(limit = 50, offset = 0) {
        await this.init();

        try {
            const result = await this.sql`
                SELECT
                    id,
                    root_message_id,
                    winner_id,
                    participant_count,
                    chat_id,
                    sender_id,
                    lottery_message_id,
                    created_at
                FROM lottery_draws
                ORDER BY created_at DESC
                LIMIT ${limit}
                OFFSET ${offset};
            `;

            return result;
        } catch (error) {
            console.error('[Neon] 查询所有记录失败:', error);
            return [];
        }
    }

    /**
     * 获取指定群聊的抽奖记录
     * @param {string} chatId - 群聊ID
     * @param {number} limit - 数量限制
     * @returns {Promise<Array>}
     */
    async getDrawsByChatId(chatId, limit = 50) {
        await this.init();

        try {
            const result = await this.sql`
                SELECT
                    id,
                    root_message_id,
                    winner_id,
                    participant_count,
                    created_at
                FROM lottery_draws
                WHERE chat_id = ${chatId}
                ORDER BY created_at DESC
                LIMIT ${limit};
            `;

            return result;
        } catch (error) {
            console.error('[Neon] 查询群聊记录失败:', error);
            return [];
        }
    }

    /**
     * 统计数据
     * @returns {Promise<Object>}
     */
    async getStatistics() {
        await this.init();

        try {
            const result = await this.sql`
                SELECT
                    COUNT(*) as total_draws,
                    COUNT(DISTINCT chat_id) as total_chats,
                    COUNT(DISTINCT winner_id) as unique_winners,
                    SUM(participant_count) as total_participants,
                    AVG(participant_count) as avg_participants
                FROM lottery_draws;
            `;

            return result[0] || {};
        } catch (error) {
            console.error('[Neon] 统计查询失败:', error);
            return {};
        }
    }
}

/**
 * 内存 Redis 实现（用于本地开发或数据库不可用时的降级）
 */
class InMemoryRedis {
    constructor() {
        this.store = new Map();
    }

    async get(key) {
        return this.store.get(key) || null;
    }

    async set(key, value) {
        this.store.set(key, value);
        return 'OK';
    }

    async del(key) {
        return this.store.delete(key) ? 1 : 0;
    }

    async ping() {
        return true;
    }
}

/**
 * 创建存储实例（自动选择 Neon 或内存）
 * @returns {Promise<NeonStorage|InMemoryRedis>}
 */
async function createStorage() {
    // 检查是否配置了 Neon 数据库
    const hasDatabaseConfig = process.env.DATABASE_URL;

    if (hasDatabaseConfig) {
        console.log('[Storage] 使用 Neon Postgres 持久化存储');
        const neonStorage = new NeonStorage();

        // 测试数据库连接
        const isConnected = await neonStorage.ping();
        if (isConnected) {
            return neonStorage;
        } else {
            console.warn('[Storage] Neon 数据库连接失败，降级使用内存存储');
        }
    } else {
        console.warn('[Storage] 未配置 DATABASE_URL，使用内存存储（数据不会持久化）');
    }

    return new InMemoryRedis();
}

module.exports = {
    NeonStorage,
    InMemoryRedis,
    createStorage
};
