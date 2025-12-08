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
 * 兼容两种格式：
 * 1. 新格式: { schema: "2.0", header: {...}, event: { message: {...} } }
 * 2. 旧格式: { event: { header: {...}, event: { message: {...} } } }
 */
const isValidMessageEvent = (params) =>
    params?.event?.message != null || params?.event?.event?.message != null;

/**
 * 解析消息内容，提取纯文本（去除 @mentions）
 */
const parseMessageContent = (messageContent) => {
    try {
        const parsedContent = JSON.parse(messageContent);
        const text = parsedContent.text || '';

        // 去除所有 @mentions 部分
        // 使用通用正则匹配所有 @_ 开头的提及格式 (如 @_user_1、@_all、@_group_1 等)
        const cleanText = text
            .replace(/@_\w+\s*/g, '')  // 去除所有 @_ 开头的提及
            .trim();

        return Result.Ok({ ...parsedContent, text: cleanText, originalText: text });
    } catch (error) {
        return Result.Err(new Error('消息内容解析失败'));
    }
};

/**
 * 检查消息是否@了机器人
 */
const isBotMentioned = (message) => {
    // 检查 mentions 数组是否存在且不为空
    if (!message.mentions || !Array.isArray(message.mentions) || message.mentions.length === 0) {
        return false;
    }

    // 检查 mentions 中是否包含有效的 mention
    const hasMention = message.mentions.some(mention => {
        return mention && mention.key && mention.id;
    });

    return hasMention;
};

/**
 * 检查消息是否包含开奖关键词
 * 兼容两种模式：like（点赞模式）和 range（区间模式）
 */
const hasLotteryKeyword = (parsedContent) => {
    const text = parsedContent?.text || '';
    return text.includes('开奖') || text.includes('抽奖') || text.includes('区间开奖') || text.includes('区间抽奖');
};

/**
 * 检查消息是否为抽奖触发关键词（精确匹配）
 * @returns {Object} { isLottery: boolean, type: 'like' | 'range' | null }
 *   - like: 基于点赞的抽奖（开奖、抽奖）
 *   - range: 基于时间区间的抽奖（区间开奖、区间抽奖）
 */
const isLotteryTrigger = (text) => {
    const likeLotteryKeywords = ['开奖', '抽奖'];
    const rangeLotteryKeywords = ['区间开奖', '区间抽奖'];

    if (likeLotteryKeywords.includes(text)) {
        return { isLottery: true, type: 'like' };
    }
    if (rangeLotteryKeywords.includes(text)) {
        return { isLottery: true, type: 'range' };
    }
    return { isLottery: false, type: null };
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

// ==================== 网络请求重试机制 ====================

/**
 * 带重试的网络请求包装器
 */
const retryAsync = async (fn, logger, maxRetries = 3, retryDelay = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            logger.warn(`请求失败，第 ${i + 1}/${maxRetries} 次重试: ${error.message}`);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
            }
        }
    }
    throw lastError;
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
const saveLotteryRecord = async (redis, rootMessageId, winnerId, participantCount, chatId, senderId, lotteryMessageId, tenantKey) => {
    const key = getLotteryKey(rootMessageId);
    const record = {
        winnerId,
        participantCount,
        chatId,
        senderId,
        lotteryMessageId,
        tenantKey,
        timestamp: Date.now()
    };
    await redis.set(key, JSON.stringify(record));
    return record;
};

/**
 * 获取消息的创建时间
 */
const getMessageCreateTime = async (client, messageId, logger) => {
    try {
        const result = await retryAsync(async () => {
            return await client.im.v1.message.get({
                path: { message_id: messageId },
                params: { user_id_type: 'open_id' }
            });
        }, logger);

        const createTime = result.data?.items?.[0]?.create_time;
        if (!createTime) {
            logger.error(`无法获取消息 ${messageId} 的创建时间`);
            return Result.Err(new Error('无法获取消息创建时间'));
        }

        logger.info(`消息 ${messageId} 的创建时间: ${createTime}`);
        return Result.Ok(createTime);
    } catch (e) {
        logger.error('获取消息创建时间失败', e);
        return Result.Err(new Error('获取消息创建时间失败'));
    }
};

