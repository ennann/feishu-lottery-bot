/**
 * 独立的飞书抽奖助手 FaaS 函数
 * 函数式编程范式实现 + Express 服务器集成
 *
 * 功能说明：
 * 1. 接收飞书消息事件
 * 2. 检测消息中是否包含"开奖"关键词
 * 3. 获取根消息的点赞用户列表
 * 4. 随机抽取中奖用户
 * 5. 发送中奖通知消息
 * 6. 防止重复开奖
 */

const express = require('express');
const process = require('process');
const fs = require('fs');
const path = require('path');
const lark = require('@larksuiteoapi/node-sdk');

// ==================== 纯函数工具集 ====================

/**
 * 计时器纯函数
 */
const Timer = {
    create: () => ({
        startTime: new Date(),
        endTime: null
    }),

    end: (timer) => ({
        ...timer,
        endTime: new Date()
    }),

    duration: (timer) => {
        if (!timer.endTime) return 0;
        return timer.endTime - timer.startTime;
    },

    format: (timer) => {
        const duration = Timer.duration(timer);
        const start = timer.startTime.toISOString();
        const end = timer.endTime ? timer.endTime.toISOString() : 'N/A';
        return `Start: ${start}, End: ${end}, Duration: ${duration}ms`;
    }
};

/**
 * 日志记录器（函数式封装）
 */
const createLogger = (context = {}) => ({
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || '')
});

/**
 * 结果类型（Either Monad 模式）
 */
const Result = {
    Ok: (value) => ({ success: true, value }),
    Err: (error) => ({ success: false, error }),
    isOk: (result) => result.success === true,
    isErr: (result) => result.success === false,
    map: (result, fn) => result.success ? Result.Ok(fn(result.value)) : result,
    flatMap: (result, fn) => result.success ? fn(result.value) : result,
    getOrElse: (result, defaultValue) => result.success ? result.value : defaultValue
};

/**
 * 异步结果封装
 */
const asyncTry = async (fn) => {
    try {
        const result = await fn();
        return Result.Ok(result);
    } catch (error) {
        return Result.Err(error);
    }
};

// ==================== 数据验证函数 ====================

/**
 * 验证参数是否为空
 */
const isValidParams = (params) =>
    params && typeof params === 'object' && Object.keys(params).length > 0;

/**
 * 验证消息事件结构
 */
const isValidMessageEvent = (params) =>
    params?.event?.event?.message != null;

/**
 * 解析消息内容
 */
const parseMessageContent = (messageContent) => {
    try {
        const parsed = JSON.parse(messageContent);
        return Result.Ok(parsed);
    } catch (error) {
        return Result.Err(new Error('消息内容解析失败'));
    }
};

/**
 * 检查消息是否包含开奖关键词
 */
const hasLotteryKeyword = (parsedContent) => {
    const text = parsedContent?.text || '';
    return text.includes('开奖');
};

// ==================== 飞书客户端相关函数 ====================

/**
 * 创建飞书客户端（纯函数配置）
 */
const createLarkClientConfig = (appId, tenantAccessToken, appSecret = 'fake') => ({
    appId,
    appSecret,
    disableTokenCache: false,
    loggerLevel: lark.LoggerLevel.info,
    tenantAccessToken
});

/**
 * 初始化飞书客户端
 */
const initLarkClient = async (getTokenFn) => {
    const { appId, tenantAccessToken } = await getTokenFn();
    const config = createLarkClientConfig(appId, tenantAccessToken);
    const client = new lark.Client(config);

    // 设置 token 缓存
    client.tokenManager.cache.set(
        lark.CTenantAccessToken,
        tenantAccessToken,
        null,
        { namespace: appId }
    );

    // 设置响应拦截器
    client.httpInstance.interceptors.response.use(
        (resp) => resp,
        async (error) => {
            const detail = [
                '接口：', error.request?.path,
                '，失败原因：', error.response?.data?.msg
            ];
            if (error.response?.data?.error?.helps?.length) {
                detail.push('，参考链接：', error.response.data.error.helps[0].url);
            }
            console.error('调用开放平台接口失败，', ...detail);
            return Promise.reject(error);
        }
    );

    return client;
};

