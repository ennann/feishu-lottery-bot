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

const { lotteryDrawHandler, initLarkClient, createLogger } = require('../lib/lottery-core');
const { createStorage } = require('../lib/storage-neon');

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
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;
    const logger = createLogger({ requestId });

    logger.info('>>> 收到新请求 <<<');
    logger.info(`请求ID: ${requestId}`);
    logger.info(`请求方法: ${req.method}`);
    logger.info(`请求路径: ${req.url}`);

    // 只允许 POST 请求
    if (req.method !== 'POST') {
        logger.warn('请求方法不允许，仅支持 POST');
        return res.status(405).json({
            code: -1,
            message: 'Method Not Allowed'
        });
    }

    try {
        // 处理 URL 验证（飞书开放平台配置时）
        if (req.body?.type === 'url_verification') {
            logger.info('>>> 处理 URL 验证请求');
            logger.info(`Challenge: ${req.body.challenge}`);
            return res.status(200).json({
                challenge: req.body.challenge
            });
        }

        // 处理飞书事件回调
        // 飞书有两种请求格式：
        // 1. 新格式: { schema: "2.0", header: {...}, event: {...} }
        // 2. 旧格式: { event: { header: {...}, event: {...} } }
        const eventType = req.body?.header?.event_type || req.body?.event?.header?.event_type;
        const tenantKey = req.body?.header?.tenant_key || req.body?.event?.header?.tenant_key;
        const eventId = req.body?.header?.event_id || req.body?.event?.header?.event_id;
        const appId = req.body?.header?.app_id || req.body?.event?.header?.app_id;
        

        if (!eventType) {
            logger.warn('未知的请求格式，缺少 event_type');
            logger.warn('请求体:', JSON.stringify(req.body, null, 2));
            return res.status(200).json({
                code: 0,
                message: '未知的请求格式'
            });
        }

        logger.info('>>> 收到飞书事件回调');
        logger.info(`事件类型: ${eventType}`);
        logger.info(`事件ID: ${eventId}`);
        logger.info(`应用ID: ${appId}`);

        // 只处理消息接收事件
        if (eventType === 'im.message.receive_v1') {
            // 兼容两种格式
            const message = req.body?.event?.message || req.body?.event?.event?.message;
            const sender = req.body?.event?.sender || req.body?.event?.event?.sender;

            logger.info('>>> 处理消息接收事件');
            logger.info(`消息ID: ${message?.message_id}`);
            logger.info(`会话ID: ${message?.chat_id}`);
            logger.info(`根消息ID: ${message?.root_id || '(无)'}`);
            logger.info(`发送者: ${sender?.sender_id?.open_id}`);
            logger.info(`消息内容: ${message?.content}`);
            logger.info(`租户Key: ${tenantKey || '(无)'}`);

            // 使用 Promise.race 策略：
            // 1. 如果抽奖逻辑在 2.5 秒内完成，返回实际结果
            // 2. 如果超过 2.5 秒，先返回 200，但继续执行抽奖
            const lotteryPromise = (async () => {
                try {
                    logger.info('>>> 开始处理抽奖逻辑');

                    // 初始化依赖（使用 Neon Postgres 持久化存储）
                    const storage = await createStorage();
                    const client = await initLarkClient(getFeishuConfig);

                    const dependencies = {
                        client,
                        redis: storage,  // 使用 redis 别名保持向后兼容
                        logger
                    };

                    // 将 tenantKey 添加到请求体中
                    const enrichedBody = {
                        ...req.body,
                        tenantKey: tenantKey
                    };

                    // 执行抽奖逻辑
                    const result = await lotteryDrawHandler(
                        enrichedBody,
                        { getTokenFn: getFeishuConfig, redis: storage },
                        dependencies
                    );

                    logger.info('>>> 抽奖逻辑执行完成', result);
                    return result;
                } catch (error) {
                    logger.error('处理抽奖逻辑失败', error);
                    throw error;
                }
            })();

            // 创建超时 Promise（2.5 秒）
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    logger.warn('抽奖逻辑执行时间较长，先返回响应');
                    resolve({ timeout: true });
                }, 2500);
            });

            // 竞速：如果 2.5 秒内完成就返回结果，否则返回通用响应
            const raceResult = await Promise.race([lotteryPromise, timeoutPromise]);

            if (raceResult.timeout) {
                // 超时情况：返回通用响应，但抽奖逻辑会继续执行
                res.status(200).json({
                    code: 0,
                    message: '事件已接收，正在处理中'
                });

                // 等待抽奖逻辑完成（不阻塞响应，但保持函数存活）
                try {
                    await lotteryPromise;
                    logger.info('>>> 延迟执行的抽奖逻辑已完成');
                } catch (error) {
                    logger.error('延迟执行的抽奖逻辑失败', error);
                }
            } else {
                // 快速完成：返回实际结果
                return res.status(200).json(raceResult);
            }

            return;
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
