# 飞书抽奖助手 (Feishu Lottery Bot)

基于 Vercel Serverless Functions 的飞书消息抽奖助手，支持**点赞抽奖**和**时间区间抽奖**。

## ✨ 核心特性

- **两种模式**：
  - 👍 **点赞模式**：从消息的点赞用户中随机抽取。
  - ⏱️ **区间模式**：从一段时间内的群聊发言用户中抽取。
- **权限控制**：只有消息发布人（楼主）才能触发开奖。
- **自动防重**：自动排除历史中奖用户。
- **数据持久化**：支持 Neon Postgres 存储抽奖记录与统计分析。

## 🚀 快速部署

### 1. 准备工作
- 注册 [飞书开放平台](https://open.feishu.cn/) 账号，创建"企业自建应用"。
  - 获取 `App ID` 和 `App Secret`。
  - 开启 `机器人` 能力。
  - 权限管理添加：`im:message` (获取与发送消息), `im:message.reaction` (获取表情回复)。

### 2. 部署到 Vercel
推荐使用 Vercel CLI 或 Dashboard 部署。

1. **导入项目** 到 Vercel。
2. **配置环境变量**：
   | 变量名 | 说明 |
   |--------|------|
   | `FEISHU_APP_ID` | 飞书应用 App ID |
   | `FEISHU_APP_SECRET` | 飞书应用 App Secret |
   | `DATABASE_URL` | (可选) Neon 数据库连接串，用于持久化存储 |
3. **部署** 完成后，获得分配的域名（例如 `https://your-app.vercel.app`）。

### 3. 配置飞书回调
1. 回到飞书开放平台应用详情。
2. **事件订阅** -> **配置请求网址**：填写 `https://your-app.vercel.app/api/lottery-event`。
3. 添加事件：`im.message.receive_v1` (接收消息)。
4. **版本管理与发布**：创建版本并发布。

## 📖 使用指南

### 点赞抽奖 (传统模式)
1. 在群里发一条消息（作为抽奖贴）。
2. 让大家点赞该消息。
3. **在原消息下回复**：`@机器人 开奖`。
4. 机器人将从点赞用户中随机抽取一位。

### 区间抽奖 (活跃度模式)
1. 确定一个起始消息（可以是任何旧消息）。
2. 此时群内大家正常聊天。
3. **在起始消息下回复**：`@机器人 区间开奖`。
4. 机器人将抽取从“起始消息”到“开奖指令”这期间发言的用户。

### 📸 效果演示

**1. 普通群使用示例**
![普通群使用示例](https://lf3-static.bytednsdoc.com/obj/eden-cn/logpfvhog/feishu/chat.png)

**2. 话题群使用示例**
![话题群使用示例](https://lf3-static.bytednsdoc.com/obj/eden-cn/logpfvhog/feishu/topic.png)

## 🛠️ 本地开发

```bash
# 安装依赖
npm install

# 启动本地开发服务器
npm run dev
```

API 调试地址：`http://localhost:3000/api`

## 📄 许可证
MIT License
