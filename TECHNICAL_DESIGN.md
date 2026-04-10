# 员工入职知识库问答助手 — 技术设计文档

**版本：** 1.4  
**日期：** 2026-04-10  
**技术栈：** SAP BTP CAP (Node.js) + Claude API + SAP Fiori Elements + SAPUI5

---

## 目录

1. [系统概述](#1-系统概述)
2. [架构设计](#2-架构设计)
3. [项目结构](#3-项目结构)
4. [数据模型设计](#4-数据模型设计)
5. [Service 定义](#5-service-定义)
6. [AI 集成设计](#6-ai-集成设计)
7. [Service Handler 实现](#7-service-handler-实现)
8. [API 接口设计](#8-api-接口设计)
9. [UI 设计](#9-ui-设计)
10. [部署方案](#10-部署方案)
11. [开发路线图](#11-开发路线图)

---

## 1. 系统概述

### 1.1 背景与目标

新员工入职时面对大量公司政策、流程文档和常见问题，HR 部门每天需要重复回答相同的问题，效率低下。本系统通过 AI 驱动的问答功能，让员工可以直接提问，系统从结构化知识库中检索相关内容并生成自然语言答案。

### 1.2 核心用户角色

| 角色 | 权限 | 主要操作 |
|------|------|---------|
| HR Admin | 管理员 | 维护知识库（增删改查文章） |
| New Employee | 普通用户 | 提问、查看对话历史 |
| Manager | 只读 | 查看知识库、使用问答 |

### 1.3 核心功能

- **知识库管理**：HR 维护 FAQ、政策文档、操作指南（Create / Read / Update / Delete）
- **AI 问答**：员工输入自然语言问题，AI 结合知识库内容生成答案
- **对话历史**：保存每次问答记录，方便回溯
- **引用溯源**：AI 答案标注来源文章，提高可信度

---

## 2. 架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                          本地开发 / SAP BTP                       │
│                                                                   │
│  ┌──────────────────────┐      ┌───────────────────────────────┐  │
│  │  前端 UI              │      │   CAP Application (Node.js)   │  │
│  │                      │◄────►│                               │  │
│  │  ① kb-manager        │      │  ┌─────────────────────────┐  │  │
│  │    Fiori Elements    │      │  │  AdminService (/admin)   │  │  │
│  │    List Report +     │      │  │  - KnowledgeArticles     │  │  │
│  │    Object Page       │      │  │    (draft enabled, CRUD) │  │  │
│  │    完整 CRUD          │      │  │  - Categories            │  │  │
│  │                      │      │  │  - ChatSessions (只读)   │  │  │
│  │  ② chat/index.html   │      │  └─────────────────────────┘  │  │
│  │    纯 HTML/CSS/JS     │      │  ┌─────────────────────────┐  │  │
│  │                      │      │  │  KnowledgeService (/api) │  │  │
│  │  ③ chat-ui5/         │      │  │  - askQuestion()         │  │  │
│  │    SAPUI5 Freestyle  │      │  │  - rateAnswer()          │  │  │
│  │    sap.m.App 导航     │      │  └──────────┬──────────────┘  │  │
│  └──────────────────────┘      │             │                  │  │
│                                │  ┌──────────▼──────────────┐  │  │
│                                │  │  claude-client.js        │  │  │
│                                │  │  (RAG + Claude API)      │  │  │
│                                │  │  支持 baseURL 代理        │  │  │
│                                │  └──────────┬──────────────┘  │  │
│                                └─────────────┼─────────────────┘  │
│                                              │                     │
│  ┌──────────────────────┐                    │                     │
│  │  SQLite 文件数据库    │◄───────────────────┘                     │
│  │  db.sqlite（持久化）  │    raw SQL (db.run)                      │
│  └──────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  公司 AI 代理网关      │
                  │  localhost:6655       │
                  └───────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Anthropic API  │
                    │  claude-sonnet-4-6│
                    └─────────────────┘
```

### 2.2 技术选型

| 层次 | 技术 | 说明 |
|------|------|------|
| 前端（管理） | SAP Fiori Elements (OData V4) | 注解驱动，List Report + Object Page，支持完整 CRUD |
| 前端（问答，原版） | 纯 HTML/CSS/JS | 单页聊天界面，无框架依赖 |
| 前端（问答，UI5版） | SAPUI5 1.120.0 Freestyle | sap.m.App + XML View + MVC Controller |
| 后端框架 | SAP CAP Node.js (@sap/cds ^8) | BTP 原生开发框架 |
| 数据库 | SQLite 文件（db.sqlite） | 本地持久化，零配置 |
| 数据库（生产）| SAP HANA Cloud | BTP 生产环境 |
| AI 模型 | claude-sonnet-4-6 | 问答生成 |
| AI SDK | @anthropic-ai/sdk ^0.39 | 官方 Node.js SDK，支持自定义 baseURL |
| UI5 集成 | cds-plugin-ui5 | CAP 直接服务 UI5 应用 |
| 认证 | 无（开发）/ XSUAA（生产） | 本地无需认证 |

---

## 3. 项目结构

```
onboarding-kb-assistant/
│
├── db/
│   ├── schema.cds                               # 数据模型定义
│   └── data/
│       ├── onboarding.kb-Categories.csv         # 分类种子数据（5条，UUID 主键）
│       └── onboarding.kb-KnowledgeArticles.csv  # 文章种子数据（6篇，UUID 主键）
│
├── srv/
│   ├── knowledge-service.cds   # Service 定义（AdminService + KnowledgeService）
│   ├── knowledge-service.js    # Service Handler（全部使用 raw SQL）
│   └── lib/
│       └── claude-client.js    # Claude API 封装（RAG + JSON 解析 + baseURL 支持）
│
├── app/
│   ├── services.cds            # CAP 扫描入口，使 annotations.cds 生效
│   │
│   ├── chat/
│   │   └── index.html          # 员工问答聊天页（纯 HTML/CSS/JS，无框架）
│   │
│   ├── chat-ui5/               # 员工问答聊天页（SAPUI5 Freestyle 版本）
│   │   ├── ui5.yaml
│   │   ├── package.json
│   │   └── webapp/
│   │       ├── manifest.json   # rootView: Chat.view.xml，无路由
│   │       ├── Component.js    # sap.ui.core.UIComponent 扩展
│   │       ├── index.html
│   │       ├── view/Chat.view.xml
│   │       ├── controller/Chat.controller.js
│   │       └── i18n/i18n.properties
│   │
│   └── kb-manager/             # 知识库管理（SAP Fiori Elements）
│       ├── annotations.cds     # UI 注解（含 ValueHelp、FieldGroups、Facets）
│       ├── ui5.yaml
│       ├── package.json
│       └── webapp/
│           ├── manifest.json   # Fiori Elements 路由（contextPath: /KnowledgeArticles）
│           ├── Component.js    # sap.fe.core.AppComponent 扩展
│           ├── index.html
│           └── i18n/i18n.properties
│
├── test/
│   ├── quick-test.js
│   └── claude-client.test.js
│
├── db.sqlite                   # SQLite 持久化数据库（gitignored）
├── .env                        # 本地环境变量（gitignored）
├── .env.example
├── package.json
└── README.md
```

---

## 4. 数据模型设计

### 文件：`db/schema.cds`

```cds
namespace onboarding.kb;

using { cuid, managed } from '@sap/cds/common';

entity Categories : cuid {
  name        : String(100) not null;
  description : String(500);
  articles    : Association to many KnowledgeArticles on articles.category = $self;
}

entity KnowledgeArticles : cuid, managed {
  title        : String(200)  not null;
  content      : LargeString  not null;
  summary      : String(500);
  category     : Association to Categories;
  tags         : String(300);
  isActive     : Boolean default true;
  viewCount    : Integer default 0;
  helpfulCount : Integer default 0;
  messages     : Association to many ChatMessageArticles
                   on messages.article = $self;
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
  articles     : Composition of many ChatMessageArticles
                   on articles.message = $self;
}

entity ChatMessageArticles {
  key message  : Association to ChatMessages;
  key article  : Association to KnowledgeArticles;
  relevance    : Decimal(3,2);
}
```

### 4.1 SQLite 表名规则

CAP 将命名空间中的点号转换为下划线：

| CDS 实体 | SQLite 表名 |
|---------|------------|
| `onboarding.kb.KnowledgeArticles` | `onboarding_kb_KnowledgeArticles` |
| `onboarding.kb.Categories` | `onboarding_kb_Categories` |
| `onboarding.kb.ChatSessions` | `onboarding_kb_ChatSessions` |
| `onboarding.kb.ChatMessages` | `onboarding_kb_ChatMessages` |
| `onboarding.kb.ChatMessageArticles` | `onboarding_kb_ChatMessageArticles` |

启用 `@odata.draft.enabled` 后，CAP 还会额外创建 draft 相关表：

| Draft 表 | 说明 |
|---------|------|
| `AdminService_KnowledgeArticles_drafts` | 文章草稿 |
| `AdminService_DraftAdministrativeData` | Draft 管理元数据 |

### 4.2 种子数据（CSV）

种子数据在 `db/data/`，首次 `cds deploy` 时加载，之后重启不覆盖已有数据。**所有主键均为标准 UUID 格式**。

- `onboarding.kb-Categories.csv`：5 个分类，ID `...d101` ~ `...d105`
- `onboarding.kb-KnowledgeArticles.csv`：6 篇文章，ID `...d001` ~ `...d006`

### 4.3 数据库初始化

```bash
# 首次部署（创建 schema + draft 表 + 加载种子数据）
npx cds deploy --to sqlite:db.sqlite

# 重置数据库
rm db.sqlite && npx cds deploy --to sqlite:db.sqlite
```

---

## 5. Service 定义

### 文件：`srv/knowledge-service.cds`

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

**关键设计决策：**

- `@odata.draft.enabled`：Fiori Elements (sap.fe.templates) 依赖 draft 机制才会渲染 Create / Edit 按钮
- `@Capabilities`：显式声明可写能力，覆盖 CAP 因计算字段 `categoryName` 产生的隐式只读推断
- `categoryName : String @readonly`：标记为计算字段，不参与写入，但不影响实体整体的可写性
- `KnowledgeService.KnowledgeArticles` 是受限投影，不含 `isActive`/`content`，文章搜索必须用 raw SQL

---

## 6. AI 集成设计

### 6.1 RAG 流程

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ 用户提问      │────►│ 关键词提取           │────►│ raw SQL 检索     │
│              │     │ (去除中文停用词)      │     │ LIKE 匹配        │
└──────────────┘     └─────────────────────┘     │ title/summary/   │
                                                  │ tags/content     │
                                                  └────────┬─────────┘
                                                           │ 最多5篇
                                                           ▼
                                                  ┌──────────────────┐
                                                  │ 构建 Prompt      │
                                                  │ (文章上下文+问题) │
                                                  └────────┬─────────┘
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │ Claude API       │
                                                  │ (via 公司代理)   │
                                                  └────────┬─────────┘
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │ 解析 JSON 输出   │
                                                  │ 正则提取 {...}   │
                                                  │ 兼容 markdown    │
                                                  │ 代码块包装       │
                                                  └──────────────────┘
```

### 6.2 System Prompt

```
你是一位专业的企业内部 HR 助手，帮助新员工解答入职相关问题。

规则：
1. 只根据提供的知识库文章内容回答，不要凭空编造
2. 如果知识库中没有相关信息，明确告知"知识库中暂无此信息，建议联系 HR（hr@company.com）"
3. 回答简洁清晰，使用中文，保持友好专业语气
4. 必须返回严格的 JSON 格式，不要包含任何额外文字、代码块标记或 markdown

返回格式（严格 JSON）：
{
  "answer": "回答内容",
  "referencedArticleIds": ["articleId1", "articleId2"],
  "confidence": 0.95
}
```

### 6.3 文件：`srv/lib/claude-client.js`

支持通过 `ANTHROPIC_BASE_URL` 环境变量配置公司代理网关：

```javascript
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error('ANTHROPIC_API_KEY 环境变量未配置');
    const options = { apiKey: process.env.ANTHROPIC_API_KEY };
    if (process.env.ANTHROPIC_BASE_URL) {
      options.baseURL = process.env.ANTHROPIC_BASE_URL;
    }
    _client = new Anthropic(options);
  }
  return _client;
}
```

JSON 解析容错——兼容 Claude 返回 markdown 代码块的情况：

```javascript
const jsonMatch = raw.match(/\{[\s\S]*\}/);
parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
```

### 6.4 环境变量配置

```
ANTHROPIC_API_KEY=your-key-here
ANTHROPIC_BASE_URL=http://your-proxy/anthropic   # 可选，公司代理路径需含 /anthropic 前缀
```

---

## 7. Service Handler 实现

### 文件：`srv/knowledge-service.js`

> **设计决策：全部使用 raw SQL**
>
> 所有数据库操作均通过 `db.run(rawSQL, params)` 执行：
> - `KnowledgeService.KnowledgeArticles` 投影不含 `isActive`/`content`，CQL 无法做文章全文搜索
> - CAP 8 CQL Builder 不支持 `.where(string)` 原始字符串，会抛 `Cannot read properties of undefined (reading 'raw')`
> - 经 Service 层查询 Session/Message 时，CAP 校验返回列导致 `results not found in elements` 错误
> - `ChatMessageArticles` 无独立 `ID` 列（复合主键），INSERT 需明确指定列名

核心逻辑：

```javascript
module.exports = class KnowledgeService extends cds.ApplicationService {
  async init() {
    const db = await cds.connect.to('db');

    this.on('askQuestion', async (req) => {
      // 1. 关键词提取 + raw SQL 全文检索（含 isActive 过滤）
      // 2. 调用 Claude API 生成答案
      // 3. 获取或新建 ChatSession
      // 4. 保存 ChatMessage
      // 5. 保存 ChatMessageArticles 引用（仅保存检索结果中的 ID，防幻构）
      // 6. 返回 { messageId, sessionId, answer, referencedArticles }
    });

    this.on('rateAnswer', async (req) => {
      // UPDATE onboarding_kb_ChatMessages SET rating = ? WHERE ID = ?
    });

    await super.init();
  }
};
```

---

## 8. API 接口设计

### 8.1 OData Endpoints（CAP 自动生成）

| Method | URL | 说明 |
|--------|-----|------|
| GET | `/api/KnowledgeArticles` | 获取知识文章列表（仅已启用） |
| GET | `/api/KnowledgeArticles(ID)` | 获取单篇文章 |
| GET | `/admin/KnowledgeArticles` | 管理视图（全字段） |
| POST | `/admin/KnowledgeArticles` | 新建文章（经 draft 流程） |
| PATCH | `/admin/KnowledgeArticles(ID)` | 修改文章（经 draft 流程） |
| DELETE | `/admin/KnowledgeArticles(ID)` | 删除文章 |
| GET | `/admin/Categories` | 获取分类列表 |
| GET | `/admin/ChatSessions` | 监控所有对话（只读） |

### 8.2 自定义 Action

#### 提问

```
POST /api/askQuestion
Content-Type: application/json

{ "sessionId": "optional-uuid", "question": "年假有几天？" }

Response:
{
  "value": {
    "messageId": "uuid",
    "sessionId": "uuid",
    "answer": "根据公司政策...",
    "referencedArticles": [
      { "articleId": "uuid", "title": "年假申请流程", "relevance": 1.0 }
    ]
  }
}
```

#### 评分

```
POST /api/rateAnswer
Content-Type: application/json

{ "messageId": "uuid", "rating": 5 }

Response: { "value": true }
```

---

## 9. UI 设计

### 9.1 知识库管理页（kb-manager）

- **框架**：SAP Fiori Elements — List Report + Object Page
- **入口**：`http://localhost:4004/kbmanager/index.html`
- **Component**：继承 `sap/fe/core/AppComponent`
- **Draft 模式**：`@odata.draft.enabled` 启用，支持 Create / Edit / Delete / Copy
- **注解**（`app/kb-manager/annotations.cds`）：
  - `UI.SelectionFields`：分类、启用状态过滤
  - `UI.LineItem`：标题、分类名、标签、启用、浏览数、创建时间
  - `FieldGroup #General`：title、`category_ID`（带 ValueHelp 下拉）、summary、tags、isActive
  - `FieldGroup #Content`：content（Markdown 正文）
  - `FieldGroup #Stats`：viewCount、helpfulCount、createdAt、modifiedAt（只读）
- **ValueHelp**：`category` 关联字段绑定 `Common.ValueList` 指向 `Categories` 实体，`Common.ValueListWithFixedValues: true` 渲染为固定下拉

**操作一览：**

| 操作 | 入口 |
|------|------|
| 新建文章 | List Report 顶部 Create 按钮 |
| 编辑文章 | Object Page 右上角 Edit 按钮 |
| 删除文章 | List Report 行操作 / Object Page |
| 复制文章 | List Report 行操作 Copy |

### 9.2 员工问答聊天页（原版：`app/chat/index.html`）

- **框架**：纯 HTML/CSS/JS，无前端框架依赖
- **入口**：`http://localhost:4004/chat/index.html`
- 左侧边栏会话历史、欢迎页快捷问题、双侧气泡布局、三点打字动画、星级评分、Markdown 渲染

### 9.3 员工问答聊天页（UI5版：`app/chat-ui5/`）

- **框架**：SAPUI5 1.120.0 Freestyle，MVC 架构
- **入口**：`http://localhost:4004/chat-ui5/index.html`
- **应用 ID**：`onboarding.kb.chat`
- **Component**：继承 `sap.ui.core.UIComponent`，`rootView` 直接指向 `Chat.view.xml`（无路由）
- **视图结构**：`sap.m.App`（id: `chatApp`）包含两个 Page：
  - `masterPage`：侧边栏，会话列表 + 新建按钮
  - `chatPage`：欢迎 VBox + 消息列表 + 底部输入工具栏
- **消息渲染**：`CustomListItem` 内三种布局（user / assistant / typing），`visible` 绑定 `role`
- **Model**：`chat` JSONModel，在 `onInit` 中初始化（不在 manifest 配置）
- **Markdown 渲染**：`md2html()` 函数，引用文章以 inline span 标签展示

---

## 10. 部署方案

### 10.1 本地开发环境

```bash
npm install
cp .env.example .env          # 填入 ANTHROPIC_API_KEY 和可选的 ANTHROPIC_BASE_URL
npx cds deploy --to sqlite:db.sqlite   # 首次运行，创建 schema + 加载种子数据
npx cds watch                 # 启动服务
```

| 页面 | URL |
|------|-----|
| 员工聊天页（UI5版） | http://localhost:4004/chat-ui5/index.html |
| 员工聊天页（原版） | http://localhost:4004/chat/index.html |
| 知识库管理 | http://localhost:4004/kbmanager/index.html |
| OData Admin | http://localhost:4004/admin/$metadata |
| OData API | http://localhost:4004/api/$metadata |

### 10.2 环境变量

`.env.example`：
```
ANTHROPIC_API_KEY=your-key-here
ANTHROPIC_BASE_URL=http://your-proxy/anthropic
```

### 10.3 关键 package.json 配置

```json
{
  "dependencies": {
    "@sap/cds": "^8",
    "@anthropic-ai/sdk": "^0.39.0",
    "express": "^4"
  },
  "devDependencies": {
    "@cap-js/sqlite": "^1",
    "@sap/cds-dk": "^8",
    "jest": "^29",
    "cds-plugin-ui5": "^0.13.0"
  },
  "workspaces": ["app/*"],
  "sapux": ["app/kb-manager"],
  "cds": {
    "requires": {
      "db": { "kind": "sqlite", "credentials": { "database": "db.sqlite" } }
    },
    "features": { "fiori_routes": true },
    "roots": ["db", "srv", "app"]
  }
}
```

### 10.4 BTP Cloud Foundry 部署（Phase 3）

| 项目 | 本地开发 | BTP 生产 |
|------|---------|---------|
| 数据库 | SQLite 文件（db.sqlite） | SAP HANA Cloud |
| 认证 | 无（mock user） | XSUAA |
| API Key | `.env` 文件 | BTP Destination / Credential Store |
| UI5 服务 | cds-plugin-ui5 | HTML5 App Repository |
| 启动命令 | `npx cds watch` | `mbt build` + `cf deploy` |

---

## 11. 开发路线图

### Phase 1 — MVP ✅
- [x] 初始化 CAP 项目，定义数据模型
- [x] 定义 Service（AdminService + KnowledgeService）
- [x] 实现 `askQuestion` Handler，接入 Claude API

### Phase 2 — 完善功能 ✅
- [x] 关键词检索逻辑（多字段 LIKE，中文停用词过滤）
- [x] 对话历史存储（ChatSessions + ChatMessages + ChatMessageArticles）
- [x] `rateAnswer` 评分功能
- [x] 种子数据（5个分类，6篇文章，全 UUID 主键）
- [x] Fiori Elements 知识库管理页（List Report + Object Page）
- [x] 员工问答聊天页（纯 HTML 版）
- [x] 员工问答聊天页（SAPUI5 Freestyle 版）
- [x] 全部 DB 操作改为 raw SQL，绕过 CAP 服务层投影限制
- [x] Claude JSON 输出解析容错（正则提取 `{...}`）

### Phase 2.5 — 知识库管理 CRUD ✅
- [x] `@odata.draft.enabled` 启用 Fiori Elements Create/Edit 按钮
- [x] `@Capabilities` 显式声明可写能力，覆盖计算字段引起的隐式只读
- [x] `category` 关联字段添加 `Common.ValueList` 固定下拉
- [x] `FieldGroup #General` 改用 `category_ID` 可写外键
- [x] SQLite 切换为文件持久化（db.sqlite），重启不丢数据
- [x] `npx cds deploy` 初始化包含 draft 表的完整 schema

### Phase 2.6 — AI 代理支持 ✅
- [x] `claude-client.js` 支持 `ANTHROPIC_BASE_URL` 环境变量
- [x] 适配公司内部 AI 代理网关（路径格式：`baseURL/v1/messages`）

### Phase 3 — BTP 部署（待完成）
- [ ] 配置 `mta.yaml`
- [ ] 切换 HANA Cloud 数据库配置
- [ ] 配置 XSUAA 角色权限
- [ ] `mbt build` + `cf deploy`

---

## 附录：已知问题与解决方案

| 问题 | 根因 | 解决方案 |
|------|------|---------|
| `'isActive' not found in KnowledgeService.KnowledgeArticles` | Service 投影不暴露 `isActive` | 改用 `db.run(rawSQL)` 直接查底层表 |
| `Cannot read properties of undefined (reading 'raw')` | CAP 8 CQL Builder 不接受字符串条件 | 全部改用 `db.run(rawSQL, params)` |
| `no such table: ChatSessions` | SQLite 表名含命名空间前缀 | 使用 `onboarding_kb_ChatSessions` 等完整表名 |
| `'results' not found in elements of ChatSessions` | Service 层校验查询结果列 | 绕过 Service 层，直接用 raw SQL |
| `ChatMessageArticles` INSERT 失败 | 实体无独立 `ID` 列（复合主键） | INSERT 时不包含 `ID` 列 |
| Claude 返回 ` ```json{...}``` ` | Claude 有时包裹 markdown 代码块 | 用 `/\{[\s\S]*\}/` 正则提取 JSON 对象 |
| Fiori kb-manager 白屏 | `Component.js` 未继承 `sap.fe.core.AppComponent` | 用 `@sap/generator-fiori` 重新生成整个应用 |
| List Report 无数据 | `annotations.cds` 被截断 / `cds.roots` 未包含 `app/` | 恢复完整注解文件，添加 `cds.roots: ["db","srv","app"]` |
| Object Page `Invalid resource path` | 种子数据 ID 为 `art-001` 非标准 UUID | 将所有 CSV 主键改为标准 UUID 格式 |
| UI5 chat 白屏 | JSONModel 在 manifest 中配置导致 `slice` 错误 | 在 `onInit` 中 `new JSONModel(...)` 初始化 |
| List Report 只有 Delete/Copy | 投影含计算字段导致 CAP 隐式只读；缺少 draft 支持 | 加 `@odata.draft.enabled` + `@Capabilities` + `categoryName @readonly` |
| `no such table: AdminService_KnowledgeArticles_drafts` | 启用 draft 后切换文件 DB，schema 未包含 draft 表 | 运行 `npx cds deploy --to sqlite:db.sqlite` |
| Claude API 403 Forbidden | 公司 API Key 需通过代理网关访问 | 配置 `ANTHROPIC_BASE_URL`，SDK 自动拼接 `/v1/messages` |
| Claude API 404 Not Found | 代理 baseURL 路径不含 `/anthropic` 前缀 | `ANTHROPIC_BASE_URL=http://host:port/anthropic` |

---

*文档结束*