// ==================== Redis 操作函数 ====================

/**
 * 生成抽奖记录 key
 */
const getLotteryKey = (rootMessageId) => `lottery:drawn:${rootMessageId}`;

/**
 * 检查是否已开奖
 */
const checkIfDrawn = async (redis, rootMessageId) => {
    const key = getLotteryKey(rootMessageId);
    const result = await redis.get(key);
    return result != null;
};

/**
 * 保存开奖记录
 */
const saveLotteryRecord = async (redis, rootMessageId, winnerId, participantCount) => {
    const key = getLotteryKey(rootMessageId);
    const record = {
        winnerId,
        drawnAt: new Date().toISOString(),
        participantCount
    };
    await redis.set(key, JSON.stringify(record));
    return record;
};

// ==================== 点赞信息处理函数 ====================

/**
 * 获取消息点赞信息（迭代器模式）
 */
const fetchReactions = async (client, messageId) => {
    const pages = [];
    const iterator = await client.im.v1.messageReaction.listWithIterator({
        path: { message_id: messageId }
    });

    for await (const item of iterator) {
        pages.push(item);
    }

    return pages;
};

/**
 * 从点赞记录中提取用户 ID（纯函数）
 */
const extractUserIds = (reactionPages) => {
    const userIdSet = new Set();

    reactionPages.forEach((page) => {
        if (page.items && Array.isArray(page.items)) {
            page.items.forEach((reaction) => {
                const operator = reaction.operator;
                if (operator?.operator_type === 'user' && operator.operator_id) {
                    userIdSet.add(operator.operator_id);
                }
            });
        }
    });

    return Array.from(userIdSet);
};

/**
 * 随机选择中奖用户（纯函数）
 */
const selectRandomWinner = (participants) => {
    if (participants.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * participants.length);
    return participants[randomIndex];
};

// ==================== 消息构建函数 ====================

/**
 * 构建中奖消息内容（纯函数）
 */
const buildWinnerMessage = (winnerId) => ({
    content: JSON.stringify({
        schema: '2.0',
        config: {
            update_multi: true
        },
        body: {
            direction: 'vertical',
            elements: [
                {
                    tag: 'markdown',
                    content: `:PARTY: 恭喜 <font color='indigo'><at id=${winnerId}></at></font> 抽得本次大奖！\n`,
                    text_align: 'left',
                    text_size: 'normal',
                    margin: '0px 0px 0px 0px'
                },
                {
                    tag: 'div',
                    text: {
                        tag: 'plain_text',
                        content: '请联系消息发布人，及时领取您的奖品~',
                        text_size: 'notation',
                        text_align: 'left',
                        text_color: 'grey'
                    }
                }
            ]
        }
    }),
    msg_type: 'interactive'
});

/**
 * 发送回复消息
 */
const sendReplyMessage = async (client, messageId, messageData) => {
    return await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: messageData
    });
};

// ==================== 主业务流程函数（函数式组合） ====================

/**
 * 步骤 1: 验证和提取消息信息
 */
const validateAndExtractMessage = (params) => {
    if (!isValidParams(params)) {
        return Result.Err(new Error('缺少必要的参数'));
    }

    if (!isValidMessageEvent(params)) {
        return Result.Err(new Error('消息事件结构无效'));
    }

    const message = params.event.event.message;
    const { chat_id, content, root_id, message_id } = message;

    return Result.Ok({
        chatId: chat_id,
        messageContent: content,
        rootMessageId: root_id,
        messageId: message_id
    });
};

/**
 * 步骤 2: 验证消息内容
 */
const validateMessageContent = (messageInfo) => {
    const parseResult = parseMessageContent(messageInfo.messageContent);

    if (Result.isErr(parseResult)) {
        return parseResult;
    }

    const parsedContent = parseResult.value;

    if (!hasLotteryKeyword(parsedContent)) {
        return Result.Err(new Error('消息不包含开奖关键词'));
    }

    if (!messageInfo.rootMessageId) {
        return Result.Err(new Error('没有根消息ID'));
    }

    return Result.Ok({ ...messageInfo, parsedContent });
};

