# 员工入职知识库问答助手 — 项目任务拆解

**文档版本：** 1.0  
**日期：** 2026-04-10  
**说明：** 假设项目从零启动，5 名开发者并行推进，基于 TECHNICAL_DESIGN.md 中的完整设计拆解工作。

---

## 任务概览

| 编号 | 模块 | 负责方向 | 核心产出 |
|------|------|---------|---------|
| Task 1 | 项目基础与数据层 | CAP 项目初始化、数据模型、种子数据、数据库配置 | `db/`、`package.json`、可运行的空服务 |
| Task 2 | 后端服务与 API | Service 定义、OData 端点、askQuestion / rateAnswer Handler | `srv/`，所有 API 可调通 |
| Task 3 | AI 集成 | Claude client 封装、RAG 检索逻辑、Prompt 设计 | `srv/lib/claude-client.js`，问答流程端到端跑通 |
| Task 4 | 知识库管理 UI | Fiori Elements List Report + Object Page、CRUD、ValueHelp | `app/kb-manager/`，HR 可完整管理文章 |
| Task 5 | 员工聊天 UI | SAPUI5 聊天页、会话管理、消息气泡、评分 | `app/chat-ui5/`，员工可完整使用问答 |

---

## Task 1 — 项目基础与数据层

**负责开发者：** 建议由技术 Lead 承担，为其他 4 人搭好脚手架  
**依赖关系：** 无前置依赖，第一个开始，其余 4 个 Task 都依赖本 Task 完成

### 目标

搭建 CAP 项目骨架，定义数据模型，配置数据库，提供种子数据，让其他开发者能直接在此基础上开发。

### 详细任务

#### 1.1 初始化 CAP 项目

```bash
mkdir onboarding-kb-assistant && cd onboarding-kb-assistant
cds init
npm install
```

配置 `package.json`：
- 添加依赖：`@anthropic-ai/sdk`、`express`
- 添加 devDependencies：`@cap-js/sqlite`、`cds-plugin-ui5`、`jest`
- 配置 `cds.requires.db`：SQLite 文件数据库（`db.sqlite`）
- 配置 `cds.features.fiori_routes: true`
- 配置 `cds.roots: ["db", "srv", "app"]`（让 CAP 扫描 app/ 下的 annotations.cds）
- 配置 `workspaces: ["app/*"]` 和 `sapux: ["app/kb-manager"]`

#### 1.2 定义数据模型

新建 `db/schema.cds`，定义以下 5 个实体：

```cds
namespace onboarding.kb;
using { cuid, managed } from '@sap/cds/common';

entity Categories : cuid {
  name        : String(100) not null;
  description : String(500);
  articles    : Association to many KnowledgeArticles on articles.category = $self;
}

entity KnowledgeArticles : cuid, managed {
  title        : String(200) not null;
  content      : LargeString not null;
  summary      : String(500);
  category     : Association to Categories;
  tags         : String(300);
  isActive     : Boolean default true;
  viewCount    : Integer default 0;
  helpfulCount : Integer default 0;
  messages     : Association to many ChatMessageArticles on messages.article = $self;
}

entity ChatSessions : cuid, managed {
  title    : String(200);
  userId   : String(100);
  status   : String(20) default 'ACTIVE';
  messages : Composition of many ChatMessages on messages.session = $self;
}

entity ChatMessages : cuid {
  session      : Association to ChatSessions not null;
  question     : LargeString not null;
  answer       : LargeString;
  promptTokens : Integer;
  answerTokens : Integer;
  rating       : Integer;
  createdAt    : Timestamp @cds.on.insert: $now;
  articles     : Composition of many ChatMessageArticles on articles.message = $self;
}

entity ChatMessageArticles {
  key message  : Association to ChatMessages;
  key article  : Association to KnowledgeArticles;
  relevance    : Decimal(3,2);
}
```

**注意事项：**
- `KnowledgeArticles` 使用 `cuid`（UUID 主键）和 `managed`（自动 createdAt/modifiedAt）
- `ChatMessageArticles` 使用复合主键（无独立 ID 列），INSERT 时不能包含 ID 字段
- SQLite 实际表名规则：命名空间点号转下划线，如 `onboarding_kb_KnowledgeArticles`

#### 1.3 准备种子数据

新建 `db/data/onboarding.kb-Categories.csv`（5 条分类，**主键必须是标准 UUID 格式**）：

```csv
ID,name,description
f47ac10b-58cc-4372-a567-0e02b2c3d101,假期政策,公司年假、病假、产假等各类假期相关政策
f47ac10b-58cc-4372-a567-0e02b2c3d102,IT流程,IT设备申请、系统账号开通、VPN配置等流程
f47ac10b-58cc-4372-a567-0e02b2c3d103,财务流程,报销、发票、差旅费等财务相关流程
f47ac10b-58cc-4372-a567-0e02b2c3d104,入职手续,入职第一天需要完成的各项手续和注意事项
f47ac10b-58cc-4372-a567-0e02b2c3d105,员工福利,公司提供的各类员工福利和权益
```

新建 `db/data/onboarding.kb-KnowledgeArticles.csv`（至少 6 篇文章，涵盖年假、IT设备、报销、入职流程、员工福利、工资等主题），`category_ID` 引用上方分类 UUID。

> **重要**：OData V4 UUID 类型不接受 `art-001` 这类非标准格式，必须使用 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 格式，否则 Object Page 导航会报 `Invalid resource path` 错误。

#### 1.4 初始化数据库

```bash
# 首次部署，创建 schema（含 draft 表）并加载种子数据
npx cds deploy --to sqlite:db.sqlite
```

