/**
 * Vercel Serverless Function - 主页
 *
 * 路由: /api 或 /
 * 方法: GET
 */

module.exports = async (req, res) => {
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
            }
        },
        documentation: 'https://github.com/your-repo/lottery-assistant',
        timestamp: new Date().toISOString()
    });
};
