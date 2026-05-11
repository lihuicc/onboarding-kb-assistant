# 员工入职知识库问答助手

SAP CAP (Node.js) + Claude AI 驱动的企业内部 HR 知识库问答系统。

## 界面预览

**员工问答页 — 欢迎界面**

![HR 助手欢迎页](hr-assistant.png)

**员工问答页 — 问答效果（含引用文章与星级评分）**

![HR 助手问答效果](hr-assistant-02.png)

**知识库管理页（Fiori Elements List Report）**

![知识库管理](kb-manager.png)

## 快速启动

### 1. 安装依赖

```bash
cd onboarding-kb-assistant
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 按下方说明编辑 .env
```

`.env` 完整说明：

```env
# ── AI Provider ──────────────────────────────────────────────────────────
# 可选值：
#   anthropic     本地直连 Anthropic（默认，开发用）
#   aicore        SAP AI Core Generative AI Hub（BTP 生产）
#   orchestration SAP AI Core Orchestration Service（BTP 生产，含过滤/Grounding，推荐）
AI_PROVIDER=anthropic

# ── Anthropic 直连（AI_PROVIDER=anthropic 时使用）─────────────────────────
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
ANTHROPIC_BASE_URL=http://localhost:6655/anthropic   # 公司代理，可选
CLAUDE_MODEL=claude-sonnet-4-6                       # 可选，默认 claude-sonnet-4-6

# ── SAP AI Core（AI_PROVIDER=aicore 或 orchestration 时使用）─────────────
# SDK 优先读取 AICORE_SERVICE_KEY（JSON 字符串），其次读 VCAP_SERVICES.aicore
AICORE_SERVICE_KEY={"clientid":"...","clientsecret":"...","url":"...","serviceurls":{"AI_API_URL":"..."}}
AICORE_RESOURCE_GROUP=onboarding-kb-assistant        # AI Launchpad 中的 Resource Group 名称

# AI_PROVIDER=aicore 时额外需要：
AICORE_DEPLOYMENT_ID=d1234567890abcdef               # ML Operations → Deployments 中的 ID

# AI_PROVIDER=orchestration 时额外需要：
AICORE_ORCHESTRATION_CONFIG_ID=orch-config-xxxxx     # Generative AI Hub → Orchestration 中的 Config ID

# ── Document Grounding（AI_PROVIDER=orchestration 时可选）────────────────
# 设为 true 后，Orchestration 会在 Resource Group 下的所有 Data Repository 中做向量检索
# 同时启用文章变更自动同步到 Object Store 的功能
AICORE_GROUNDING_ENABLED=true

# ── BTP Object Store（AICORE_GROUNDING_ENABLED=true 时需要）─────────────
# 从 BTP 控制台 → Object Store 实例 → Service Key 中获取
OS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
OS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OS_BUCKET=hcp-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OS_HOST=s3-eu-central-1.amazonaws.com
OS_REGION=eu-central-1
```

### 3. 初始化数据库

首次运行前需要部署数据库 schema（含 draft 表）：

```bash
npx cds deploy --to sqlite:db.sqlite
```

### 4. 启动服务

```bash
npx cds watch
```

服务启动后访问：

| 页面 | URL |
|------|-----|
| 员工问答页（UI5版） | http://localhost:4004/chat-ui5/index.html |
| 员工问答页（原版） | http://localhost:4004/chat/index.html |
| 知识库管理（Fiori Elements） | http://localhost:4004/kbmanager/index.html |
| OData Admin API | http://localhost:4004/admin |
| OData Knowledge API | http://localhost:4004/api |

### 5. 快速验证 Claude API 连通性

```bash
node test/quick-test.js
```

## API 使用示例

### 提问

```bash
curl -X POST http://localhost:4004/api/askQuestion \
  -H "Content-Type: application/json" \
  -d '{"question": "年假有几天？怎么申请？"}'
```

### 评分

```bash
curl -X POST http://localhost:4004/api/rateAnswer \
  -H "Content-Type: application/json" \
  -d '{"messageId": "<uuid>", "rating": 5}'
```

### 查看知识库文章

```bash
curl http://localhost:4004/api/KnowledgeArticles
```

## 项目结构

```
onboarding-kb-assistant/
├── db/
│   ├── schema.cds                          # 数据模型
│   └── data/
│       ├── onboarding.kb-Categories.csv    # 分类种子数据
│       └── onboarding.kb-KnowledgeArticles.csv  # 文章种子数据
├── srv/
│   ├── knowledge-service.cds              # Service 定义（AdminService + KnowledgeService）
│   ├── knowledge-service.js               # Service Handler
│   └── lib/
│       ├── claude-client.js               # AI 调用入口（支持 anthropic / aicore / orchestration）
│       ├── orchestration-client.js        # SAP Orchestration Service 封装
│       └── objectstore-client.js          # BTP Object Store 上传/删除封装（文章自动同步）
├── app/
│   ├── services.cds                       # CAP 扫描入口
│   ├── chat-ui5/                          # 员工问答聊天页（SAPUI5 版）
│   └── kb-manager/                        # 知识库管理（Fiori Elements）
├── scripts/
│   ├── export-articles.js                 # 从 CSV 批量导出文章为 txt（手动初始化用）
│   └── upload-to-objectstore.js           # 批量上传 txt 到 Object Store（手动初始化用）
├── docs/
│   └── grounding/                         # 导出的文章 txt 文件（gitignored）
├── test/
│   ├── quick-test.js                      # AI 连通性快速测试
│   └── claude-client.test.js              # 单元测试
├── BTP_DEPLOYMENT_GUIDE.md                # BTP 完整部署指南
├── db.sqlite                              # SQLite 本地数据库（gitignored）
├── default-env.json                       # 本地 VCAP_SERVICES 模拟（gitignored）
├── .env                                   # 本地环境变量（gitignored）
├── .env.example
└── package.json
```

## 数据持久化说明

数据保存在本地 `db.sqlite` 文件中，重启服务不会丢失。

如需重置为初始种子数据，删除 `db.sqlite` 后重新运行 `npx cds deploy --to sqlite:db.sqlite`。

## 运行测试

```bash
npm test
```