> **注意**：启用 `@odata.draft.enabled` 后，CAP 会额外创建 `AdminService_KnowledgeArticles_drafts` 和 `AdminService_DraftAdministrativeData` 表。这些 draft 表不会在 `cds watch` 的 in-memory 模式中自动创建，必须先 `cds deploy` 到文件数据库。

#### 1.5 配置环境变量

新建 `.env.example`：
```
ANTHROPIC_API_KEY=your-key-here
ANTHROPIC_BASE_URL=http://your-proxy/anthropic
```

新建 `.gitignore`：
```
node_modules/
*.sqlite
*.db
.env
gen/
```

#### 1.6 创建 app/services.cds

新建 `app/services.cds`，内容仅一行：
```cds
using from './kb-manager/annotations';
```

这个文件让 CAP 在扫描 `app/` 时能加载 kb-manager 的 UI 注解，缺少此文件会导致 Fiori Elements List Report 无数据显示。

#### 1.7 验收标准

- `npx cds deploy --to sqlite:db.sqlite` 无报错
- `npx cds watch` 启动后 `http://localhost:4004` 显示服务欢迎页
- `curl http://localhost:4004/admin/$metadata` 返回 XML（Task 2 完成后可验证）

---

## Task 2 — 后端服务与 API

**负责开发者：** 熟悉 SAP CAP Node.js、OData V4  
**依赖关系：** 依赖 Task 1（数据模型和项目骨架）完成后开始

### 目标

定义两个 CAP Service，实现所有业务 Handler，提供完整可测试的 API 层。

### 详细任务

#### 2.1 定义 Service（knowledge-service.cds）

新建 `srv/knowledge-service.cds`：

```cds
using onboarding.kb as db from '../db/schema';

// ─── HR 管理服务 ────────────────────────────────────────
service AdminService @(path: '/admin') {

  entity Categories as projection on db.Categories;

  @odata.draft.enabled
  @Capabilities: {
    InsertRestrictions: { Insertable: true },
    UpdateRestrictions: { Updatable: true },
    DeleteRestrictions: { Deletable: true }
  }
  entity KnowledgeArticles as projection on db.KnowledgeArticles {
    *,
    category.name as categoryName : String @readonly
  };

  @readonly
  entity ChatSessions as projection on db.ChatSessions;
}

// ─── 员工问答服务 ────────────────────────────────────────
service KnowledgeService @(path: '/api') {

  @readonly
  entity KnowledgeArticles as select from db.KnowledgeArticles {
    ID, title, summary, tags, createdAt,
    category.name as categoryName
  } where isActive = true;

  entity ChatSessions as projection on db.ChatSessions;
  entity ChatMessages as projection on db.ChatMessages;

  action askQuestion(
    sessionId : UUID,
    question  : String(2000) not null
  ) returns {
    messageId          : UUID;
    sessionId          : UUID;
    answer             : LargeString;
    referencedArticles : many {
      articleId : UUID;
      title     : String;
      relevance : Decimal;
    };
  };

  action rateAnswer(
    messageId : UUID not null,
    rating    : Integer not null
  ) returns Boolean;
}
```

**关键设计说明：**
- `@odata.draft.enabled`：Fiori Elements 必须有 draft 支持才显示 Create/Edit 按钮
- `@Capabilities`：显式声明可写，覆盖 CAP 因 `categoryName` 计算字段产生的隐式只读推断
- `categoryName : String @readonly`：标记计算字段只读，不影响实体整体可写性
- `KnowledgeService.KnowledgeArticles` 是受限投影，不含 `isActive`/`content`

#### 2.2 实现 Service Handler（knowledge-service.js）

新建 `srv/knowledge-service.js`。

> **重要设计决策：所有 DB 操作使用 raw SQL（`db.run(sql, params)`），不使用 CQL Builder。**
>
> 原因：
> - `KnowledgeService.KnowledgeArticles` 投影不含 `isActive`/`content`，CQL 无法搜索这些字段
> - CAP 8 的 CQL Builder 不支持 `.where(string)` 传入字符串，会抛 `Cannot read properties of undefined (reading 'raw')`
> - 经 Service 层查询 Session/Message 时，CAP 校验返回列导致 `results not found in elements` 错误

