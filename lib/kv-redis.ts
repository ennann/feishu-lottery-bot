/**
 * Vercel KV Redis 适配器
 * 提供持久化存储，兼容原有 Redis 接口
 */

import { kv } from '@vercel/kv';

/**
 * Vercel KV 适配器类
 * 实现与 InMemoryRedis 相同的接口
 */
export class VercelKVRedis {
    /**
     * 获取键值
     * @param key
     * @returns
     */
    async get(key: string): Promise<string | null> {
        try {
            const value = await kv.get<string>(key);
            return value || null;
        } catch (error) {
            console.error('[KV] 获取失败:', error);
            return null;
        }
    }

    /**
     * 设置键值
     * @param key
     * @param value
     * @returns
     */
    async set(key: string, value: string): Promise<string> {
        try {
            await kv.set(key, value);
            return 'OK';
        } catch (error) {
            console.error('[KV] 设置失败:', error);
            throw error;
        }
    }

    /**
     * 删除键
     * @param key
     * @returns
     */
    async del(key: string): Promise<number> {
        try {
            const result = await kv.del(key);
            return result;
        } catch (error) {
            console.error('[KV] 删除失败:', error);
            return 0;
        }
    }

    /**
     * 检查 KV 连接是否可用
     * @returns
     */
    async ping(): Promise<boolean> {
        try {
            await kv.set('_ping_test', 'pong');
            await kv.del('_ping_test');
            return true;
        } catch (error) {
            console.error('[KV] Ping 失败:', error);
            return false;
        }
    }
}

/**
 * 内存 Redis 实现（用于本地开发或 KV 不可用时的降级）
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
 * 创建 Redis 实例（自动选择 KV 或内存）
 * @returns
 */
export async function createRedis(): Promise<VercelKVRedis | InMemoryRedis> {
    // 检查是否配置了 Vercel KV 环境变量
    const hasKVConfig = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

    if (hasKVConfig) {
        console.log('[Storage] 使用 Vercel KV 持久化存储');
        const kvRedis = new VercelKVRedis();

        // 测试 KV 连接
        const isConnected = await kvRedis.ping();
        if (isConnected) {
            return kvRedis;
        } else {
            console.warn('[Storage] Vercel KV 连接失败，降级使用内存存储');
        }
    } else {
        console.warn('[Storage] 未配置 Vercel KV，使用内存存储（数据不会持久化）');
    }

    return new InMemoryRedis();
}
