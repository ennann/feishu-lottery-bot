/**
 * Vercel Serverless Function - 健康检查
 *
 * 路由: /api/ping
 * 方法: GET
 */

module.exports = async (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: '飞书抽奖助手',
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL_ENV || 'development'
    });
};
