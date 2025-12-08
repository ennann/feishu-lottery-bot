/**
 * Vercel Serverless Function - 健康检查
 *
 * 路由: /api/ping
 * 方法: GET
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
    res.status(200).json({
        status: 'ok',
        service: '飞书抽奖助手',
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL_ENV || 'development'
    });
};