```javascript
'use strict';
const cds = require('@sap/cds');
const { generateAnswer } = require('./lib/claude-client');

module.exports = class KnowledgeService extends cds.ApplicationService {
  async init() {
    const db = await cds.connect.to('db');

    this.on('askQuestion', async (req) => {
      const { sessionId, question } = req.data;
      const userId = req.user?.id ?? 'anonymous';

      if (!question?.trim()) return req.error(400, '问题不能为空');

      // 1. 关键词提取 + raw SQL 全文检索（直接查底层表，含 isActive 过滤）
      const keywords = extractKeywords(question);
      let articles = [];
      if (keywords.length > 0) {
        const found = new Map();
        for (const kw of keywords) {
          const like = `%${kw}%`;
          const rows = await db.run(
            `SELECT ID, title, summary, tags, content
             FROM onboarding_kb_KnowledgeArticles
             WHERE isActive = 1
               AND (title LIKE ? OR summary LIKE ? OR tags LIKE ? OR content LIKE ?)
             LIMIT 10`,
            [like, like, like, like]
          );
          for (const a of rows) { if (!found.has(a.ID)) found.set(a.ID, a); }
          if (found.size >= 5) break;
        }
        articles = [...found.values()].slice(0, 5);
      }
      // 兜底：无关键词匹配时取前5篇
      if (articles.length === 0) {
        articles = await db.run(
          `SELECT ID, title, summary, tags, content
           FROM onboarding_kb_KnowledgeArticles WHERE isActive = 1 LIMIT 5`
        );
      }

      // 2. 调用 Claude API（由 Task 3 实现，此处先用 stub）
      let aiResult;
      try {
        aiResult = await generateAnswer(question, articles);
      } catch (err) {
        return req.error(500, `AI 服务调用失败：${err.message}`);
      }
      const { answer, referencedArticleIds, promptTokens, answerTokens } = aiResult;

      // 3. 获取或新建会话（raw SQL，绕过服务层投影限制）
      let sessionID = sessionId;
      if (sessionId) {
        const row = await db.run(
          `SELECT ID FROM onboarding_kb_ChatSessions WHERE ID = ?`, [sessionId]
        );
        if (!row?.length) return req.error(404, `会话 ${sessionId} 不存在`);
      } else {
        sessionID = cds.utils.uuid();
        await db.run(
          `INSERT INTO onboarding_kb_ChatSessions
             (ID, userId, title, status, createdAt, modifiedAt)
           VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))`,
          [sessionID, userId, question.substring(0, 50)]
        );
      }

      // 4. 保存消息
      const messageID = cds.utils.uuid();
      await db.run(
        `INSERT INTO onboarding_kb_ChatMessages
           (ID, session_ID, question, answer, promptTokens, answerTokens, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [messageID, sessionID, question, answer, promptTokens ?? 0, answerTokens ?? 0]
      );

      // 5. 保存文章引用（注意：无独立 ID 列，复合主键）
      const validIds = referencedArticleIds.filter(id => articles.some(a => a.ID === id));
      for (let i = 0; i < validIds.length; i++) {
        await db.run(
          `INSERT INTO onboarding_kb_ChatMessageArticles (message_ID, article_ID, relevance)
           VALUES (?, ?, ?)`,
          [messageID, validIds[i], parseFloat((1 - i * 0.1).toFixed(2))]
        );
      }

      return {
        messageId: messageID, sessionId: sessionID, answer,
        referencedArticles: articles
          .filter(a => validIds.includes(a.ID))
          .map((a, i) => ({ articleId: a.ID, title: a.title,
            relevance: parseFloat((1 - i * 0.1).toFixed(2)) })),
      };
    });

    this.on('rateAnswer', async (req) => {
      const { messageId, rating } = req.data;
      if (rating < 1 || rating > 5) return req.error(400, '评分必须在 1-5 之间');
      await db.run(
        `UPDATE onboarding_kb_ChatMessages SET rating = ? WHERE ID = ?`,
        [rating, messageId]
      );
      return true;
    });

    await super.init();
  }
};

function extractKeywords(question) {
  const stopWords = new Set([
    '的','是','在','有','我','怎么','如何','什么','哪里','可以',
    '吗','呢','啊','了','和','与','或','请','帮','告诉','问',
    '一','这','那','也','都','会','能','要','想','需要',
  ]);
  return question
    .replace(/[？?！!。，,；;：:""''「」【】（）()]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .slice(0, 8);
}
```

#### 2.3 与 Task 3 的协作接口约定

Task 2 在 Task 3（AI 集成）完成前，需要一个临时 stub：

新建 `srv/lib/claude-client.js`（stub 版本）：
```javascript
async function generateAnswer(question, articles) {
  return {
    answer: `[STUB] 收到问题：${question}，找到 ${articles.length} 篇文章`,
    referencedArticleIds: articles.slice(0, 1).map(a => a.ID),
    promptTokens: 0,
    answerTokens: 0,
  };
}
module.exports = { generateAnswer };
```

Task 3 完成后直接替换此文件，无需修改 `knowledge-service.js`。

#### 2.4 验收标准

```bash
# 提问（stub 阶段返回占位答案）
curl -X POST http://localhost:4004/api/askQuestion \
  -H "Content-Type: application/json" \
  -d '{"question": "年假有几天？"}'
# 期望：返回包含 messageId、sessionId、answer 的 JSON

# 评分
curl -X POST http://localhost:4004/api/rateAnswer \
  -H "Content-Type: application/json" \
  -d '{"messageId": "<上一步返回的messageId>", "rating": 5}'
# 期望：返回 {"value": true}

# 管理端文章列表
curl http://localhost:4004/admin/KnowledgeArticles
# 期望：返回种子数据中的6篇文章
```

---

## Task 3 — AI 集成

**负责开发者：** 熟悉 LLM API、Node.js，有 Prompt Engineering 经验  
**依赖关系：** 依赖 Task 1（项目骨架）；可与 Task 2 并行，完成后替换 stub

### 目标

实现 Claude API 的完整封装，包括 RAG Prompt 构建、JSON 输出解析容错、代理网关支持，让问答质量达到可用水平。

### 详细任务

#### 3.1 实现 claude-client.js

新建 `srv/lib/claude-client.js`：

```javascript
'use strict';
const Anthropic = require('@anthropic-ai/sdk');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error('ANTHROPIC_API_KEY 环境变量未配置。请在 .env 文件中设置。');
    const options = { apiKey: process.env.ANTHROPIC_API_KEY };
    // 支持公司内部代理网关（如 http://localhost:6655/anthropic）
    if (process.env.ANTHROPIC_BASE_URL) {
      options.baseURL = process.env.ANTHROPIC_BASE_URL;
    }
    _client = new Anthropic(options);
  }
  return _client;
}

