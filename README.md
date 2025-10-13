# 飞书抽奖助手 - Vercel Serverless 部署版

基于函数式编程范式实现的飞书消息抽奖助手，完美适配 Vercel Serverless Functions。

## ✨ 功能特性

- 🎯 接收飞书消息事件，检测"开奖"关键词
- 👥 自动获取消息点赞用户列表
- 🎲 随机抽取中奖用户
- 📢 自动发送中奖通知
- 🔒 防止重复开奖
- ⚡ Serverless 架构，按需运行
- 🎨 函数式编程，易于测试和维护
- 📊 Neon Postgres 持久化存储，支持数据查询和分析 ⭐

## 📁 项目结构

```
.
├── api/                          # Vercel Serverless Functions
│   ├── index.js                  # 主页 API
│   ├── ping.js                   # 健康检查
│   ├── lottery-event.js          # 飞书事件回调
│   └── lottery-stats.js          # 抽奖数据统计查询 ⭐
├── lib/                          # 核心业务逻辑
│   ├── lottery-core.js           # 抽奖核心功能（函数式实现）
│   ├── storage-neon.js           # Neon Postgres 存储适配器 ⭐
│   ├── kv-redis.js               # Vercel KV 存储适配器（已弃用）
│   └── db-schema.sql             # 数据库表结构定义 ⭐
├── package.json                  # 依赖配置
├── vercel.json                   # Vercel 配置
└── README.md                     # 说明文档
```

## 🚀 快速部署到 Vercel

### 方法 1: 使用 Vercel CLI（推荐）

#### 1. 安装 Vercel CLI
```bash
npm install -g vercel
```

#### 2. 登录 Vercel
```bash
vercel login
```

#### 3. 进入项目目录
```bash
cd /path/to/EventReceiveMessage
```

#### 4. 安装依赖
```bash
npm install
```

#### 5. 配置环境变量
在项目根目录创建 `.env` 文件：
```env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx
```

#### 6. 部署到 Vercel
```bash
# 预览部署（测试环境）
npm run deploy:preview

# 生产部署
npm run deploy
```

### 方法 2: 使用 Vercel Dashboard