/**
 * 步骤 3: 检查是否已开奖
 */
const checkLotteryStatus = async (redis, messageInfo) => {
    const hasDrawn = await checkIfDrawn(redis, messageInfo.rootMessageId);

    if (hasDrawn) {
        return Result.Err(new Error('该消息已经开过奖了'));
    }

    return Result.Ok(messageInfo);
};

/**
 * 步骤 4: 获取参与者列表
 */
const getParticipants = async (client, logger, messageInfo) => {
    try {
        const reactionPages = await fetchReactions(client, messageInfo.rootMessageId);
        logger.info(`获取到 ${reactionPages.length} 页点赞记录`);

        const participants = extractUserIds(reactionPages);
        logger.info(`去重后共有 ${participants.length} 位用户点赞`);

        if (participants.length === 0) {
            return Result.Err(new Error('没有参与抽奖的用户'));
        }

        return Result.Ok({ ...messageInfo, participants });
    } catch (error) {
        logger.error('获取点赞信息失败', error);
        return Result.Err(new Error('获取点赞信息失败'));
    }
};

/**
 * 步骤 5: 抽取中奖用户
 */
const drawWinner = (lotteryData) => {
    const winnerId = selectRandomWinner(lotteryData.participants);

    if (!winnerId) {
        return Result.Err(new Error('抽奖失败'));
    }

    return Result.Ok({ ...lotteryData, winnerId });
};

/**
 * 步骤 6: 发送中奖通知
 */
const notifyWinner = async (client, logger, winnerData) => {
    try {
        const messageData = buildWinnerMessage(winnerData.winnerId);
        const response = await sendReplyMessage(client, winnerData.messageId, messageData);
        logger.info('中奖消息发送成功');
        return Result.Ok(winnerData);
    } catch (error) {
        logger.error('发送中奖消息失败', error);
        return Result.Err(new Error('发送中奖消息失败'));
    }
};

/**
 * 步骤 7: 保存开奖记录
 */
const recordLottery = async (redis, logger, winnerData) => {
    try {
        await saveLotteryRecord(
            redis,
            winnerData.rootMessageId,
            winnerData.winnerId,
            winnerData.participants.length
        );
        logger.info(`已将开奖记录存入 Redis: ${getLotteryKey(winnerData.rootMessageId)}`);
        return Result.Ok(winnerData);
    } catch (error) {
        logger.error('保存开奖记录失败', error);
        return Result.Err(new Error('保存开奖记录失败'));
    }
};

// ==================== 主函数（组合所有步骤） ====================

/**
 * 抽奖主流程（函数式管道）
 */
const executeLottery = async (dependencies, params) => {
    const { client, redis, logger } = dependencies;

    // 步骤 1-2: 验证参数和消息内容
    const messageValidation = validateAndExtractMessage(params);
    if (Result.isErr(messageValidation)) {
        return messageValidation;
    }

    const contentValidation = validateMessageContent(messageValidation.value);
    if (Result.isErr(contentValidation)) {
        return contentValidation;
    }

    const messageInfo = contentValidation.value;
    logger.info(`处理消息: chatId=${messageInfo.chatId}, rootId=${messageInfo.rootMessageId}`);

    // 步骤 3: 检查开奖状态
    const statusCheck = await checkLotteryStatus(redis, messageInfo);
    if (Result.isErr(statusCheck)) {
        return statusCheck;
    }

    // 步骤 4: 获取参与者
    const participantsResult = await getParticipants(client, logger, statusCheck.value);
    if (Result.isErr(participantsResult)) {
        return participantsResult;
    }

    // 步骤 5: 抽取中奖用户
    const winnerResult = drawWinner(participantsResult.value);
    if (Result.isErr(winnerResult)) {
        return winnerResult;
    }

    logger.info(`抽中的用户ID: ${winnerResult.value.winnerId}`);

    // 步骤 6: 发送通知
    const notifyResult = await notifyWinner(client, logger, winnerResult.value);
    if (Result.isErr(notifyResult)) {
        return notifyResult;
    }

    // 步骤 7: 记录开奖
    const recordResult = await recordLottery(redis, logger, notifyResult.value);
    if (Result.isErr(recordResult)) {
        return recordResult;
    }

    return Result.Ok({
        winnerId: recordResult.value.winnerId,
        participantCount: recordResult.value.participants.length
    });
};