const SYSTEM_PROMPT = `你是一位专业的企业内部 HR 助手，帮助新员工解答入职相关问题。

规则：
1. 只根据提供的知识库文章内容回答，不要凭空编造
2. 如果知识库中没有相关信息，明确告知"知识库中暂无此信息，建议联系 HR（hr@company.com）"
3. 回答简洁清晰，使用中文，保持友好专业语气
4. 必须返回严格的 JSON 格式，不要包含任何额外文字、代码块标记或 markdown

返回格式（严格 JSON，不含 \`\`\`json 标记）：
{
  "answer": "回答内容",
  "referencedArticleIds": ["articleId1", "articleId2"],
  "confidence": 0.95
}`;

async function generateAnswer(question, articles) {
  const context = articles.length > 0
    ? articles.map((a, i) =>
        `--- 文章 ${i + 1} (ID: ${a.ID}) ---\n标题：${a.title}\n内容：${a.content}`
      ).join('\n\n')
    : '（当前知识库中没有检索到相关文章）';

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `知识库文章：\n${context}\n\n员工问题：${question}` }],
  });

  const raw = response.content[0].text.trim();

  let parsed;
  try {
    // 用正则提取 {...}，兼容 Claude 有时把 JSON 包在 ```json 代码块中的情况
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const cleaned = jsonMatch ? jsonMatch[0] : raw;
    parsed = JSON.parse(cleaned);
  } catch {
    // 容错：AI 返回非标准 JSON 时，直接把原文作为 answer
    parsed = { answer: raw, referencedArticleIds: [], confidence: 0.5 };
  }

  return {
    answer: parsed.answer || raw,
    referencedArticleIds: Array.isArray(parsed.referencedArticleIds)
      ? parsed.referencedArticleIds : [],
    promptTokens: response.usage.input_tokens,
    answerTokens: response.usage.output_tokens,
  };
}

module.exports = { generateAnswer };
```

#### 3.2 Prompt 设计要点

- **System Prompt 核心约束**：只基于提供的文章回答，不编造
- **返回格式**：要求 Claude 返回严格 JSON（`answer` + `referencedArticleIds` + `confidence`）
- **JSON 容错**：Claude 偶尔会在 JSON 前后加 ` ```json ``` ` 标记，用 `/\{[\s\S]*\}/` 正则提取，而非直接 `JSON.parse`
- **文章上下文格式**：每篇文章用 `--- 文章 N (ID: xxx) ---` 分隔，让 Claude 能准确引用 ID

#### 3.3 环境变量配置

`.env` 文件（本地开发）：
```
ANTHROPIC_API_KEY=your-key-here
# 如有公司代理网关（SDK 会自动拼接 /v1/messages）：
ANTHROPIC_BASE_URL=http://localhost:6655/anthropic
```

> **代理路径注意**：Anthropic SDK 会在 `baseURL` 后拼接 `/v1/messages`。如代理地址为 `http://host:6655`，实际接收路径为 `/v1/messages`，则 `ANTHROPIC_BASE_URL=http://host:6655`；若代理需要前缀路径 `/anthropic/v1/messages`，则 `ANTHROPIC_BASE_URL=http://host:6655/anthropic`。

#### 3.4 单元测试

新建 `test/claude-client.test.js`，用 Jest mock 覆盖以下场景：
- 正常 JSON 返回 → 正确解析 answer 和 referencedArticleIds
- JSON 被 ` ```json ``` ` 包裹 → 正则提取后解析成功
- 完全非 JSON 返回 → 容错返回原文作为 answer
- API Key 未配置 → 抛出明确错误信息

新建 `test/quick-test.js`，直接调用真实 API 验证连通性：
```bash
node test/quick-test.js
```

#### 3.5 验收标准

- `node test/quick-test.js` 成功返回 Claude 的回答
- `npm test` 单元测试全部通过
- 替换 Task 2 的 stub 后，`curl -X POST http://localhost:4004/api/askQuestion -d '{"question":"年假有几天"}'` 返回真实 AI 回答，且 `referencedArticles` 包含正确引用

---

## Task 4 — 知识库管理 UI（kb-manager）

**负责开发者：** 熟悉 SAP Fiori Elements、CDS 注解、OData V4  
**依赖关系：** 依赖 Task 1（项目骨架）和 Task 2（AdminService 定义）；可与 Task 3、5 并行

### 目标

实现 HR 管理员的知识库管理界面，支持完整的 CRUD 操作，分类下拉选择，基于 SAP Fiori Elements 注解驱动。

### 详细任务

#### 4.1 初始化 kb-manager 应用

使用 `@sap/generator-fiori` 生成标准 Fiori Elements 应用骨架（List Report + Object Page 模板）：

```bash
cd app
npx @sap/generator-fiori generate
# 选择：List Report Object Page
# Data source: OData V4 service
# Service URL: http://localhost:4004/admin
# Entity: KnowledgeArticles
# App ID: kbmanager
```

生成后关键文件：
- `app/kb-manager/webapp/Component.js` — 必须继承 `sap/fe/core/AppComponent`（非 `sap/ui/core/UIComponent`）
- `app/kb-manager/webapp/manifest.json` — 路由配置，`contextPath: "/KnowledgeArticles"`
- `app/kb-manager/webapp/index.html` — ComponentSupport 启动页
- `app/kb-manager/ui5.yaml` — 含 `fiori-tools-proxy` 中间件

#### 4.2 配置 manifest.json