#### 1. 导入项目
- 访问 [Vercel Dashboard](https://vercel.com/dashboard)
- 点击 "Add New..." → "Project"
- 导入你的 Git 仓库

#### 2. 配置项目
- **Framework Preset**: 选择 "Other"
- **Root Directory**: 设置为项目根目录
- **Build Command**: 留空（无需构建）
- **Output Directory**: 留空

#### 3. 配置环境变量
在 Vercel 项目设置中添加以下环境变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `FEISHU_APP_ID` | 飞书应用 ID | `cli_xxxxxxxxxx` |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | `xxxxxxxxxx` |

#### 4. 配置 Neon Postgres（持久化存储）⭐
为了防止重复开奖并支持数据分析，需要配置持久化存储：

1. 在 Vercel 项目页面，点击 "Storage" 标签
2. 点击 "Create Database" → 选择 "Neon (Postgres)"
3. 填写数据库名称（如 `feishu-lottery-db`）
4. 点击 "Create"
5. Vercel 会自动添加环境变量：
   - `DATABASE_URL` - Neon 数据库连接字符串
   - `POSTGRES_URL`, `POSTGRES_PRISMA_URL` 等（可选）

**数据库表会自动创建**：首次运行时会自动创建 `lottery_draws` 表及索引。

**注意**：如果不配置数据库，系统会自动降级使用内存存储，但每次部署后抽奖记录会丢失，且无法使用数据统计功能。

#### 5. 部署
点击 "Deploy" 按钮开始部署。

## 🔧 本地开发

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```

### 3. 访问端点
- 主页: http://localhost:3000/api
- 健康检查: http://localhost:3000/api/ping
- 事件回调: http://localhost:3000/api/lottery-event

## 📡 API 端点

### 1. 主页信息
**请求**
```
GET /api 或 GET /
```

**响应**
```json
{
  "service": "飞书抽奖助手 Serverless 服务",
  "version": "1.0.0",
  "endpoints": { ... }
}
```

### 2. 健康检查
**请求**
```
GET /api/ping
```

**响应**
```json
{
  "status": "ok",
  "service": "飞书抽奖助手",
  "timestamp": "2025-10-13T10:30:00.000Z"
}
```

### 3. 飞书事件回调
**请求**
```
POST /api/lottery-event
Content-Type: application/json

{
  "type": "event_callback",
  "event": {
    "event": {
      "message": {
        "chat_id": "oc_xxx",
        "content": "{\"text\":\"开奖\"}",
        "root_id": "om_xxx",
        "message_id": "om_yyy"
      }
    }
  }
}
```

**响应**
```json
{
  "code": 0,
  "message": "抽奖成功",
  "data": {
    "winnerId": "ou_xxxxx",
    "participantCount": 15
  }
}
```

### 4. 抽奖数据统计查询 ⭐
**获取所有抽奖记录（分页）**
```
GET /api/lottery-stats?action=list&limit=50&offset=0
```

**响应**
```json
{
  "code": 0,
  "message": "查询成功",
  "data": {
    "draws": [
      {
        "id": 1,
        "root_message_id": "om_xxx",
        "winner_id": "ou_xxx",
        "participant_count": 15,
        "chat_id": "oc_xxx",
        "sender_id": "ou_yyy",
        "lottery_message_id": "om_zzz",
        "created_at": "2025-10-13T10:30:00.000Z"
      }
    ],
    "count": 50,
    "limit": 50,
    "offset": 0
  }
}
```

**按群聊查询抽奖记录**
```
GET /api/lottery-stats?action=chat&chatId=oc_xxx&limit=20
```

**获取统计数据**
```
GET /api/lottery-stats?action=stats
```

**响应**
```json
{
  "code": 0,
  "message": "查询成功",
  "data": {
    "totalDraws": 100,
    "totalChats": 10,
    "uniqueWinners": 50,
    "totalParticipants": 1500,
    "avgParticipants": 15.0
  }
}
```

**注意**：数据统计查询功能需要配置 Neon Postgres 数据库，使用内存存储时无法使用此功能。

## 🔐 飞书开放平台配置

### 1. 创建飞书应用
1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 App ID 和 App Secret

### 2. 配置权限
在"权限管理"中添加以下权限：
- `im:message` - 获取与发送单聊、群组消息
- `im:message.reaction` - 获取消息的表情回复

### 3. 配置事件订阅
1. 在"事件订阅"中配置请求网址：
   ```
   https://your-vercel-domain.vercel.app/api/lottery-event
   ```
2. 订阅事件：
   - `im.message.receive_v1` - 接收消息

### 4. 发布应用
在"版本管理与发布"中发布应用到企业。

## 🎯 使用方法

### 1. 在飞书群聊中发送消息
任意群成员发送一条消息（建议包含抽奖详情）

### 2. 其他成员点赞
其他群成员给该消息点赞表示参与抽奖

### 3. 触发开奖
在该消息下回复包含"开奖"关键词的消息：
```
开奖
```

### 4. 查看结果
机器人会自动回复中奖用户信息

## ⚙️ 环境变量说明

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用的 App ID，从飞书开放平台获取 |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用的 App Secret，从飞书开放平台获取 |

**注意**：SDK 会自动使用 App ID 和 App Secret 获取和管理 tenant_access_token，无需手动配置。

## 📊 监控与日志

### Vercel Dashboard
- 访问 [Vercel Dashboard](https://vercel.com/dashboard)
- 选择你的项目
- 查看"Deployments"和"Functions"标签

### 实时日志
```bash
vercel logs --follow
```

## 🔍 故障排查

### 1. 部署失败
- 检查 `package.json` 依赖是否正确
- 确认 Node.js 版本 >= 18.0.0
- 查看 Vercel 构建日志

### 2. 事件回调失败
- 验证环境变量是否正确配置
- 检查飞书应用权限
- 查看 Vercel Functions 日志

### 3. 抽奖不生效
- 确认消息是回复在原消息下（有 `root_id`）
- 检查消息内容是否包含"开奖"关键词
- 确认原消息有点赞记录

## 🎨 技术特点

### 函数式编程范式
- 纯函数设计，无副作用
- Result 类型（Either Monad）错误处理
- 不可变数据结构
- 函数组合与管道

### Serverless 架构优势
- ✅ 按需付费，成本低
- ✅ 自动扩缩容
- ✅ 全球 CDN 加速
- ✅ 零运维成本

## 💾 持久化存储

### Neon Postgres（推荐）⭐

项目默认集成 Neon Postgres 数据库进行持久化存储，用于记录开奖信息防止重复开奖，并支持数据查询和分析。

**免费额度**：
- 存储空间：0.5 GB
- 计算时间：191.9 小时/月
- 足够小型应用使用

**存储的数据**：
- 抽奖记录表 `lottery_draws`
- 字段：
  - `root_message_id`: 原消息ID（用于防重）
  - `winner_id`: 中奖用户OpenID
  - `participant_count`: 参与人数
  - `chat_id`: 群聊ID
  - `sender_id`: 触发开奖的用户OpenID
  - `lottery_message_id`: 中奖通知消息ID
  - `created_at`: 抽奖时间

**数据分析功能**：
- 查询所有抽奖记录（支持分页）
- 按群聊 ID 查询抽奖记录
- 统计总抽奖次数、参与人数、中奖用户数等

**自动降级**：
如果未配置 Neon 数据库，系统会自动使用内存存储（数据不持久化），但不影响基本功能。

## 📝 注意事项

1. **持久化存储**: 强烈建议配置 Neon Postgres 数据库以持久化抽奖记录，否则每次部署后数据会丢失
2. **冷启动**: Serverless Functions 可能存在冷启动延迟（首次请求较慢）
3. **超时限制**: Vercel 免费版函数超时时间为 10 秒，Pro 版为 60 秒
4. **并发限制**: 注意 Vercel 的并发请求限制
5. **数据库自动初始化**: 首次运行时会自动创建数据库表，无需手动执行 SQL

## 🔗 相关链接

- [Vercel 文档](https://vercel.com/docs)
- [飞书开放平台](https://open.feishu.cn/document)
- [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
- [Neon Postgres](https://neon.tech/)
- [@neondatabase/serverless](https://www.npmjs.com/package/@neondatabase/serverless)

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

Made with ❤️ using Vercel Serverless Functions
