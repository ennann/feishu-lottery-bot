-- 飞书抽奖助手数据库表结构
-- 用于 Neon Postgres 数据库

-- 抽奖记录表
CREATE TABLE IF NOT EXISTS lottery_draws (
    id SERIAL PRIMARY KEY,
    root_message_id VARCHAR(255) NOT NULL UNIQUE,
    winner_id VARCHAR(255) NOT NULL,
    participant_count INTEGER NOT NULL,
    chat_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255),
    lottery_message_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 索引
    CONSTRAINT lottery_draws_root_message_id_key UNIQUE (root_message_id)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_lottery_draws_root_message_id ON lottery_draws(root_message_id);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_chat_id ON lottery_draws(chat_id);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_created_at ON lottery_draws(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_winner_id ON lottery_draws(winner_id);

-- 添加注释
COMMENT ON TABLE lottery_draws IS '飞书抽奖记录表';
COMMENT ON COLUMN lottery_draws.id IS '主键ID';
COMMENT ON COLUMN lottery_draws.root_message_id IS '根消息ID（原消息的飞书消息ID）';
COMMENT ON COLUMN lottery_draws.winner_id IS '中奖用户OpenID';
COMMENT ON COLUMN lottery_draws.participant_count IS '参与抽奖的人数';
COMMENT ON COLUMN lottery_draws.chat_id IS '群聊ID';
COMMENT ON COLUMN lottery_draws.sender_id IS '触发开奖的用户OpenID';
COMMENT ON COLUMN lottery_draws.lottery_message_id IS '抽奖通知消息ID';
COMMENT ON COLUMN lottery_draws.created_at IS '抽奖时间';