确认以下关键配置：
```json
{
  "sap.ui5": {
    "dependencies": {
      "libs": {
        "sap.m": {},
        "sap.ui.core": {},
        "sap.fe.templates": {}
      }
    },
    "routing": {
      "routes": [
        { "pattern": ":?query:", "name": "KnowledgeArticlesList", "target": "KnowledgeArticlesList" },
        { "pattern": "KnowledgeArticles({key}):?query:", "name": "KnowledgeArticlesObjectPage", "target": "KnowledgeArticlesObjectPage" }
      ],
      "targets": {
        "KnowledgeArticlesList": {
          "name": "sap.fe.templates.ListReport",
          "options": {
            "settings": {
              "contextPath": "/KnowledgeArticles",
              "initialLoad": "Enabled",
              "navigation": {
                "KnowledgeArticles": { "detail": { "route": "KnowledgeArticlesObjectPage" } }
              }
            }
          }
        },
        "KnowledgeArticlesObjectPage": {
          "name": "sap.fe.templates.ObjectPage",
          "options": { "settings": { "contextPath": "/KnowledgeArticles", "editableHeaderContent": false } }
        }
      }
    }
  }
}
```

#### 4.3 配置 ui5.yaml

```yaml
specVersion: "4.0"
metadata:
  name: kbmanager
type: application
server:
  customMiddleware:
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        backend:
          - path: /admin
            url: http://localhost:4004
        ui5:
          path: [/resources, /test-resources]
          url: https://sapui5.hana.ondemand.com
          version: "1.120.0"
```

#### 4.4 编写 annotations.cds

新建 `app/kb-manager/annotations.cds`：

**第一部分：category ValueHelp（必须在主 annotate 前声明）**
```cds
using AdminService from '../../srv/knowledge-service';

annotate AdminService.KnowledgeArticles with {
  category @(
    Common.Text            : category.name,
    Common.TextArrangement : #TextOnly,
    Common.ValueListWithFixedValues: true,
    Common.ValueList: {
      $Type         : 'Common.ValueListType',
      CollectionPath: 'Categories',
      Parameters    : [
        { $Type: 'Common.ValueListParameterOut', LocalDataProperty: category_ID, ValueListProperty: 'ID' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
      ]
    }
  );
};
```

**第二部分：KnowledgeArticles List Report + Object Page**
```cds
annotate AdminService.KnowledgeArticles with @(
  UI.SelectionFields: [ category_ID, isActive ],
  UI.LineItem: [
    { Value: title,        Label: '标题' },
    { Value: categoryName, Label: '分类' },
    { Value: tags,         Label: '标签' },
    { Value: isActive,     Label: '启用' },
    { Value: viewCount,    Label: '浏览数' },
    { Value: createdAt,    Label: '创建时间' }
  ],
  UI.HeaderInfo: {
    TypeName: '知识文章', TypeNamePlural: '知识文章',
    Title: { Value: title }, Description: { Value: summary }
  },
  UI.FieldGroup #General: {
    Label: '基本信息',
    Data: [
      { Value: title,       Label: '标题' },
      { Value: category_ID, Label: '分类' },  // 使用 FK 字段，ValueHelp 由上方注解驱动
      { Value: summary,     Label: '摘要' },
      { Value: tags,        Label: '标签（逗号分隔）' },
      { Value: isActive,    Label: '是否启用' }
    ]
  },
  UI.FieldGroup #Content: {
    Label: '文章内容',
    Data: [ { Value: content, Label: '正文（支持 Markdown）' } ]
  },
  UI.FieldGroup #Stats: {
    Label: '统计',
    Data: [
      { Value: viewCount,    Label: '浏览次数' },
      { Value: helpfulCount, Label: '有帮助数' },
      { Value: createdAt,    Label: '创建时间' },
      { Value: modifiedAt,   Label: '修改时间' }
    ]
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', Label: '文章内容', Target: '@UI.FieldGroup#Content' },
    { $Type: 'UI.ReferenceFacet', Label: '统计数据', Target: '@UI.FieldGroup#Stats' }
  ]
);
```

**第三部分：Categories 列表（用于分类管理）**
```cds
annotate AdminService.Categories with @(
  UI.LineItem: [
    { Value: name, Label: '分类名称' },
    { Value: description, Label: '描述' }
  ],
  UI.HeaderInfo: { TypeName: '知识分类', TypeNamePlural: '知识分类', Title: { Value: name } },
  UI.FieldGroup #CatInfo: { Data: [ { Value: name, Label: '分类名称' }, { Value: description, Label: '描述' } ] },
  UI.Facets: [ { $Type: 'UI.ReferenceFacet', Label: '分类信息', Target: '@UI.FieldGroup#CatInfo' } ]
);
```

**第四部分：ChatSessions 只读监控**
```cds
annotate AdminService.ChatSessions with @(
  UI.LineItem: [
    { Value: userId,    Label: '用户 ID' },
    { Value: title,     Label: '会话标题' },
    { Value: status,    Label: '状态' },
    { Value: createdAt, Label: '创建时间' }
  ]
);
```

#### 4.5 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 页面白屏 | Component.js 未继承 `sap.fe.core.AppComponent` | 用 `@sap/generator-fiori` 重新生成 |
| List Report 无数据 | `app/services.cds` 缺失或 `cds.roots` 未包含 `app/` | 检查 `app/services.cds`，确认 `package.json` 中 `cds.roots` |
| 无 Create/Edit 按钮 | 缺少 `@odata.draft.enabled` | 在 `knowledge-service.cds` 的 `KnowledgeArticles` 上添加 |
| Object Page `Invalid resource path` | 种子数据 ID 不是标准 UUID | 确保 CSV 使用 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 格式 |
| Draft 表不存在 | 未运行 `cds deploy` | 执行 `npx cds deploy --to sqlite:db.sqlite` |

