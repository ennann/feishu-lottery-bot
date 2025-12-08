/**
 * Vercel Serverless Function - 抽奖数据统计查询
 *
 * 路由: /api/lottery-stats
 * 方法: GET
 *
 * 提供抽奖数据的查询和统计功能
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { createStorage, NeonStorage } from '../lib/storage-neon';

/**
 * Vercel Serverless Function 处理器
 */
export default async (req: VercelRequest, res: VercelResponse) => {
    // 只允许 GET 请求
    if (req.method !== 'GET') {
        return res.status(405).json({
            code: -1,
            message: 'Method Not Allowed'
        });
    }

    try {
        const storage = await createStorage();

        // 检查是否是 Neon 存储（支持扩展查询功能）
        if (!(storage instanceof NeonStorage)) {
            return res.status(200).json({
                code: -1,
                message: '当前使用内存存储，不支持数据统计功能。请配置 Neon 数据库。',
                data: null
            });
        }

        const action = (req.query.action as string) || 'list';
        const chatId = req.query.chatId as string;
        const limit = parseInt((req.query.limit as string) || '50');
        const offset = parseInt((req.query.offset as string) || '0');

        switch (action) {
            case 'list':
                // 获取所有抽奖记录
                const draws = await storage.getAllDraws(limit, offset);
                return res.status(200).json({
                    code: 0,
                    message: '查询成功',
                    data: {
                        draws,
                        count: draws.length,
                        limit: limit,
                        offset: offset
                    }
                });

            case 'chat':
                // 获取指定群聊的抽奖记录
                if (!chatId) {
                    return res.status(400).json({
                        code: -1,
                        message: '缺少 chatId 参数'
                    });
                }
                const chatDraws = await storage.getDrawsByChatId(chatId, limit);
                return res.status(200).json({
                    code: 0,
                    message: '查询成功',
                    data: {
                        chatId,
                        draws: chatDraws,
                        count: chatDraws.length
                    }
                });

            case 'stats':
                // 获取统计数据
                const stats = await storage.getStatistics();
                return res.status(200).json({
                    code: 0,
                    message: '查询成功',
                    data: {
                        totalDraws: parseInt(stats.total_draws || '0'),
                        totalChats: parseInt(stats.total_chats || '0'),
                        uniqueWinners: parseInt(stats.unique_winners || '0'),
                        totalParticipants: parseInt(stats.total_participants || '0'),
                        avgParticipants: parseFloat(stats.avg_participants || '0')
                    }
                });

            default:
                return res.status(400).json({
                    code: -1,
                    message: `未知的 action 参数: ${action}。支持的值: list, chat, stats`
                });
        }

    } catch (error: any) {
        console.error('查询抽奖数据失败:', error);
        return res.status(500).json({
            code: -1,
            message: '服务器内部错误',
            error: error.message
        });
    }
};
