/**
 * Vercel Serverless Function - 飞书事件回调
 *
 * 路由: /api/lottery-event
 * 方法: POST
 *
 * 处理飞书开放平台的事件回调，包括：
 * 1. URL 验证
 * 2. 消息事件处理
 */

const { lotteryDrawHandler, initLarkClient, createLogger, InMemoryRedis } = require('../lib/lottery-core');

/**
 * 获取飞书 Token 的函数
 */
const getFeishuToken = async () => {
    return {
        appId: process.env.FEISHU_APP_ID || '',
        tenantAccessToken: process.env.FEISHU_TENANT_ACCESS_TOKEN || ''
    };
};

/**
 * Vercel Serverless Function 处理器
 */
module.exports = async (req, res) => {
    const logger = createLogger({ requestId: req.headers['x-request-id'] });

    // 只允许 POST 请求
    if (req.method !== 'POST') {
        return res.status(405).json({
            code: -1,
            message: 'Method Not Allowed'
        });
    }

    try {
        const eventType = req.body?.type;

        // 处理 URL 验证
        if (eventType === 'url_verification') {
            logger.info('收到 URL 验证请求');
            return res.status(200).json({
                challenge: req.body.challenge
            });
        }

        // 处理事件回调
        if (eventType === 'event_callback') {
            logger.info('收到事件回调', JSON.stringify(req.body));

            // 初始化依赖（Vercel 环境使用内存 Redis）
            const redis = new InMemoryRedis();
            const client = await initLarkClient(getFeishuToken);

            const dependencies = {
                client,
                redis,
                logger
            };

            // 执行抽奖逻辑
            const result = await lotteryDrawHandler(
                { event: req.body },
                { getTokenFn: getFeishuToken, redis },
                dependencies
            );

            return res.status(200).json(result);
        }

        // 未知事件类型
        logger.warn('未知的事件类型', eventType);
        return res.status(200).json({
            code: 0,
            message: '事件类型未处理'
        });

    } catch (error) {
        logger.error('处理飞书事件失败', error);
        return res.status(500).json({
            code: -1,
            message: '服务器内部错误',
            error: error.message
        });
    }
};
