/**
 * 飞书抽奖助手核心逻辑
 * 函数式编程范式实现
 *
 * 此模块包含所有核心业务逻辑，可被多个 Serverless Functions 复用
 */

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
const createLarkClientConfig = (appId, appSecret) => ({
    appId,
    appSecret,
    disableTokenCache: false,
    loggerLevel: lark.LoggerLevel.info
});

/**
 * 初始化飞书客户端
 */
const initLarkClient = async (getTokenFn) => {
    const { appId, appSecret } = await getTokenFn();
    const config = createLarkClientConfig(appId, appSecret);
    const client = new lark.Client(config);

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
const validateMessageContent = (messageInfo, logger) => {
    const parseResult = parseMessageContent(messageInfo.messageContent);

    if (Result.isErr(parseResult)) {
        logger.error('消息内容解析失败', messageInfo.messageContent);
        return parseResult;
    }

    const parsedContent = parseResult.value;
    logger.info(`解析消息内容: ${parsedContent.text || '(无文本)'}`);

    if (!hasLotteryKeyword(parsedContent)) {
        logger.warn('消息不包含开奖关键词', parsedContent.text);
        return Result.Err(new Error('消息不包含开奖关键词'));
    }

    if (!messageInfo.rootMessageId) {
        logger.error('没有根消息ID，无法进行抽奖');
        return Result.Err(new Error('没有根消息ID'));
    }

    logger.info(`✓ 消息验证通过，准备开始抽奖流程`);
    return Result.Ok({ ...messageInfo, parsedContent });
};

/**
 * 步骤 3: 检查是否已开奖
 */
const checkLotteryStatus = async (redis, messageInfo, logger) => {
    logger.info(`[步骤1/5] 检查开奖状态: rootMessageId=${messageInfo.rootMessageId}`);
    const hasDrawn = await checkIfDrawn(redis, messageInfo.rootMessageId);

    if (hasDrawn) {
        logger.warn(`该消息已经开过奖，无法重复开奖`);
        return Result.Err(new Error('该消息已经开过奖了'));
    }

    logger.info(`✓ 该消息未开奖，可以继续`);
    return Result.Ok(messageInfo);
};

/**
 * 步骤 4: 获取参与者列表
 */
const getParticipants = async (client, logger, messageInfo) => {
    try {
        logger.info(`[步骤2/5] 获取参与者列表...`);
        const reactionPages = await fetchReactions(client, messageInfo.rootMessageId);
        logger.info(`✓ 获取到 ${reactionPages.length} 页点赞记录`);

        const participants = extractUserIds(reactionPages);
        logger.info(`✓ 去重后共有 ${participants.length} 位用户点赞参与抽奖`);
        logger.info(`参与用户ID列表: [${participants.join(', ')}]`);

        if (participants.length === 0) {
            logger.warn('没有用户点赞，无法进行抽奖');
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
const drawWinner = (lotteryData, logger) => {
    logger.info(`[步骤3/5] 开始随机抽取中奖用户...`);
    logger.info(`抽奖池: ${lotteryData.participants.length} 位用户`);

    const winnerId = selectRandomWinner(lotteryData.participants);

    if (!winnerId) {
        logger.error('抽奖失败，未能选出中奖用户');
        return Result.Err(new Error('抽奖失败'));
    }

    logger.info(`🎉 中奖用户已选出: ${winnerId}`);
    return Result.Ok({ ...lotteryData, winnerId });
};

/**
 * 步骤 6: 发送中奖通知
 */
const notifyWinner = async (client, logger, winnerData) => {
    try {
        logger.info(`[步骤4/5] 发送中奖通知到飞书...`);
        logger.info(`通知消息ID: ${winnerData.messageId}`);

        const messageData = buildWinnerMessage(winnerData.winnerId);
        await sendReplyMessage(client, winnerData.messageId, messageData);

        logger.info('✓ 中奖消息发送成功');
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
        logger.info(`[步骤5/5] 保存开奖记录...`);

        await saveLotteryRecord(
            redis,
            winnerData.rootMessageId,
            winnerData.winnerId,
            winnerData.participants.length
        );

        logger.info(`✓ 开奖记录已保存: ${getLotteryKey(winnerData.rootMessageId)}`);
        logger.info(`记录详情: 中奖用户=${winnerData.winnerId}, 参与人数=${winnerData.participants.length}`);
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

    const contentValidation = validateMessageContent(messageValidation.value, logger);
    if (Result.isErr(contentValidation)) {
        return contentValidation;
    }

    const messageInfo = contentValidation.value;
    logger.info(`==================== 开始抽奖流程 ====================`);
    logger.info(`会话ID: ${messageInfo.chatId}`);
    logger.info(`根消息ID: ${messageInfo.rootMessageId}`);
    logger.info(`触发消息ID: ${messageInfo.messageId}`);

    // 步骤 3: 检查开奖状态
    const statusCheck = await checkLotteryStatus(redis, messageInfo, logger);
    if (Result.isErr(statusCheck)) {
        return statusCheck;
    }

    // 步骤 4: 获取参与者
    const participantsResult = await getParticipants(client, logger, statusCheck.value);
    if (Result.isErr(participantsResult)) {
        return participantsResult;
    }

    // 步骤 5: 抽取中奖用户
    const winnerResult = drawWinner(participantsResult.value, logger);
    if (Result.isErr(winnerResult)) {
        return winnerResult;
    }

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

// ==================== 导出的主函数 ====================

/**
 * 抽奖处理器主函数
 */
async function lotteryDrawHandler(params, context = {}, dependencies = null) {
    const logger = createLogger(context);
    const timer = Timer.create();

    logger.info('');
    logger.info('═══════════════════════════════════════════════');
    logger.info('【飞书抽奖助手】开始处理请求');
    logger.info('═══════════════════════════════════════════════');

    try {
        // 依赖注入（支持测试 mock）
        logger.info('初始化依赖项（Lark Client, Redis, Logger）...');
        const deps = dependencies || {
            client: await initLarkClient(context.getTokenFn),
            redis: context.redis,
            logger
        };
        logger.info('✓ 依赖项初始化完成');

        // 执行抽奖流程
        const result = await executeLottery(deps, params);

        if (Result.isErr(result)) {
            logger.error('❌ 抽奖流程失败:', result.error.message);
            return {
                code: 0,
                message: result.error.message
            };
        }

        const { winnerId, participantCount } = result.value;
        logger.info('');
        logger.info('═══════════════════════════════════════════════');
        logger.info('🎉 抽奖成功！');
        logger.info(`   中奖用户: ${winnerId}`);
        logger.info(`   参与人数: ${participantCount}`);
        logger.info('═══════════════════════════════════════════════');

        return {
            code: 0,
            message: '抽奖成功',
            data: {
                winnerId,
                participantCount
            }
        };

    } catch (error) {
        logger.error('❌ 函数执行异常:', error);
        logger.error('错误堆栈:', error.stack);
        return {
            code: -1,
            message: `函数执行失败: ${error.message}`
        };
    } finally {
        const endedTimer = Timer.end(timer);
        logger.info('');
        logger.info(`⏱️  执行时间: ${Timer.duration(endedTimer)}ms`);
        logger.info('【飞书抽奖助手】请求处理完成');
        logger.info('');
    }
}

// ==================== 内存 Redis 实现 ====================

/**
 * 简单的内存 Redis 实现（用于 Serverless 环境）
 */
class InMemoryRedis {
    constructor() {
        this.store = new Map();
    }

    async get(key) {
        return this.store.get(key) || null;
    }

    async set(key, value) {
        this.store.set(key, value);
        return 'OK';
    }

    async del(key) {
        return this.store.delete(key);
    }
}

// ==================== 导出模块 ====================

module.exports = {
    lotteryDrawHandler,
    initLarkClient,
    createLogger,
    InMemoryRedis,

    // 导出工具函数供测试
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
        validateMessageContent
    }
};