#### 4.6 验收标准

- List Report 显示所有6篇种子文章，分类列显示分类名称
- 可按分类、启用状态筛选
- 点击文章进入 Object Page，显示三个 Tab（基本信息、文章内容、统计）
- Object Page 可编辑（Edit 按钮），分类字段显示为下拉，选择后正确保存
- List Report 顶部 Create 按钮可创建新文章
- Delete 删除后文章从列表消失

---

## Task 5 — 员工聊天 UI（chat-ui5）

**负责开发者：** 熟悉 SAPUI5 Freestyle、MVC 架构  
**依赖关系：** 依赖 Task 1（项目骨架）和 Task 2（`/api/askQuestion` 端点）；可与 Task 3、4 并行

### 目标

实现员工问答聊天界面，支持会话管理、消息发送与接收、引用文章展示、星级评分，基于 SAPUI5 Freestyle MVC 架构。

### 详细任务

#### 5.1 初始化 chat-ui5 应用结构

手动创建以下目录和文件（不使用 generator，Freestyle 应用）：

```
app/chat-ui5/
├── package.json
├── ui5.yaml
└── webapp/
    ├── manifest.json
    ├── Component.js
    ├── index.html
    ├── view/
    │   └── Chat.view.xml
    ├── controller/
    │   └── Chat.controller.js
    └── i18n/
        └── i18n.properties
```

#### 5.2 配置 package.json 和 ui5.yaml

`app/chat-ui5/package.json`：
```json
{
  "name": "chat-ui5",
  "version": "0.0.1",
  "devDependencies": {
    "@sap/ux-ui5-tooling": "^1"
  }
}
```

`app/chat-ui5/ui5.yaml`：
```yaml
specVersion: "4.0"
metadata:
  name: chat-ui5
type: application
server:
  customMiddleware:
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        backend:
          - path: /api
            url: http://localhost:4004
```

#### 5.3 配置 manifest.json

```json
{
  "_version": "1.49.0",
  "sap.app": {
    "id": "onboarding.kb.chat",
    "type": "application",
    "title": "HR 知识库助手",
    "applicationVersion": { "version": "1.0.0" },
    "i18n": "i18n/i18n.properties"
  },
  "sap.ui": { "technology": "UI5", "fullWidth": true },
  "sap.ui5": {
    "rootView": {
      "viewName": "onboarding.kb.chat.view.Chat",
      "type": "XML",
      "async": true,
      "id": "chat"
    },
    "dependencies": {
      "minUI5Version": "1.120.0",
      "libs": { "sap.m": {}, "sap.ui.core": {}, "sap.ui.layout": {} }
    },
    "models": {
      "i18n": {
        "type": "sap.ui.model.resource.ResourceModel",
        "settings": { "bundleName": "onboarding.kb.chat.i18n.i18n" }
      }
    }
  }
}
```

> **注意**：`chat` JSONModel **不要**在 manifest 中配置，必须在 Controller 的 `onInit` 中用 `new JSONModel(...)` 创建，否则访问 `messages` 数组时会抛 `Cannot read properties of undefined (reading 'slice')` 错误。

#### 5.4 实现 Component.js

```javascript
sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {
  "use strict";
  return UIComponent.extend("onboarding.kb.chat.Component", {
    metadata: { manifest: "json" }
  });
});
```

> **注意**：chat-ui5 继承 `sap/ui/core/UIComponent`（通用），而 kb-manager 继承 `sap/fe/core/AppComponent`（Fiori Elements 专用），两者不能混用。

#### 5.5 实现 Chat.view.xml

根控件使用 `sap.m.App`（id: `chatApp`），包含两个 Page：

