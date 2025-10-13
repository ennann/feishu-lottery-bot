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
 * 获取飞书应用配置的函数
 */
const getFeishuConfig = async () => {
    return {
        appId: process.env.FEISHU_APP_ID || '',
        appSecret: process.env.FEISHU_APP_SECRET || ''
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
        // 处理 URL 验证（飞书开放平台配置时）
        if (req.body?.type === 'url_verification') {
            logger.info('收到 URL 验证请求');
            return res.status(200).json({
                challenge: req.body.challenge
            });
        }

        // 处理飞书事件回调
        const eventType = req.body?.event?.header?.event_type;

        if (!eventType) {
            logger.warn('未知的请求格式', JSON.stringify(req.body));
            return res.status(200).json({
                code: 0,
                message: '未知的请求格式'
            });
        }

        logger.info(`收到事件回调: ${eventType}`, JSON.stringify(req.body));

        // 只处理消息接收事件
        if (eventType === 'im.message.receive_v1') {
            // 初始化依赖（Vercel 环境使用内存 Redis）
            const redis = new InMemoryRedis();
            const client = await initLarkClient(getFeishuConfig);

            const dependencies = {
                client,
                redis,
                logger
            };

            // 执行抽奖逻辑
            const result = await lotteryDrawHandler(
                req.body,
                { getTokenFn: getFeishuConfig, redis },
                dependencies
            );

            return res.status(200).json(result);
        }

        // 其他事件类型暂不处理
        logger.info(`事件类型 ${eventType} 暂不处理`);
        return res.status(200).json({
            code: 0,
            message: '事件已接收'
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
