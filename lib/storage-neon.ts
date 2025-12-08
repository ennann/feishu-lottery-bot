/**
 * Neon Postgres 存储适配器
 * 提供持久化存储，兼容原有 Redis 接口
 * 并提供额外的数据分析功能
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

interface DrawRecord {
    id: number;
    root_message_id: string;
    winner_id: string;
    participant_count: number;
    chat_id: string;
    sender_id?: string;
    lottery_message_id?: string;
    tenant_key?: string;
    created_at: string;
}

interface DrawData {
    winnerId: string;
    participantCount: number;
    chatId?: string;
    senderId?: string;
    lotteryMessageId?: string;
    tenantKey?: string;
    timestamp?: number;
}

interface Statistics {
    total_draws?: string;
    total_chats?: string;
    unique_winners?: string;
    total_participants?: string;
    avg_participants?: string;
}

/**
 * Neon Postgres 适配器类
 * 实现与 InMemoryRedis 相同的接口，并扩展数据分析功能
 */
export class NeonStorage {
    private sql: NeonQueryFunction<any, any> | null;
    private initialized: boolean;

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
        if (!this.sql) return;
        try {
            await this.sql`
                CREATE TABLE IF NOT EXISTS lottery_draws (
                    id SERIAL PRIMARY KEY,
                    root_message_id VARCHAR(255) NOT NULL,
                    winner_id VARCHAR(255) NOT NULL,
                    participant_count INTEGER NOT NULL,
                    chat_id VARCHAR(255) NOT NULL,
                    sender_id VARCHAR(255),
                    lottery_message_id VARCHAR(255),
                    tenant_key VARCHAR(255),
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

            await this.sql`
                CREATE INDEX IF NOT EXISTS idx_lottery_draws_tenant_key
                ON lottery_draws(tenant_key);
            `;

            console.log('[Neon] 数据库表初始化完成');
        } catch (error) {
            console.error('[Neon] 表初始化失败:', error);
            throw error;
        }
    }

    /**
     * 获取抽奖记录（兼容 Redis get 接口）
     * @param key - 格式: "lottery:drawn:{root_message_id}"
     * @returns
     */
    async get(key: string): Promise<string | null> {
        await this.init();
        if (!this.sql) return null;

        try {
            // 从 key 中提取 root_message_id
            const rootMessageId = key.replace('lottery:drawn:', '');

            const result = await this.sql`
                SELECT winner_id, participant_count, created_at
                FROM lottery_draws
                WHERE root_message_id = ${rootMessageId}
                LIMIT 1;
            ` as any[];

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
     * @param key - 格式: "lottery:drawn:{root_message_id}"
     * @param value - JSON 字符串
     * @returns
     */
    async set(key: string, value: string): Promise<string> {
        await this.init();
        if (!this.sql) throw new Error('Database not initialized');

        try {
            // 从 key 中提取 root_message_id
            const rootMessageId = key.replace('lottery:drawn:', '');

            // 解析 value
            const data: DrawData = JSON.parse(value);

            // 插入新记录（支持多次抽奖，不使用 ON CONFLICT）
            await this.sql`
                INSERT INTO lottery_draws (
                    root_message_id,
                    winner_id,
                    participant_count,
                    chat_id,
                    sender_id,
                    lottery_message_id,
                    tenant_key
                )
                VALUES (
                    ${rootMessageId},
                    ${data.winnerId},
                    ${data.participantCount || 0},
                    ${data.chatId || ''},
                    ${data.senderId || ''},
                    ${data.lotteryMessageId || ''},
                    ${data.tenantKey || ''}
                );
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
     * @param key - 格式: "lottery:drawn:{root_message_id}"
     * @returns
     */
    async del(key: string): Promise<number> {
        await this.init();
        if (!this.sql) return 0;

        try {
            const rootMessageId = key.replace('lottery:drawn:', '');

            const result = await this.sql`
                DELETE FROM lottery_draws
                WHERE root_message_id = ${rootMessageId};
            ` as any[];

            return result.length > 0 ? 1 : 0;
        } catch (error) {
            console.error('[Neon] 删除失败:', error);
            return 0;
        }
    }

    /**
     * 检查数据库连接是否可用
     * @returns
     */
    async ping(): Promise<boolean> {
        try {
            await this.init();
            if (!this.sql) return false;
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
     * @param limit - 每页数量
     * @param offset - 偏移量
     * @returns
     */
    async getAllDraws(limit = 50, offset = 0): Promise<DrawRecord[]> {
        await this.init();
        if (!this.sql) return [];

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
                    tenant_key,
                    created_at
                FROM lottery_draws
                ORDER BY created_at DESC
                LIMIT ${limit}
                OFFSET ${offset};
            `;

            return result as DrawRecord[];
        } catch (error) {
            console.error('[Neon] 查询所有记录失败:', error);
            return [];
        }
    }

    /**
     * 获取指定群聊的抽奖记录
     * @param chatId - 群聊ID
     * @param limit - 数量限制
     * @returns
     */
    async getDrawsByChatId(chatId: string, limit = 50): Promise<DrawRecord[]> {
        await this.init();
        if (!this.sql) return [];

        try {
            const result = await this.sql`
                SELECT
                    id,
                    root_message_id,
                    winner_id,
                    participant_count,
                    tenant_key,
                    created_at
                FROM lottery_draws
                WHERE chat_id = ${chatId}
                ORDER BY created_at DESC
                LIMIT ${limit};
            `;

            return result as DrawRecord[];
        } catch (error) {
            console.error('[Neon] 查询群聊记录失败:', error);
            return [];
        }
    }

    /**
     * 获取指定根消息的所有抽奖记录（支持多次抽奖）
     * @param rootMessageId - 根消息ID
     * @returns
     */
    async getDrawsByRootMessageId(rootMessageId: string): Promise<DrawRecord[]> {
        await this.init();
        if (!this.sql) return [];

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
                    tenant_key,
                    created_at
                FROM lottery_draws
                WHERE root_message_id = ${rootMessageId}
                ORDER BY created_at DESC;
            `;

            return result as DrawRecord[];
        } catch (error) {
            console.error('[Neon] 查询根消息记录失败:', error);
            return [];
        }
    }

    /**
     * 统计数据
     * @returns
     */
    async getStatistics(): Promise<Statistics> {
        await this.init();
        if (!this.sql) return {};

        try {
            const result = await this.sql`
                SELECT
                    COUNT(*) as total_draws,
                    COUNT(DISTINCT chat_id) as total_chats,
                    COUNT(DISTINCT winner_id) as unique_winners,
                    SUM(participant_count) as total_participants,
                    AVG(participant_count) as avg_participants
                FROM lottery_draws;
            ` as any[];

            return (result[0] || {}) as Statistics;
        } catch (error) {
            console.error('[Neon] 统计查询失败:', error);
            return {};
        }
    }
}

/**
 * 内存 Redis 实现（用于本地开发或数据库不可用时的降级）
 */
export class InMemoryRedis {
    private store: Map<string, string>;

    constructor() {
        this.store = new Map();
    }

    async get(key: string): Promise<string | null> {
        return this.store.get(key) || null;
    }

    async set(key: string, value: string): Promise<string> {
        this.store.set(key, value);
        return 'OK';
    }

    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }

    async ping(): Promise<boolean> {
        return true;
    }
}

/**
 * 创建存储实例（自动选择 Neon 或内存）
 * @returns
 */
export async function createStorage(): Promise<NeonStorage | InMemoryRedis> {
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