```xml
<mvc:View controllerName="onboarding.kb.chat.controller.Chat" ...>
  <App id="chatApp">
    <pages>

      <!-- 侧边栏（masterPage） -->
      <Page id="masterPage" title="历史对话">
        <customHeader>
          <Bar>
            <contentLeft><Title text="历史对话" titleStyle="H5"/></contentLeft>
            <contentRight><Button text="+ 新建" type="Emphasized" press=".onNewSession"/></contentRight>
          </Bar>
        </customHeader>
        <List id="sessionList" items="{chat>/sessions}" mode="SingleSelectMaster"
              selectionChange=".onSessionSelect" noDataText="暂无历史对话">
          <StandardListItem title="{chat>title}" description="{chat>createdAt}" type="Active"/>
        </List>
      </Page>

      <!-- 聊天主页面（chatPage） -->
      <Page id="chatPage" backgroundDesign="List" enableScrolling="true">
        <customHeader>
          <Bar>
            <contentLeft>
              <Button icon="sap-icon://menu2" press=".onToggleSidebar" type="Transparent"/>
              <Title text="🤝 HR 助手" titleStyle="H4"/>
            </contentLeft>
          </Bar>
        </customHeader>

        <content>
          <!-- 欢迎区（消息列表为空时显示） -->
          <VBox id="welcomeBox" visible="{= ${chat>/messages}.length === 0 }" alignItems="Center">
            <Title text="👋 你好！我是 HR 助手" titleStyle="H2"/>
            <Text text="有任何入职相关的问题，直接问我吧。"/>
            <FlexBox wrap="Wrap" justifyContent="Center">
              <Button text="年假有几天？怎么申请？" type="Ghost" press=".onQuickAsk"/>
              <Button text="如何申请IT设备？"       type="Ghost" press=".onQuickAsk"/>
              <Button text="报销流程是什么？"        type="Ghost" press=".onQuickAsk"/>
              <Button text="入职第一天需要做什么？"  type="Ghost" press=".onQuickAsk"/>
              <Button text="公司有哪些员工福利？"    type="Ghost" press=".onQuickAsk"/>
            </FlexBox>
          </VBox>

          <!-- 消息列表 -->
          <List id="messageList" items="{chat>/messages}" showSeparators="None">
            <CustomListItem>
              <!-- 用户消息（右对齐） -->
              <FlexBox visible="{= ${chat>role} === 'user' }" justifyContent="End">
                <Panel class="chatBubbleUser">
                  <Text text="{chat>text}" wrapping="true"/>
                </Panel>
                <core:Icon src="sap-icon://person-placeholder" size="2rem"/>
              </FlexBox>

              <!-- 助手消息（左对齐） -->
              <FlexBox visible="{= ${chat>role} === 'assistant' }" justifyContent="Start">
                <core:Icon src="sap-icon://customer-briefing" size="2rem" color="var(--sapBrandColor)"/>
                <VBox>
                  <Panel class="chatBubbleBot">
                    <FormattedText htmlText="{chat>html}"/>
                  </Panel>
                  <RatingIndicator visible="{= !!${chat>messageId} &amp;&amp; !${chat>rated} }"
                                   maxValue="5" value="0" iconSize="1.2rem" change=".onRate"/>
                  <Text visible="{= !!${chat>rated} }" text="✓ 感谢反馈！"/>
                </VBox>
              </FlexBox>

              <!-- 打字动画 -->
              <FlexBox visible="{= ${chat>role} === 'typing' }" justifyContent="Start">
                <core:Icon src="sap-icon://customer-briefing" size="2rem" color="var(--sapBrandColor)"/>
                <BusyIndicator/>
              </FlexBox>
            </CustomListItem>
          </List>
        </content>

        <!-- 底部输入栏 -->
        <footer>
          <Toolbar>
            <TextArea id="inputArea" value="{chat>/inputText}"
                      placeholder="输入你的问题，按 Ctrl+Enter 发送…"
                      rows="2" growing="true" growingMaxLines="4" width="100%"
                      enabled="{= !${chat>/busy} }"/>
            <Button icon="sap-icon://paper-plane" type="Emphasized"
                    enabled="{= !${chat>/busy} }" press=".onSend"/>
          </Toolbar>
        </footer>
      </Page>
    </pages>
  </App>

  <!-- 气泡样式 -->
  <html:style xmlns:html="http://www.w3.org/1999/xhtml">
    .chatBubbleUser { background: var(--sapButton_Emphasized_Background) !important;
      border-radius: 12px 12px 3px 12px !important; border: none !important; max-width: 70vw; }
    .chatBubbleUser .sapMText { color: var(--sapButton_Emphasized_TextColor) !important; }
    .chatBubbleBot { background: var(--sapBaseColor) !important;
      border-radius: 12px 12px 12px 3px !important; box-shadow: var(--sapContent_Shadow0) !important;
      border: none !important; max-width: 75vw; }
  </html:style>
</mvc:View>
```

#### 5.6 实现 Chat.controller.js

