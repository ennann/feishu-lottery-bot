/**
 * Vercel Serverless Function - 主页
 *
 * 路由: /api 或 /
 * 方法: GET
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
    const baseUrl = `https://${req.headers.host}`;

    res.status(200).json({
        service: '飞书抽奖助手 Serverless 服务',
        version: '1.0.0',
        description: '基于 Vercel Serverless Functions 的飞书消息抽奖助手',
        endpoints: {
            health: {
                url: `${baseUrl}/api/ping`,
                method: 'GET',
                description: '健康检查'
            },
            lotteryEvent: {
                url: `${baseUrl}/api/lottery-event`,
                method: 'POST',
                description: '飞书事件回调（生产环境）'
            },
            lotteryStats: {
                url: `${baseUrl}/api/lottery-stats`,
                method: 'GET',
                description: '抽奖数据统计查询',
                examples: {
                    list: `${baseUrl}/api/lottery-stats?action=list&limit=50&offset=0`,
                    chat: `${baseUrl}/api/lottery-stats?action=chat&chatId=oc_xxx`,
                    stats: `${baseUrl}/api/lottery-stats?action=stats`
                }
            }
        },
        documentation: 'https://github.com/ennann/feishu-lottery',
        timestamp: new Date().toISOString()
    });
};