// ==================== 导出的主函数（FaaS 入口） ====================

/**
 * FaaS 函数主入口
 *
 * @param {Object} params - 函数参数（包含飞书事件数据）
 * @param {Object} context - 上下文（包含环境变量等）
 * @param {Object} dependencies - 依赖注入（用于测试）
 * @returns {Promise<Object>} 执行结果
 */
async function lotteryDrawHandler(params, context = {}, dependencies = null) {
    const logger = createLogger(context);
    const timer = Timer.create();

    logger.info('【飞书抽奖助手】函数开始执行', JSON.stringify(params));

    try {
        // 依赖注入（支持测试 mock）
        const deps = dependencies || {
            client: await initLarkClient(context.getTokenFn),
            redis: context.redis,
            logger
        };

        // 执行抽奖流程
        const result = await executeLottery(deps, params);

        if (Result.isErr(result)) {
            logger.error('抽奖失败', result.error.message);
            return {
                code: 0,
                message: result.error.message
            };
        }

        const { winnerId, participantCount } = result.value;
        logger.info(`抽奖成功！中奖用户: ${winnerId}, 参与人数: ${participantCount}`);

        return {
            code: 0,
            message: '抽奖成功',
            data: {
                winnerId,
                participantCount
            }
        };

    } catch (error) {
        logger.error('函数执行异常', error);
        return {
            code: -1,
            message: `函数执行失败: ${error.message}`
        };
    } finally {
        const endedTimer = Timer.end(timer);
        logger.info(`【飞书抽奖助手】函数执行结束，${Timer.format(endedTimer)}`);
    }
}

// ==================== Redis 模拟实现（用于开发/测试） ====================

/**
 * 简单的内存 Redis 实现
 * 生产环境应替换为真实的 Redis 客户端
 */
class InMemoryRedis {
    constructor() {
        this.store = new Map();
    }

    async get(key) {
        return this.store.get(key) || null;
    }

    async set(key, value, ...options) {
        this.store.set(key, value);
        // 简化实现，不处理 EX 等参数
        return 'OK';
    }

    async del(key) {
        return this.store.delete(key);
    }
}

// ==================== 配置管理 ====================

/**
 * 环境配置
 * 从环境变量或配置文件读取
 */
const config = {
    port: process.env._FAAS_RUNTIME_PORT || process.env.PORT || 8000,
    host: '0.0.0.0',

    // 飞书配置
    feishu: {
        appId: process.env.FEISHU_APP_ID || '',
        appSecret: process.env.FEISHU_APP_SECRET || '',
        tenantAccessToken: process.env.FEISHU_TENANT_ACCESS_TOKEN || ''
    },

    // Redis 配置
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
    }
};

/**
 * 获取飞书 Token 的函数
 */
const getFeishuToken = async () => {
    return {
        appId: config.feishu.appId,
        tenantAccessToken: config.feishu.tenantAccessToken
    };
};

// ==================== Express 应用设置 ====================

const app = express();

// 中间件
app.use(express.json()); // 解析 JSON body
app.use(express.urlencoded({ extended: true })); // 解析 URL-encoded body

// 静态文件服务（如果有 static 目录）
const staticPath = path.resolve(__dirname, './static');
if (fs.existsSync(staticPath)) {
    app.use(express.static(staticPath));
}

// 日志中间件
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ==================== API 路由 ====================

/**
 * 健康检查端点
 */