```javascript
sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/m/MessageToast"],
function (Controller, JSONModel, MessageToast) {
  "use strict";

  // Markdown 转 HTML（含引用文章标签）
  function md2html(text, refs) {
    var body = text
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/^## (.+)$/gm,"<strong>$1</strong>")
      .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
      .replace(/^- (.+)$/gm,"• $1")
      .replace(/\n/g,"<br/>");
    if (refs && refs.length > 0) {
      var tags = refs.map(r =>
        `<span style='display:inline-block;background:#e8f0fb;color:#0a6ed1;
          border:1px solid #c8d8f5;border-radius:4px;padding:2px 8px;
          margin:2px 4px 2px 0;font-size:12px'>📄 ${r.title}</span>`
      ).join("");
      body += "<br/><br/><span style='font-size:12px;color:#6c757d'>参考文章：</span>" + tags;
    }
    return body;
  }

  return Controller.extend("onboarding.kb.chat.controller.Chat", {

    onInit: function () {
      // JSONModel 必须在 onInit 中创建，不能在 manifest 中配置
      var oModel = new JSONModel({
        messages: [], sessions: [], currentSessionId: null, inputText: "", busy: false
      });
      this.getView().setModel(oModel, "chat");

      // 初始直接进入聊天页
      var oApp = this.byId("chatApp");
      var oChatPage = this.byId("chatPage");
      if (oApp && oChatPage) oApp.to(oChatPage);

      // Ctrl+Enter 发送快捷键
      var oArea = this.byId("inputArea");
      if (oArea) {
        oArea.addEventDelegate({
          onkeydown: function (oEvent) {
            if (oEvent.ctrlKey && oEvent.key === "Enter") this.onSend();
          }.bind(this)
        });
      }
    },

    onToggleSidebar: function () {
      this.byId("chatApp").to(this.byId("masterPage"));
    },

    onNewSession: function () {
      var oModel = this._getChatModel();
      oModel.setProperty("/currentSessionId", null);
      oModel.setProperty("/messages", []);
      oModel.setProperty("/inputText", "");
      this.byId("sessionList").removeSelections(true);
      this.byId("chatApp").to(this.byId("chatPage"));
    },

    onSessionSelect: function (oEvent) {
      var oCtx = oEvent.getParameter("listItem").getBindingContext("chat");
      this._getChatModel().setProperty("/currentSessionId", oCtx.getProperty("id"));
      this._getChatModel().setProperty("/messages", []);
      this.byId("chatApp").to(this.byId("chatPage"));
      MessageToast.show("已切换会话，继续提问吧");
    },

    onQuickAsk: function (oEvent) {
      this._getChatModel().setProperty("/inputText", oEvent.getSource().getText());
      this.onSend();
    },

    onSend: function () {
      var oModel = this._getChatModel();
      if (oModel.getProperty("/busy")) return;
      var sQuestion = (oModel.getProperty("/inputText") || "").trim();
      if (!sQuestion) return;

      this._appendMessage({ role: "user", text: sQuestion });
      oModel.setProperty("/inputText", "");
      this._appendMessage({ role: "typing" });
      oModel.setProperty("/busy", true);
      this._scrollToBottom();

      var oBody = { question: sQuestion };
      var sSessionId = oModel.getProperty("/currentSessionId");
      if (sSessionId) oBody.sessionId = sSessionId;

      fetch("/api/askQuestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(oBody)
      })
      .then(res => {
        if (!res.ok) return res.json().then(e => { throw new Error((e.error && e.error.message) || "HTTP " + res.status); });
        return res.json();
      })
      .then(data => {
        var oVal = data.value || data;
        oModel.setProperty("/currentSessionId", oVal.sessionId);
        this._removeTyping();
        this._appendMessage({
          role: "assistant",
          html: md2html(oVal.answer, oVal.referencedArticles),
          messageId: oVal.messageId,
          rated: false
        });
        this._upsertSession(oVal.sessionId, sQuestion);
        this._scrollToBottom();
      })
      .catch(err => {
        this._removeTyping();
        this._appendMessage({
          role: "assistant",
          html: `<span style='color:var(--sapNegativeTextColor)'>❌ 出错了：${err.message}</span>`
        });
        this._scrollToBottom();
      })
      .finally(() => oModel.setProperty("/busy", false));
    },

    onRate: function (oEvent) {
      var nScore = oEvent.getParameter("value");
      var oCtx = oEvent.getSource().getBindingContext("chat");
      fetch("/api/rateAnswer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: oCtx.getProperty("messageId"), rating: nScore })
      }).then(() => {
        this._getChatModel().setProperty(oCtx.getPath() + "/rated", true);
        MessageToast.show("感谢你的反馈！");
      });
    },

    _getChatModel: function () { return this.getView().getModel("chat"); },
    _appendMessage: function (oMsg) {
      var oModel = this._getChatModel();
      var aMsgs = oModel.getProperty("/messages").slice();
      aMsgs.push(oMsg);
      oModel.setProperty("/messages", aMsgs);
    },
    _removeTyping: function () {
      var oModel = this._getChatModel();
      oModel.setProperty("/messages", oModel.getProperty("/messages").filter(m => m.role !== "typing"));
    },
    _upsertSession: function (sId, sTitle) {
      var oModel = this._getChatModel();
      var aSessions = oModel.getProperty("/sessions").slice();
      if (!aSessions.some(s => s.id === sId)) {
        aSessions.unshift({ id: sId, title: sTitle.substring(0, 30),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }) });
        oModel.setProperty("/sessions", aSessions);
      }
    },
    _scrollToBottom: function () {
      setTimeout(() => { var p = this.byId("chatPage"); if (p) p.scrollTo(999999, 200); }, 100);
    }
  });
});
```

#### 5.7 验收标准

- 访问 `http://localhost:4004/chat-ui5/index.html` 显示欢迎页和5个快捷问题按钮
- 点击快捷问题或输入问题后，出现打字动画，随后显示 AI 回答
- 回答下方显示引用文章标签
- 星级评分可点击，提交后显示「✓ 感谢反馈！」
- 汉堡菜单可切换到侧边栏会话列表，点击「+ 新建」重置聊天页

---

## 任务依赖关系

```
Task 1（基础）──────────────────────────────────────────┐
    │                                                    │
    ├──► Task 2（后端 API）──────────────────────────────┤
    │        │                                           │
    │        ├──► Task 4（kb-manager UI）                │
    │        │                                           │
    │        └──► Task 5（chat-ui5 UI）                  │
    │                                                    │
    └──► Task 3（AI 集成）── 替换 Task 2 的 stub ────────┘
```

**并行策略：**
1. Task 1 优先完成（预计 1-2 天）
2. Task 1 完成后，Task 2、3、4、5 同时开工
3. Task 2 先交付含 stub 的版本，Task 5 即可开始联调
4. Task 3 完成后替换 stub，Task 5 进行 AI 回答的真实联调

## 开发规范约定

### DB 操作
- 所有涉及 `isActive`、`content` 等未在 Service 投影中暴露的字段，必须通过 `db.run(rawSQL, params)` 直接操作
- SQLite 表名格式：`onboarding_kb_实体名`（命名空间点号转下划线）
- `datetime('now')` 是 SQLite 专有语法，未来迁移 HANA 时需替换为 `CURRENT_TIMESTAMP`

### OData / CDS
- 实体主键使用 `cuid`（UUID），CSV 种子数据主键必须是标准 UUID 格式
- 需要 Create/Edit 功能的 AdminService 实体必须加 `@odata.draft.enabled`
- 计算字段（如 `category.name as categoryName`）必须标注 `: Type @readonly`，否则 CAP 会将整个实体推断为只读

### SAPUI5
- Fiori Elements 应用（kb-manager）Component 继承 `sap/fe/core/AppComponent`
- Freestyle 应用（chat-ui5）Component 继承 `sap/ui/core/UIComponent`
- JSONModel 在 Controller `onInit` 中初始化，不在 manifest 中配置