/**
 * 获取根消息信息（包括发布人ID）
 */
const getRootMessageInfo = async (client, messageId, logger) => {
    try {
        const result = await retryAsync(async () => {
            return await client.im.v1.message.get({
                path: { message_id: messageId },
                params: { user_id_type: 'open_id' }
            });
        }, logger);

        const messageData = result.data?.items?.[0];
        if (!messageData) {
            logger.error(`无法获取消息 ${messageId} 的信息`);
            return Result.Err(new Error('无法获取根消息信息'));
        }

        const senderId = messageData.sender?.id;
        if (!senderId) {
            logger.error(`消息 ${messageId} 没有有效的发布人ID`);
            return Result.Err(new Error('无法获取根消息发布人'));
        }

        logger.info(`根消息 ${messageId} 的发布人: ${senderId}`);
        return Result.Ok(senderId);
    } catch (e) {
        logger.error('获取根消息信息失败', e);
        return Result.Err(new Error('获取根消息信息失败'));
    }
};

/**
 * 查询该根消息的历史中奖用户列表
 */
const getHistoryWinners = async (redis, rootMessageId, logger) => {
    try {
        // 从 Neon 数据库查询该根消息的所有历史记录
        if (redis.getDrawsByRootMessageId) {
            const records = await redis.getDrawsByRootMessageId(rootMessageId);
            const winnerIds = records.map(record => record.winner_id).filter(id => id);
            logger.info(`从数据库查询到 ${records.length} 条抽奖记录，${winnerIds.length} 个历史中奖用户`);
            return winnerIds;
        }
        
        // 如果使用内存存储，只能查询当前记录
        const key = getLotteryKey(rootMessageId);
        const record = await redis.get(key);
        if (record) {
            const data = JSON.parse(record);
            return [data.winnerId];
        }
        return [];
    } catch (e) {
        logger.error('查询历史中奖记录失败', e);
        // 查询失败不影响抽奖流程，返回空数组
        return [];
    }
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
 * 收集点赞用户列表（边迭代边去重）
 */
const collectLikeUsers = async (client, rootMessageId, logger) => {
    const userIdSet = new Set();
    let pageCount = 0;
    let reactionCount = 0;

    try {
        await retryAsync(async () => {
            for await (const page of await client.im.v1.messageReaction.listWithIterator({
                path: { message_id: rootMessageId }
            })) {
                pageCount++;
                if (page.items && Array.isArray(page.items)) {
                    page.items.forEach((reaction) => {
                        reactionCount++; // 统计所有点赞次数
                        if (reaction.operator?.operator_type === 'user' && reaction.operator?.operator_id) {
                            userIdSet.add(reaction.operator.operator_id);
                        }
                    });
                }
            }
        }, logger);

        logger.info(`获取到 ${pageCount} 页点赞记录，共 ${reactionCount} 个点赞，去重后共有 ${userIdSet.size} 位用户点赞`);
        return Result.Ok({ users: Array.from(userIdSet), reactionCount });
    } catch (e) {
        logger.error('获取点赞信息失败', e);
        return Result.Err(new Error('获取点赞信息失败'));
    }
};

/**
 * 收集时间区间内发言的用户列表（边迭代边去重）
 * @param {Object} client - 飞书客户端
 * @param {string} chatId - 群聊ID
 * @param {string} startTime - 开始时间(秒级时间戳)
 * @param {string} endTime - 结束时间(秒级时间戳)
 * @param {string} rootMessageId - 根消息ID(需要排除)
 * @param {string} triggerMessageId - 触发开奖的消息ID(需要排除)
 * @param {Object} logger - 日志对象
 */
const collectRangeUsers = async (client, chatId, startTime, endTime, rootMessageId, triggerMessageId, logger) => {
    const userIdSet = new Set();
    let pageCount = 0;
    let messageCount = 0;
    let excludedCount = 0;
    let replyMessageCount = 0; // 统计回复消息数量

    try {
        await retryAsync(async () => {
            for await (const page of await client.im.v1.message.listWithIterator({
                params: {
                    container_id_type: 'chat',
                    container_id: chatId,
                    start_time: startTime,
                    end_time: endTime,
                    sort_type: 'ByCreateTimeAsc',
                    page_size: 50
                }
            })) {
                pageCount++;
                if (page.items && Array.isArray(page.items)) {
                    page.items.forEach((message) => {
                        messageCount++;

                        // 排除根消息和触发消息
                        if (message.message_id === rootMessageId || message.message_id === triggerMessageId) {
                            excludedCount++;
                            logger.info(`排除消息: ${message.message_id} (${message.message_id === rootMessageId ? '根消息' : '触发消息'})`);
                            return;
                        }

                        // 排除回复消息（有 root_id 的消息）
                        if (message.root_id && message.root_id.trim() !== '') {
                            replyMessageCount++;
                            return;
                        }

                        // 过滤条件：
                        // 1. sender 存在
                        // 2. sender_type 为 user
                        // 3. sender.id 有效（非空、非 undefined）
                        // 4. 消息未被删除
                        if (
                            message.sender &&
                            message.sender.sender_type === 'user' &&
                            message.sender.id &&
                            message.sender.id.trim() !== '' &&
                            !message.deleted
                        ) {
                            userIdSet.add(message.sender.id);
                        }
                    });
                }
            }
        }, logger);

        const validMessageCount = messageCount - excludedCount - replyMessageCount;
        logger.info(
            `获取到 ${pageCount} 页消息记录，共 ${messageCount} 条消息，` +
            `排除 ${excludedCount} 条(根消息+触发消息)，` +
            `排除 ${replyMessageCount} 条(回复消息)，` +
            `有效消息 ${validMessageCount} 条，去重后共有 ${userIdSet.size} 位用户发言`
        );
        return Result.Ok({ users: Array.from(userIdSet), validMessageCount });
    } catch (e) {
        logger.error('获取时间区间内消息失败', e);
        return Result.Err(new Error('获取时间区间内消息失败'));
    }
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
 * 随机抽取中奖用户（排除历史中奖用户）
 * @param {Array<string>} participants - 参与者ID列表
 * @param {Array<string>} historyWinners - 历史中奖用户ID列表
 * @param {Object} logger - 日志对象
 */
const selectWinner = (participants, historyWinners, logger) => {
    if (!participants || participants.length === 0) {
        return Result.Err(new Error('没有参与抽奖的用户'));
    }

    // 过滤掉历史中奖用户
    const availableParticipants = participants.filter(userId => !historyWinners.includes(userId));

    logger.info(`总参与人数: ${participants.length}，历史中奖: ${historyWinners.length}，可抽奖人数: ${availableParticipants.length}`);

    if (availableParticipants.length === 0) {
        return Result.Err(new Error('所有参与用户都已中过奖，无可抽奖用户'));
    }

    const randomIndex = Math.floor(Math.random() * availableParticipants.length);
    const winnerId = availableParticipants[randomIndex];

    logger.info(`从 ${availableParticipants.length} 位用户中抽中: ${winnerId}`);
    return Result.Ok({ winnerId, participantCount: participants.length });
};

// ==================== 消息构建函数 ====================

/**
 * 构建中奖消息内容（纯函数）
 * @param {string} winnerId - 中奖用户ID
 * @param {number} participantCount - 参与人数
 * @param {Object} options - 可选参数
 * @param {string} options.lotteryType - 抽奖类型 'like' | 'range'
 * @param {string} options.startTimeStr - 开始时间字符串（仅区间抽奖）
 * @param {string} options.endTimeStr - 结束时间字符串（仅区间抽奖）
 * @param {number} options.statisticCount - 统计数据（点赞数或消息数）
 */
const buildWinnerMessage = (winnerId, participantCount = 0, options = {}) => {
    const { lotteryType, startTimeStr, endTimeStr, statisticCount } = options;

    // 构建参与信息文本 - 中文
    let participantInfoZh = `参与人数：${participantCount} 人`;
    if (lotteryType === 'like' && statisticCount !== undefined) {
        participantInfoZh += `\n点赞数量：${statisticCount} 个`;
    } else if (lotteryType === 'range' && statisticCount !== undefined) {
        participantInfoZh += `\n消息数量：${statisticCount} 条`;
    }
    if (lotteryType === 'range' && startTimeStr && endTimeStr) {
        participantInfoZh += `\n时间范围：${startTimeStr} ~ ${endTimeStr}`;
    }

    // 构建参与信息文本 - 英文
    let participantInfoEn = `Participants: ${participantCount}`;
    if (lotteryType === 'like' && statisticCount !== undefined) {
        participantInfoEn += `\nReactions: ${statisticCount}`;
    } else if (lotteryType === 'range' && statisticCount !== undefined) {
        participantInfoEn += `\nMessages: ${statisticCount}`;
    }
    if (lotteryType === 'range' && startTimeStr && endTimeStr) {
        participantInfoEn += `\nTime Range: ${startTimeStr} ~ ${endTimeStr}`;
    }

    return {
        content: JSON.stringify({
            config: {
                update_multi: true
            },
            i18n_elements: {
                zh_cn: [
                    {
                        tag: 'markdown',
                        content: `**:PARTY: 恭喜<at id=${winnerId}></at> 抽得本次大奖！**`,
                        text_align: 'left',
                        text_size: 'heading'
                    },
                    {
                        tag: 'markdown',
                        content: participantInfoZh,
                        text_align: 'left',
                        text_size: 'normal'
                    },
                    {
                        tag: 'note',
                        elements: [
                            {
                                tag: 'plain_text',
                                content: '请联系消息发布人，及时领取您的奖品～'
                            }
                        ]
                    }
                ],
                en_us: [
                    {
                        tag: 'markdown',
                        content: `**:PARTY: Congratulations <at id=${winnerId}></at> won the prize!**`,
                        text_align: 'left',
                        text_size: 'heading'
                    },
                    {
                        tag: 'markdown',
                        content: participantInfoEn,
                        text_align: 'left',
                        text_size: 'normal'
                    },
                    {
                        tag: 'note',
                        elements: [
                            {
                                tag: 'plain_text',
                                content: 'Please contact the message publisher to claim your prize~'
                            }
                        ]
                    }
                ]
            },
            i18n_header: {}
        }),
        msg_type: 'interactive'
    };
};

/**
 * 发送权限不足提示消息
 */
const sendPermissionDeniedMessage = async (client, messageId, logger) => {
    try {
        const messageData = {
            content: JSON.stringify({
                schema: '2.0',
                config: {
                    update_multi: true
                },
                body: {
                    direction: 'vertical',
                    padding: '12px 12px 12px 12px',
                    elements: [
                        {
                            tag: 'div',
                            text: {
                                tag: 'plain_text',
                                content: '只有消息发布人才能触发抽奖',
                                text_size: 'notation',
                                text_align: 'left',
                                text_color: 'grey'
                            }
                        }
                    ]
                }
            }),
            msg_type: 'interactive'
        };

        await retryAsync(async () => {
            const res = await client.im.v1.message.reply({
                path: { message_id: messageId },
                data: messageData
            });
            logger.info('权限提示消息发送成功');
        }, logger);
        return Result.Ok(true);
    } catch (e) {
        logger.error('发送权限提示消息失败', e.message);
        // 发送失败不影响主流程
        return Result.Err(new Error('发送权限提示失败'));
    }
};

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

    // 兼容两种格式
    const message = params.event.message || params.event.event.message;
    const sender = params.event.sender || params.event.event.sender;
    const { chat_id, content, root_id, message_id } = message;

    // 提取 tenantKey（从顶层或从 header 中）
    const tenantKey = params.tenantKey || params.header?.tenant_key || params.event?.header?.tenant_key || '';

    return Result.Ok({
        chatId: chat_id,
        messageContent: content,
        rootMessageId: root_id,
        messageId: message_id,
        senderId: sender?.sender_id?.open_id || '',
        tenantKey: tenantKey
    });
};

/**
 * 步骤 2: 验证消息内容（包含@机器人检测、关键词识别和权限校验）
 */
const validateMessageContent = async (messageInfo, params, client, logger) => {
    // 检查是否@了机器人
    const message = params.event.message || params.event.event.message;
    if (!isBotMentioned(message)) {
        logger.info('消息未@机器人，不触发抽奖');
        return Result.Err(new Error('消息未@机器人'));
    }
    logger.info('✓ 消息已@机器人');

    // 解析消息内容
    const parseResult = parseMessageContent(messageInfo.messageContent);
    if (Result.isErr(parseResult)) {
        logger.error('消息内容解析失败', messageInfo.messageContent);
        return parseResult;
    }

    const parsedContent = parseResult.value;
    logger.info(`解析消息内容: 原始="${parsedContent.originalText}", 清理后="${parsedContent.text}"`);

    // 检查是否为抽奖触发关键词（精确匹配）
    const triggerResult = isLotteryTrigger(parsedContent.text);
    if (!triggerResult.isLottery) {
        logger.info(`消息内容 "${parsedContent.text}" 不是抽奖触发关键词，无需处理`);
        return Result.Err(new Error('消息不是抽奖触发关键词'));
    }
    logger.info(`✓ 检测到抽奖触发关键词: ${parsedContent.text}，类型: ${triggerResult.type}`);

    // 检查是否有根消息ID
    if (!messageInfo.rootMessageId) {
        logger.info('没有 root_id，无法进行抽奖');
        return Result.Err(new Error('没有根消息ID'));
    }

    // 校验触发者权限：只有根消息发布人才能触发抽奖
    const rootSenderResult = await getRootMessageInfo(client, messageInfo.rootMessageId, logger);
    if (Result.isErr(rootSenderResult)) {
        return rootSenderResult;
    }

    const rootSenderId = rootSenderResult.value;
    if (messageInfo.senderId !== rootSenderId) {
        logger.info(`触发者 ${messageInfo.senderId} 不是根消息发布人 ${rootSenderId}，无权开奖`);
        // 发送提示消息
        await sendPermissionDeniedMessage(client, messageInfo.messageId, logger);
        return Result.Err(new Error('只有消息发布人才能触发抽奖'));
    }

    logger.info(`✓ 权限校验通过，触发者 ${messageInfo.senderId} 是根消息发布人`);
    logger.info(`✓ 消息验证通过，准备开始抽奖流程`);
    
    return Result.Ok({ ...messageInfo, parsedContent, lotteryType: triggerResult.type });
};

/**
 * 步骤 3: 获取历史中奖记录
 */
const fetchHistoryWinners = async (redis, messageInfo, logger) => {
    logger.info(`[步骤1/6] 查询历史中奖记录...`);
    const historyWinners = await getHistoryWinners(redis, messageInfo.rootMessageId, logger);
    logger.info(`该根消息已有 ${historyWinners.length} 次抽奖记录，历史中奖用户: ${JSON.stringify(historyWinners)}`);
    return Result.Ok({ ...messageInfo, historyWinners });
};

/**
 * 步骤 4: 获取参与者列表（根据抽奖类型）
 */
const getParticipants = async (client, params, messageInfo, logger) => {
    try {
        logger.info(`[步骤2/6] 获取参与者列表，抽奖类型: ${messageInfo.lotteryType}...`);
        
        let collectResult;
        let startTimeStr, endTimeStr;
        let statisticCount;

        if (messageInfo.lotteryType === 'like') {
            // 基于点赞的抽奖
            logger.info('使用点赞模式收集参与用户');
            collectResult = await collectLikeUsers(client, messageInfo.rootMessageId, logger);
            if (Result.isOk(collectResult)) {
                statisticCount = collectResult.value.reactionCount;
            }
        } else if (messageInfo.lotteryType === 'range') {
            // 基于时间区间的抽奖
            logger.info('使用时间区间模式收集参与用户');

            // 获取根消息的创建时间
            const rootTimeResult = await getMessageCreateTime(client, messageInfo.rootMessageId, logger);
            if (Result.isErr(rootTimeResult)) {
                return rootTimeResult;
            }

            // 当前消息的创建时间从 params 中获取
            const message = params.event.message || params.event.event.message;
            const currentMessageTime = message.create_time;

            // 转换时间格式：毫秒时间戳转为秒（飞书 API 需要秒级时间戳）
            const startTime = Math.floor(parseInt(rootTimeResult.value) / 1000).toString();
            const endTime = Math.floor(parseInt(currentMessageTime) / 1000).toString();

            // 使用时间格式化（简单实现，避免依赖 dayjs）
            const formatTime = (timestamp) => {
                const date = new Date(parseInt(timestamp));
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hour = String(date.getHours()).padStart(2, '0');
                const minute = String(date.getMinutes()).padStart(2, '0');
                return `${year}-${month}-${day} ${hour}:${minute}`;
            };

            startTimeStr = formatTime(rootTimeResult.value);
            endTimeStr = formatTime(currentMessageTime);

            logger.info(`时间区间: ${startTime} (${startTimeStr}) - ${endTime} (${endTimeStr})`);

            collectResult = await collectRangeUsers(
                client,
                messageInfo.chatId,
                startTime,
                endTime,
                messageInfo.rootMessageId,
                messageInfo.messageId,
                logger
            );
            if (Result.isOk(collectResult)) {
                statisticCount = collectResult.value.validMessageCount;
            }
        }

        if (Result.isErr(collectResult)) {
            return collectResult;
        }

        const participants = collectResult.value.users;

        if (participants.length === 0) {
            logger.warn('没有用户参与，无法进行抽奖');
            return Result.Err(new Error('没有参与抽奖的用户'));
        }

        logger.info(`✓ 去重后共有 ${participants.length} 位用户参与抽奖`);
        
        return Result.Ok({ 
            ...messageInfo, 
            participants,
            startTimeStr,
            endTimeStr,
            statisticCount
        });
    } catch (error) {
        logger.error('获取参与者列表失败', error);
        return Result.Err(new Error('获取参与者列表失败'));
    }
};

/**
 * 步骤 5: 抽取中奖用户（排除历史中奖用户）
 */
const drawWinner = (lotteryData, logger) => {
    logger.info(`[步骤3/6] 开始随机抽取中奖用户...`);
    logger.info(`抽奖池: ${lotteryData.participants.length} 位用户，历史中奖: ${lotteryData.historyWinners.length} 位`);

    const winnerResult = selectWinner(lotteryData.participants, lotteryData.historyWinners, logger);
    
    if (Result.isErr(winnerResult)) {
        return winnerResult;
    }

    logger.info(`🎉 中奖用户已选出: ${winnerResult.value.winnerId}`);
    return Result.Ok({ ...lotteryData, ...winnerResult.value });
};

/**
 * 步骤 6: 发送中奖通知
 */
const notifyWinner = async (client, logger, winnerData) => {
    try {
        logger.info(`[步骤4/6] 发送中奖通知到飞书...`);
        logger.info(`通知消息ID: ${winnerData.messageId}`);

        const messageData = buildWinnerMessage(
            winnerData.winnerId,
            winnerData.participantCount,
            {
                lotteryType: winnerData.lotteryType,
                startTimeStr: winnerData.startTimeStr,
                endTimeStr: winnerData.endTimeStr,
                statisticCount: winnerData.statisticCount
            }
        );
        
        const response = await retryAsync(async () => {
            return await sendReplyMessage(client, winnerData.messageId, messageData);
        }, logger);

        // 获取发送后的消息ID
        const lotteryMessageId = response?.data?.message_id || '';
        logger.info(`✓ 中奖消息发送成功，消息ID: ${lotteryMessageId}`);

        return Result.Ok({ ...winnerData, lotteryMessageId });
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
        logger.info(`[步骤5/6] 保存开奖记录...`);

        await saveLotteryRecord(
            redis,
            winnerData.rootMessageId,
            winnerData.winnerId,
            winnerData.participantCount,
            winnerData.chatId,
            winnerData.senderId,
            winnerData.lotteryMessageId,
            winnerData.tenantKey
        );

        logger.info(`✓ 开奖记录已保存: ${getLotteryKey(winnerData.rootMessageId)}`);
        logger.info(`记录详情: 中奖用户=${winnerData.winnerId}, 参与人数=${winnerData.participantCount}, 群聊=${winnerData.chatId}, 触发人=${winnerData.senderId}, 租户=${winnerData.tenantKey || '(无)'}`);
        return Result.Ok(winnerData);
    } catch (error) {
        logger.error('⚠️ 数据库写入失败', error);
        // 数据库写入失败不影响抽奖结果，但要记录错误
        return Result.Err(new Error('保存开奖记录失败'));
    }
};

// ==================== 主函数（组合所有步骤） ====================

/**
 * 抽奖主流程（函数式管道）
 */
const executeLottery = async (dependencies, params) => {
    const { client, redis, logger } = dependencies;

    // 步骤 1: 验证参数
    const messageValidation = validateAndExtractMessage(params);
    if (Result.isErr(messageValidation)) {
        return messageValidation;
    }

    // 步骤 2: 验证消息内容（包含@机器人检测、关键词识别和权限校验）
    const contentValidation = await validateMessageContent(messageValidation.value, params, client, logger);
    if (Result.isErr(contentValidation)) {
        return contentValidation;
    }

    const messageInfo = contentValidation.value;
    logger.info(`==================== 开始抽奖流程 ====================`);
    logger.info(`会话ID: ${messageInfo.chatId}`);
    logger.info(`根消息ID: ${messageInfo.rootMessageId}`);
    logger.info(`触发消息ID: ${messageInfo.messageId}`);
    logger.info(`抽奖类型: ${messageInfo.lotteryType}`);

    // 步骤 3: 获取历史中奖记录
    const historyResult = await fetchHistoryWinners(redis, messageInfo, logger);
    if (Result.isErr(historyResult)) {
        return historyResult;
    }

    // 步骤 4: 获取参与者（根据抽奖类型）
    const participantsResult = await getParticipants(client, params, historyResult.value, logger);
    if (Result.isErr(participantsResult)) {
        return participantsResult;
    }

    // 步骤 5: 抽取中奖用户（排除历史中奖用户）
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
    // 注意：即使保存失败，我们也返回成功，因为抽奖已经完成
    const finalData = Result.isOk(recordResult) ? recordResult.value : notifyResult.value;

    return Result.Ok({
        winnerId: finalData.winnerId,
        participantCount: finalData.participantCount
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
        retryAsync,
        parseMessageContent,
        hasLotteryKeyword,
        isLotteryTrigger,
        isBotMentioned,
        extractUserIds,
        selectWinner,
        buildWinnerMessage,
        validateAndExtractMessage,
        validateMessageContent,
        getRootMessageInfo,
        getHistoryWinners,
        collectLikeUsers,
        collectRangeUsers,
        sendPermissionDeniedMessage
    }
};