app.get('/v1/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 飞书事件回调端点
 * POST /api/lottery/event
 */
app.post('/api/lottery/event', async (req, res) => {
    const logger = createLogger({ requestId: req.headers['x-request-id'] });

    try {
        // 飞书事件验证
        const eventType = req.body?.type;

        // URL 验证
        if (eventType === 'url_verification') {
            logger.info('收到 URL 验证请求');
            return res.json({
                challenge: req.body.challenge
            });
        }

        // 事件回调
        if (eventType === 'event_callback') {
            logger.info('收到事件回调', JSON.stringify(req.body));

            // 初始化依赖
            const redis = new InMemoryRedis(); // 生产环境替换为真实 Redis
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

            // 返回结果
            return res.json(result);
        }

        // 其他类型事件
        logger.warn('未知的事件类型', eventType);
        return res.json({ code: 0, message: '事件类型未处理' });

    } catch (error) {
        logger.error('处理飞书事件失败', error);
        return res.status(500).json({
            code: -1,
            message: '服务器内部错误',
            error: error.message
        });
    }
});

/**
 * 手动触发抽奖端点（用于测试）
 * POST /api/lottery/manual
 */
app.post('/api/lottery/manual', async (req, res) => {
    const logger = createLogger();

    try {
        const redis = new InMemoryRedis();
        const client = await initLarkClient(getFeishuToken);

        const dependencies = {
            client,
            redis,
            logger
        };

        const result = await lotteryDrawHandler(
            req.body,
            { getTokenFn: getFeishuToken, redis },
            dependencies
        );

        return res.json(result);

    } catch (error) {
        logger.error('手动触发抽奖失败', error);
        return res.status(500).json({
            code: -1,
            message: '抽奖失败',
            error: error.message
        });
    }
});

/**
 * 获取配置信息端点（调试用）
 */
app.get('/api/config', (req, res) => {
    res.json({
        port: config.port,
        feishu: {
            appId: config.feishu.appId ? '已配置' : '未配置',
            appSecret: config.feishu.appSecret ? '已配置' : '未配置',
            tenantAccessToken: config.feishu.tenantAccessToken ? '已配置' : '未配置'
        }
    });
});

/**
 * 根路径 - 返回 HTML 页面
 */
app.get('*', (req, res) => {
    const htmlPath = path.resolve(__dirname, './static/index.html');

    if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath).toString();
        res.header('Content-Type', 'text/html;charset=utf-8');
        res.send(content);
    } else {
        res.json({
            service: '飞书抽奖助手 FaaS 服务',
            version: '1.0.0',
            endpoints: {
                health: 'GET /v1/ping',
                event: 'POST /api/lottery/event',
                manual: 'POST /api/lottery/manual',
                config: 'GET /api/config'
            }
        });
    }
});

// ==================== 启动服务器 ====================

if (require.main === module) {
    app
        .listen(config.port, config.host, () => {
            console.log(`
╔═══════════════════════════════════════════════════════╗
║   飞书抽奖助手 FaaS 服务已启动                          ║
╠═══════════════════════════════════════════════════════╣
║   端口: ${config.port.toString().padEnd(46)}║
║   地址: http://${config.host}:${config.port}${' '.repeat(26)}║
║                                                       ║
║   API 端点:                                           ║
║   - GET  /v1/ping              健康检查               ║
║   - POST /api/lottery/event    飞书事件回调           ║
║   - POST /api/lottery/manual   手动触发抽奖           ║
║   - GET  /api/config           配置信息               ║
╚═══════════════════════════════════════════════════════╝
            `);
        })
        .on('error', (e) => {
            console.error('服务启动失败:', e.code, e.message);
            process.exit(1);
        });
}

// ==================== 导出模块 ====================

module.exports = {
    app,
    lotteryDrawHandler,
    config,

    // 导出辅助函数供测试使用
    utils: {
        Timer,
        Result,
        asyncTry,
        parseMessageContent,
        hasLotteryKeyword,
        extractUserIds,
        selectRandomWinner,
        buildWinnerMessage,
        validateAndExtractMessage,
        validateMessageContent,
        InMemoryRedis
    }
};
