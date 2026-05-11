# 员工入职知识库助手 — SAP BTP 完整部署指南

> **文档版本：** 1.1  
> **日期：** 2026-05-01  
> **适用项目：** `onboarding-kb-assistant`（CAP Node.js + AI 对话）  
> **目标环境：** SAP BTP Cloud Foundry + AI Core + Generative AI Hub

---

## 目录

1. [架构概览](#1-架构概览)
2. [BTP 服务依赖清单](#2-btp-服务依赖清单)
3. [前置条件](#3-前置条件)
4. [阶段一：从 Anthropic API 迁移到 SAP AI Core](#4-阶段一从-anthropic-api-迁移到-sap-ai-core)
5. [阶段二：使用 Orchestration Service（AI Launchpad）](#5-阶段二使用-orchestration-serviceai-launchpad)
6. [阶段三：BTP 基础服务配置](#6-阶段三btp-基础服务配置)
7. [阶段四：HANA Cloud 数据库迁移](#7-阶段四hana-cloud-数据库迁移)
8. [阶段五：MTA 多目标应用打包](#8-阶段五mta-多目标应用打包)
9. [阶段六：CF 部署与验证](#9-阶段六cf-部署与验证)
10. [阶段七：AI Launchpad 配置与监控](#10-阶段七ai-launchpad-配置与监控)
11. [环境变量与 Secret 管理](#11-环境变量与-secret-管理)
12. [故障排查](#12-故障排查)

---

## 1. 架构概览

### 当前架构（本地开发）

```
浏览器 (SAPUI5 / Fiori)
    │
    ▼
CAP Node.js (Express)         ← cds watch / SQLite
    │
    ├── AdminService  (/admin)
    └── KnowledgeService (/api)
            │
            ▼
    claude-client.js
            │
            ▼
    Anthropic API (直连 / 公司代理)
    claude-sonnet-4-6
```

### 目标架构（SAP BTP）

```
浏览器
    │
    ▼
SAP App Router (approuter)          ← XSUAA 鉴权
    │
    ├── /kb-manager/*  ──────────► HTML5 Application Repository
    ├── /chat-ui5/*    ──────────► HTML5 Application Repository
    ├── /admin/*       ──────────┐
    └── /api/*         ──────────┤
                                 ▼
                        CAP Node.js (CF App)
                                 │
                        ┌────────┴─────────┐
                        ▼                  ▼
                  SAP HANA Cloud     AI Core Service
                 (HDI Container)          │
                                    ┌─────┴──────┐
                                    ▼            ▼
                            Generative AI   Orchestration
                              Hub (LLM)      Service
                              (GPT-4o /     (Grounding /
                              Claude 3.5)   Filtering /
                                            Templating)
```

### AI Launchpad 核心组件说明

| 组件 | 作用 | 本项目用途 |
|------|------|----------|
| **AI Core** | 托管 AI 工作负载的底层平台 | 统一 LLM 调用入口，替代直连 Anthropic |
| **Generative AI Hub** | 多模型 LLM 接入层 | 支持 GPT-4o、Claude 3.5、Llama 等，统一 API |
| **Orchestration Service** | AI 管道编排（Grounding/Filtering/Templating） | RAG 增强、内容过滤、Prompt 模板管理 |
| **AI Launchpad** | Web 控制台 | 模型部署、实验管理、Cost 监控 |

---

## 2. BTP 服务依赖清单

在开始部署前，确认以下 BTP 服务已在你的子账号（Subaccount）中可用：

| BTP 服务 | Service Plan | 用途 |
|---------|-------------|------|
| `sap-aicore` | `extended` | AI Core 主服务 |
| `aicore` Generative AI Hub | （含在 AI Core extended） | LLM 访问 |
| `aicore` Orchestration | （含在 AI Core extended） | AI 管道编排 |
| `xsuaa` | `application` | OAuth2 认证授权 |
| `hana` | `hdi-shared` | HANA Cloud HDI Container |
| `html5-apps-repo` | `app-host` | 前端静态资源托管 |
| `destination` | `lite` | 目标系统配置（可选） |
| `connectivity` | `lite` | 连接外部系统（可选） |

---

## 3. 前置条件

### 3.1 本地工具安装

```bash
# 1. Cloud Foundry CLI（v8+）
cf --version

# 2. MTA Build Tool
npm install -g mbt
mbt --version

# 3. CF MTA 插件
cf install-plugin multiapps

# 4. SAP CDS CLI
npm install -g @sap/cds-dk
cds --version

# 5. SAP AI Core SDK（用于代码集成）
npm install @sap-ai-sdk/foundation-models @sap-ai-sdk/orchestration
```

### 3.2 BTP 登录

```bash
# 登录 Cloud Foundry（替换为你的 CF API endpoint）
cf login -a https://api.cf.eu12.hana.ondemand.com

# 目标 org/space
cf target -o <your-org> -s <your-space>
```

### 3.3 确认 AI Core 服务实例

```bash
# 查看现有服务实例
cf services

# 如果没有 AI Core 实例，先创建
cf create-service sap-aicore extended aicore
```

---

## 4. 阶段一：从 Anthropic API 迁移到 SAP AI Core

> **目的：** 将 `srv/lib/claude-client.js` 从直连 Anthropic SDK 改为通过 SAP AI Core Generative AI Hub 调用 LLM，实现统一管控、Cost 监控、和多模型支持。

### 4.1 安装 SAP AI SDK

```bash
npm install @sap-ai-sdk/foundation-models @sap-ai-sdk/ai-api
```

更新 `package.json` 依赖部分：

```json
{
  "dependencies": {
    "@sap/cds": "^8",
    "express": "^4",
    "@sap-ai-sdk/foundation-models": "^1",
    "@sap-ai-sdk/ai-api": "^1"
  }
}
```

> **说明：** `@anthropic-ai/sdk` 可保留作为本地开发 fallback，通过环境变量 `AI_PROVIDER` 控制切换。

### 4.2 创建 AI Core 服务绑定（本地开发）

AI Core SDK 需要读取服务绑定凭证。本地开发时，通过 `.env` 或 `default-env.json` 提供：

```bash
# 获取 AI Core 服务密钥（先在 BTP 控制台创建 Service Key）
cf create-service-key aicore onboarding-aicore-key
cf service-key aicore onboarding-aicore-key
```

将输出的 JSON 保存为 `default-env.json`（**不要提交到 Git！**）：

```json
{
  "VCAP_SERVICES": {
    "sap-aicore": [
      {
        "name": "onboarding-aicore",
        "credentials": {
          "serviceurls": {
            "AI_API_URL": "https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com"
          },
          "clientid": "sb-<your-client-id>",
          "clientsecret": "<your-secret>",
          "url": "https://<your-tenant>.authentication.eu10.hana.ondemand.com",
          "identityzone": "<your-zone>"
        }
      }
    ]
  }
}
```

在 `.gitignore` 中添加：
```
default-env.json
```

### 4.3 在 AI Launchpad 中部署 LLM

> **说明：** 本节创建的是底层 LLM Deployment（`aicore` 模式用）。如果你计划使用 Orchestration Service（`orchestration` 模式，推荐），本节同样需要完成，因为 Orchestration Configuration 必须引用一个运行中的 Deployment——详见 5.6 节。

登录 SAP AI Launchpad（`https://<your-ailaunchpad-url>.cfapps.eu10.hana.ondemand.com`）：

1. 进入 **Workspaces** → 选择你的 AI Core 实例
2. 进入 **ML Operations** → **Configurations** → **Create**
   - **Scenario:** `foundation-models`
   - **Executable:** `azure-openai` 或 `anthropic`（取决于采购的模型）
   - **Version:** 选择最新版本
3. 进入 **ML Operations** → **Deployments** → **Create Deployment**
   - 选择上一步的 Configuration
   - Resource Plan: `infer.s`（小型推理，够用）
   - 等待 Status 变为 **Running**（约 2-5 分钟）
4. 复制 **Deployment ID**（格式如 `d1234567890abcdef`），后续代码和 Orchestration 配置中会用到

### 4.4 修改 claude-client.js（迁移到 AI Core）

将 `srv/lib/claude-client.js` 改写如下：

```javascript
// srv/lib/claude-client.js
'use strict';

// ─── 双模式支持：本地用 Anthropic 直连，BTP 用 AI Core ─────────────
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic'; // 'anthropic' | 'aicore'

let _anthropicClient = null;
let _aicoreClient = null;

function getAnthropicClient() {
  if (!_anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    const options = { apiKey: process.env.ANTHROPIC_API_KEY };
    if (process.env.ANTHROPIC_BASE_URL) options.baseURL = process.env.ANTHROPIC_BASE_URL;
    _anthropicClient = new Anthropic(options);
  }
  return _anthropicClient;
}

function getAICoreClient() {
  if (!_aicoreClient) {
    const { AzureOpenAiChatClient } = require('@sap-ai-sdk/foundation-models');
    // deploymentId 来自 AI Launchpad 部署的模型实例
    _aicoreClient = new AzureOpenAiChatClient({
      deploymentId: process.env.AICORE_DEPLOYMENT_ID,
      resourceGroup: process.env.AICORE_RESOURCE_GROUP || 'default'
    });
  }
  return _aicoreClient;
}

// ─── System Prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你是一位专业的企业内部 HR 助手，专门回答员工关于公司政策、流程和福利的问题。
你的回答必须基于提供的知识库文章，不得编造信息。

规则：
1. 只根据提供的知识库文章内容回答
2. 知识库中没有相关信息时，明确告知"建议联系 HR（hr@company.com）"
3. 回答简洁清晰，使用中文，保持友好专业语气
4. 必须返回严格的 JSON 格式，不能包含 markdown 代码块
5. 引用文章时提供 articleId 列表

返回格式（纯 JSON，不加 \`\`\`）：
{
  "answer": "回答内容",
  "referencedArticleIds": ["uuid1", "uuid2"],
  "confidence": "high|medium|low"
}`;

// ─── 核心：生成回答 ────────────────────────────────────────────────────
async function generateAnswer(question, articles) {
  // 构建知识库上下文
  const knowledgeContext = articles.length > 0
    ? articles.map((a, i) => `[文章${i + 1}] ID: ${a.ID}\n标题: ${a.title}\n内容: ${a.content}`).join('\n\n---\n\n')
    : '（知识库中暂无相关文章）';

  const userMessage = `知识库文章：\n\n${knowledgeContext}\n\n员工问题：${question}`;

  let raw, promptTokens, answerTokens;

  if (AI_PROVIDER === 'aicore') {
    // ── SAP AI Core 路径 ──────────────────────────────
    const client = getAICoreClient();
    const response = await client.run({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });
    raw = response.getContent();
    promptTokens = response.getTokenUsage()?.prompt_tokens || 0;
    answerTokens = response.getTokenUsage()?.completion_tokens || 0;
  } else {
    // ── Anthropic 直连路径（本地开发）──────────────────
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });
    raw = response.content[0].text;
    promptTokens = response.usage.input_tokens;
    answerTokens = response.usage.output_tokens;
  }

  // ─── 解析 JSON 响应（兼容 markdown 包裹）──────────────
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    parsed = { answer: raw, referencedArticleIds: [], confidence: 'low' };
  }

  return {
    answer: parsed.answer || raw,
    referencedArticleIds: parsed.referencedArticleIds || [],
    promptTokens,
    answerTokens
  };
}

module.exports = { generateAnswer };
```

### 4.5 更新环境变量

`.env`（本地开发保持 Anthropic）：
```env
# 本地开发：使用 Anthropic 直连
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key-here
ANTHROPIC_BASE_URL=http://localhost:6655/anthropic

# BTP 部署时改为：
# AI_PROVIDER=aicore
# AICORE_DEPLOYMENT_ID=d1234567890abcdef
# AICORE_RESOURCE_GROUP=default
```

---

## 5. 阶段二：使用 Orchestration Service（AI Launchpad）

> **目的：** 使用 AI Launchpad 的 Orchestration Service 实现更强大的 AI 管道：Prompt 模板管理、Grounding（文档检索增强）、内容过滤。

### 5.1 安装 Orchestration SDK

```bash
npm install @sap-ai-sdk/orchestration
```

### 5.2 Orchestration Service 核心概念

```
用户请求
    │
    ▼
Orchestration Pipeline:
┌─────────────────────────────────────────────┐
│  1. Input Filtering（内容安全过滤）           │
│  2. Prompt Template（动态变量注入）           │
│  3. Grounding（文档检索/RAG 增强）           │
│     └─ Document Store → 向量检索 → 注入上下文│
│  4. LLM Call（GPT-4o / Claude 等）           │
│  5. Output Filtering（输出合规检查）          │
└─────────────────────────────────────────────┘
    │
    ▼
结构化响应
```

### 5.2.1 Document Grounding 说明

**Document Grounding** 是 Orchestration Service 内置的 RAG（检索增强生成）能力，让 LLM 能够基于你上传的文档回答问题，无需在代码里手动做检索和上下文拼接。

**工作原理：**

```
上传文档（PDF/TXT/MD）
    │
    ▼
Document Store（AI Core 管理的向量数据库）
    │  文档被自动分块并向量化（Embedding）
    ▼
用户提问 ──► Orchestration Pipeline
                    │
                    ▼
             Grounding 模块：
             用问题向量检索最相关的文档片段
                    │
                    ▼
             将检索结果自动注入 Prompt Template
                    │
                    ▼
                 LLM 回答
```

**与本项目当前方案的对比：**

| | 当前方案（代码检索） | Document Grounding |
|--|----|----|
| 检索逻辑 | `knowledge-service.js` 中手动 LIKE 查询 | Orchestration 内置向量检索 |
| 知识库存储 | HANA / SQLite 数据库 | AI Core Document Store |
| 语义理解 | 仅关键词匹配 | 向量相似度，语义更准确 |
| 维护成本 | 需自行维护检索代码 | 上传文档即可，无需改代码 |

> **本项目建议：** 当前阶段继续使用代码检索方案（知识库已存在 HANA 中）。如果未来知识库文档数量增大、或关键词检索准确率不够，可迁移到 Document Grounding。迁移步骤见 5.2.2 节。

### 5.2.2 启用 Document Grounding（可选）

> ⚠️ 本节为可选内容，当前项目暂不启用。如需启用，按以下步骤操作。

Document Grounding 使用 S3 兼容的对象存储作为文档来源。本项目使用 **BTP Object Store Service** 存放知识库文档文件。

整体流程：

```
BTP Object Store（存放文档文件）
        │
        ▼
AI Launchpad Grounding Management（向量化 + 检索）
        │
        ▼
Orchestration Configuration（启用 Grounding 模块）
```

**步骤一：创建 BTP Object Store 实例**

```bash
# 创建 Object Store 实例（S3 兼容）
cf create-service objectstore s3-standard onboarding-kb-objectstore

# 创建 Service Key 获取访问凭证
cf create-service-key onboarding-kb-objectstore onboarding-kb-os-key
cf service-key onboarding-kb-objectstore onboarding-kb-os-key
```

输出的凭证 JSON 中记录以下信息，后续配置 Grounding 时需要用到：

| 字段 | 用途 |
|------|------|
| `access_key_id` | S3 访问密钥 ID |
| `secret_access_key` | S3 访问密钥 |
| `bucket` | Bucket 名称 |
| `host` | S3 Endpoint URL |
| `region` | 区域 |

**步骤二：导出知识库文章为 txt 文件**

项目中提供了导出脚本，从 CSV 数据源批量生成 txt 文件：

```bash
node scripts/export-articles.js
```

输出到 `docs/grounding/` 目录，每篇文章一个文件，格式如下：

```
标题：年假申请流程
摘要：年假天数、申请流程、HR系统操作步骤
标签：年假,假期,申请,HR系统

## 年假政策
...
```

**步骤三：上传文档到 Object Store**

将凭证 JSON 文件（`onboarding-kb-objectstore.json`，**不要提交到 Git**）保存到项目根目录，然后运行上传脚本：

```bash
# 在 scripts/ 目录下执行（依赖装在该目录）
cd scripts
node upload-to-objectstore.js
```

脚本会自动读取 `onboarding-kb-objectstore.json` 中的凭证，将 `docs/grounding/` 下所有 `.txt` 文件上传到 Object Store Bucket。

> **注意：** `onboarding-kb-objectstore.json` 已加入 `.gitignore`，不会被提交。如果知识库文章有更新，重新运行步骤二和步骤三即可同步。

**步骤四：在 AI Launchpad 中创建 Generic Secret**

Grounding Management 的 Generic Secret 下拉框需要先创建 Generic Secret 才能选择（Object Store Secret 是另一种类型，无法在这里使用）：

1. 进入 **SAP AI Core Administration** → **Generic Secrets** → **Create**
2. 填写以下信息（从 `onboarding-kb-objectstore.json` 取值）：
   - **Name**: `onboarding-kb-s3`（自定义，后续引用）
   - **Resource Group**: 与后续 Grounding Data Repository 保持一致（如 `default`）
   - **Data**（key-value 格式）：
     - `AWS_ACCESS_KEY_ID` = `access_key_id` 字段值
     - `AWS_SECRET_ACCESS_KEY` = `secret_access_key` 字段值
3. 保存

> **说明：** Object Store Secret 和 Generic Secret 是两种不同类型，Grounding Management 只识别 Generic Secret。

**步骤五：在 AI Launchpad 中配置 Grounding Data Repository**

1. 进入 **Generative AI Hub** → **Grounding Management** → **Create**
2. 填写连接信息：
   - **Document Store Type**: `S3`
   - **Document Grounding Generic Secret**: 选择步骤四中创建的 `onboarding-kb-s3`
3. 保存，Data Repository 创建成功
4. 等待状态从 **Pending** 变为 **Completed**（后台在读取、分块、向量化文档，通常几分钟内完成）
5. 状态变为 **Completed** 后可以看到已处理的文件列表，记录 **Collection ID**

**步骤六：在 Orchestration Configuration 中启用 Grounding 模块**

1. 进入 **Generative AI Hub** → **Orchestration** → 你的 Configuration → **Edit**
2. 启用 **Grounding** 模块，填写：
   - Collection ID: 步骤五中记录的 Collection ID
   - Max Chunks: `5`（每次检索返回最相关的 5 个片段）
3. 保存 Configuration

> 启用 Grounding 后，Orchestration 会自动用用户的问题做向量检索，将最相关的文档片段注入 Prompt，无需修改任何代码。

### 5.3 关于代码侧配置 vs AI Launchpad 配置

> **重要说明：** AI Launchpad 中的 Orchestration Configuration（5.6 节配置的 Prompt Template、Grounding、Filters）是**仅供 UI 测试用的**（点击 Run 按钮时使用）。通过 SDK 代码调用时，管道配置必须在代码中重新定义并传给 `OrchestrationClient`——两套配置相互独立。
>
> 因此代码侧的 `orchestration-client.js` 需要完整定义管道（LLM、Prompt Template、Grounding、Filters），与 AI Launchpad 中的配置保持一致。

### 5.4 创建 Orchestration Client

新建 `srv/lib/orchestration-client.js`：

> **注意：** `@sap-ai-sdk/orchestration` 是 ESM 模块，在 CAP Node.js（CommonJS）环境中必须用 `await import()` 动态导入，不能用 `require()`。

```javascript
// srv/lib/orchestration-client.js
'use strict';

let _orchestrationClient = null;

async function getOrchestrationClient() {
  if (!_orchestrationClient) {
    const {
      OrchestrationClient,
      buildAzureContentSafetyFilter,
      buildDocumentGroundingConfig
    } = await import('@sap-ai-sdk/orchestration');

    const groundingEnabled = process.env.AICORE_GROUNDING_ENABLED === 'true';

    const systemContent = groundingEnabled
      ? `你是一位专业的企业内部 HR 助手。
只根据知识库中的内容回答问题，不得编造。
如知识库无相关信息，告知联系 hr@company.com。
使用中文回答，返回 JSON 格式：{"answer":"...","referencedArticleIds":["..."]}

知识库参考内容：{{?grounding_output_variable}}`
      : `你是一位专业的企业内部 HR 助手。
只根据知识库中的内容回答问题，不得编造。
如知识库无相关信息，告知联系 hr@company.com。
使用中文回答，返回 JSON 格式：{"answer":"...","referencedArticleIds":["..."]}`;

    const config = {
      promptTemplating: {
        model: { name: 'gpt-4o', params: { max_tokens: 1024, temperature: 0.3 } },
        prompt: {
          template: [
            {
              role: 'system',
              content: systemContent
            },
            { role: 'user', content: `员工问题：{{?question}}` }
          ]
        }
      },
      filtering: {
        input: { filters: [buildAzureContentSafetyFilter('input')] },
        output: { filters: [buildAzureContentSafetyFilter('output')] }
      },
      ...(groundingEnabled && {
        grounding: buildDocumentGroundingConfig({
          filters: [{ data_repositories: ['*'] }],
          placeholders: { input: ['question'], output: 'grounding_output_variable' }
        })
      })
    };

    _orchestrationClient = new OrchestrationClient(config, {
      resourceGroup: process.env.AICORE_RESOURCE_GROUP || 'default'
    });
  }
  return _orchestrationClient;
}

async function generateAnswerWithOrchestration(question) {
  const client = await getOrchestrationClient();

  try {
    const response = await client.chatCompletion({
      placeholderValues: { question }
    });

    const raw = response.getContent();
    const usage = response.getTokenUsage();

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      parsed = { answer: raw, referencedArticleIds: [] };
    }

    return {
      answer: parsed.answer || raw,
      referencedArticleIds: parsed.referencedArticleIds || [],
      promptTokens: usage?.prompt_tokens || 0,
      answerTokens: usage?.completion_tokens || 0
    };
  } catch (err) {
    if (err.message?.includes('content_filter')) {
      return {
        answer: '您的问题包含不当内容，无法处理。如有需要，请联系 HR（hr@company.com）。',
        referencedArticleIds: [],
        promptTokens: 0,
        answerTokens: 0
      };
    }
    throw err;
  }
}

module.exports = { generateAnswerWithOrchestration };
```

> **说明：** `orchestration-config.js` 为可选文件，当前版本已将配置内联到 `orchestration-client.js` 中以避免跨模块 ESM 导入问题。

### 5.5 更新 claude-client.js 以支持 Orchestration

修改 `srv/lib/claude-client.js` 中的 `generateAnswer`，增加第三种模式：

```javascript
// 在 generateAnswer 函数中新增 orchestration 分支
const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';
// AI_PROVIDER 可选值：
//   'anthropic'     - 本地直连 Anthropic（开发用）
//   'aicore'        - AI Core Generative AI Hub（生产推荐）
//   'orchestration' - AI Core Orchestration Service（含过滤/模板，企业级推荐）

async function generateAnswer(question, articles) {
  if (AI_PROVIDER === 'orchestration') {
    const { generateAnswerWithOrchestration } = require('./orchestration-client');
    return generateAnswerWithOrchestration(question);  // Grounding 自动检索，无需传 articles
  }
  // ... 其余代码不变
}
```

### 5.6 在 AI Launchpad 中配置 Orchestration

> **前置条件：** 必须先完成 4.3 节的步骤（LLM Deployment 处于 Running 状态），才能继续本节。

Orchestration Service 的启用分三层，缺任何一层都无法使用：

```
ML Operations → Configuration (scenario: orchestration)
        │
        ▼
ML Operations → Deployment (基于上面的 Configuration)
        │  Running 之后才解锁↓
        ▼
Generative AI Hub → Orchestration → Create Configuration（管道配置）
```

**步骤一：在 ML Operations 中创建 Orchestration Configuration**

1. 登录 **AI Launchpad**，进入你的 Workspace
2. 进入 **ML Operations** → **Configurations** → **Create**
   - **Scenario:** `orchestration`（注意：不是 `foundation-models`，这是专门给 Orchestration Service 用的）
   - **Executable:** `orchestration`
   - **Version:** 选择最新版本
3. 保存 Configuration

**步骤二：创建 Orchestration Deployment**

1. 进入 **ML Operations** → **Deployments** → **Create Deployment**
   - 选择步骤一创建的 `orchestration` Configuration
   - Resource Plan: `infer.s`
2. 等待 Deployment Status 变为 **Running**（约 2-5 分钟）

> 完成步骤二后，**Generative AI Hub → Orchestration** 中的 Create 按钮才会解锁。

**步骤三：在 Generative AI Hub 中创建 Orchestration Configuration（管道配置）**

1. 进入 **Generative AI Hub** → **Orchestration** → **Create**
2. 填写配置：
   - 名称：`onboarding-kb-assistant`
   - LLM：选择 4.3 节中处于 Running 状态的 LLM Deployment
   - Input Filter：启用 Azure Content Safety
   - Output Filter：启用 Azure Content Safety
3. 启用 **Grounding** 模块：
   - 选择步骤五创建的 Data Repository
   - Output Variable 默认为 `grounding_output_variable`，保持默认即可
4. 配置 **Prompt Template**：
   - system message 中加入 `{{?grounding_output_variable}}`，让 Grounding 检索结果注入 Prompt：
     ```
     你是一位专业的企业内部 HR 助手。
     只根据知识库中的内容回答问题，不得编造。
     如知识库无相关信息，告知联系 hr@company.com。
     使用中文回答，返回 JSON 格式：{"answer":"...","referencedArticleIds":["..."]}

     知识库参考内容：{{?grounding_output_variable}}
     ```
   - user message：`员工问题：{{?question}}`
   - **注意：** Variable Definitions 中 `grounding_output_variable` 必须在 Prompt 中被引用，否则会出现 warning 且检索结果不会传给 LLM
5. 点击 **Run** 测试，确认回答结果正常
6. 保存并记录 **Configuration ID**
7. 将 Configuration ID 设为环境变量 `AICORE_ORCHESTRATION_CONFIG_ID`

> **说明：** ML Operations 里有两种 Deployment：`foundation-models`（LLM 实例，4.3 节创建）和 `orchestration`（Orchestration Service 实例，本节步骤二创建）。Generative AI Hub → Orchestration 的管道配置同时依赖这两者。

---

## 6. 阶段三：BTP 基础服务配置

### 6.1 创建 xs-security.json（XSUAA）

在项目根目录创建 `xs-security.json`：

```json
{
  "xsappname": "onboarding-kb-assistant",
  "tenant-mode": "dedicated",
  "description": "员工入职知识库助手 - 权限配置",
  "scopes": [
    {
      "name": "$XSAPPNAME.admin",
      "description": "HR Admin: 管理知识库文章"
    },
    {
      "name": "$XSAPPNAME.user",
      "description": "Employee: 使用知识库问答"
    }
  ],
  "role-templates": [
    {
      "name": "KBAdmin",
      "description": "知识库管理员，可增删改查知识库文章",
      "scope-references": ["$XSAPPNAME.admin", "$XSAPPNAME.user"]
    },
    {
      "name": "KBUser",
      "description": "普通员工，只能查询和提问",
      "scope-references": ["$XSAPPNAME.user"]
    }
  ],
  "role-collections": [
    {
      "name": "KB_Admin",
      "description": "知识库管理员角色集合",
      "role-template-references": [
        "$XSAPPNAME.KBAdmin"
      ]
    },
    {
      "name": "KB_User",
      "description": "普通员工角色集合",
      "role-template-references": [
        "$XSAPPNAME.KBUser"
      ]
    }
  ],
  "oauth2-configuration": {
    "redirect-uris": [
      "https://*.cfapps.eu10.hana.ondemand.com/**",
      "https://*.cfapps.eu10-004.hana.ondemand.com/**"
    ]
  }
}
```

### 6.2 创建 App Router 配置

创建目录和文件：

```bash
mkdir approuter
```

创建 `approuter/xs-app.json`：

```json
{
  "welcomeFile": "/chat-ui5/index.html",
  "authenticationMethod": "route",
  "logout": {
    "logoutEndpoint": "/do/logout",
    "logoutPage": "/chat-ui5/index.html"
  },
  "routes": [
    {
      "source": "^/kb-manager/(.*)$",
      "target": "/kbmanager/$1",
      "service": "html5-apps-repo-rt",
      "authenticationType": "xsuaa",
      "scope": ["$XSAPPNAME.admin"]
    },
    {
      "source": "^/chat-ui5/(.*)$",
      "target": "/onboarding.kb.chat/$1",
      "service": "html5-apps-repo-rt",
      "authenticationType": "xsuaa",
      "scope": ["$XSAPPNAME.user"]
    },
    {
      "source": "^/admin/(.*)",
      "target": "/admin/$1",
      "destination": "onboarding-kb-srv",
      "authenticationType": "xsuaa",
      "scope": ["$XSAPPNAME.admin"],
      "csrfProtection": true
    },
    {
      "source": "^/api/(.*)",
      "target": "/api/$1",
      "destination": "onboarding-kb-srv",
      "authenticationType": "xsuaa",
      "scope": ["$XSAPPNAME.user"]
    }
  ]
}
```

创建 `approuter/package.json`：

```json
{
  "name": "onboarding-kb-approuter",
  "version": "1.0.0",
  "dependencies": {
    "@sap/approuter": "^16"
  },
  "scripts": {
    "start": "node node_modules/@sap/approuter/approuter.js"
  }
}
```

### 6.3 更新前端 manifest.json（指向 App Router 路由）

更新 `app/kb-manager/webapp/manifest.json` 中的数据源：

```json
{
  "sap.app": {
    "dataSources": {
      "mainService": {
        "uri": "/admin/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  }
}
```

更新 `app/chat-ui5/webapp/manifest.json` 中的数据源：

```json
{
  "sap.app": {
    "dataSources": {
      "mainService": {
        "uri": "/api/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  }
}
```

### 6.4 更新 CAP 服务以支持 XSUAA 鉴权

修改 `package.json` 中的 CDS 配置，增加 production 模式配置：

```json
{
  "cds": {
    "requires": {
      "db": {
        "kind": "sqlite",
        "credentials": { "database": "db.sqlite" }
      },
      "[production]": {
        "db": {
          "kind": "hana"
        },
        "auth": {
          "kind": "xsuaa"
        },
        "aicore": {
          "kind": "sap-aicore"
        }
      }
    }
  }
}
```

更新 `srv/knowledge-service.cds`，添加权限注解：

```cds
using onboarding.kb as db from '../db/schema';

// ─── HR 管理服务（需要 admin scope）─────────────────────────
@(requires: 'admin')
service AdminService @(path: '/admin') {
  entity Categories as projection on db.Categories;

  @odata.draft.enabled
  entity KnowledgeArticles as projection on db.KnowledgeArticles {
    *, category.name as categoryName: String @readonly
  };

  @readonly
  entity ChatSessions as projection on db.ChatSessions;
}

// ─── 员工知识库服务（需要 user scope）────────────────────────
@(requires: ['admin', 'user'])
service KnowledgeService @(path: '/api') {
  @readonly
  entity KnowledgeArticles as select from db.KnowledgeArticles {
    ID, title, summary, tags, createdAt,
    category.name as categoryName
  } where isActive = true;

  entity ChatSessions as projection on db.ChatSessions;
  entity ChatMessages as projection on db.ChatMessages;

  action askQuestion(sessionId: UUID, question: String(2000)) returns {
    messageId: UUID;
    sessionId: UUID;
    answer: LargeString;
    referencedArticles: many { articleId: UUID; title: String; relevance: Decimal; };
  };

  action rateAnswer(messageId: UUID, rating: Integer) returns Boolean;
}
```

---

## 7. 阶段四：HANA Cloud 数据库迁移

### 7.1 安装 HANA 依赖

`@cap-js/hana` 已加入 `dependencies`（非 devDependencies），确保 BTP 上可用：

```bash
npm install
```

验证 `package.json` 的 `dependencies` 中包含 `"@cap-js/hana": "^1"`，以及 `cds.requires` 中有 `[production]` profile：

```json
"cds": {
  "requires": {
    "db": {
      "kind": "sqlite",
      "credentials": { "database": "db.sqlite" }
    },
    "[production]": {
      "db": { "kind": "hana" },
      "auth": { "kind": "xsuaa" }
    }
  }
}
```

### 7.2 生成 HANA 部署产物

```bash
# 生成 gen/ 目录，包含 HANA HDI 文件
cds build --production
```

成功后 `gen/db/src/gen/` 下会有 `.hdbtable`、`.hdbview`、`.hdbtabledata` 等文件。

### 7.3 Raw SQL 已迁移为 CQL（已完成）

`srv/knowledge-service.js` 中所有 Raw SQL 已改写为 CDS Query Language，可自动适配 SQLite（本地）和 HANA（生产）：

| 原 Raw SQL | 已改写为 CQL |
|---|---|
| `db.run('SELECT ... FROM onboarding_kb_...')` | `SELECT.from(KnowledgeArticles).columns(...).where(...)` |
| `db.run('INSERT INTO onboarding_kb_ChatSessions ...')` | `INSERT.into(ChatSessions).entries({...})` |
| `db.run('UPDATE onboarding_kb_ChatMessages SET rating ...')` | `UPDATE(ChatMessages).set({rating}).where({ID})` |
| `datetime('now')` | `new Date()` |

无需手动修改任何代码。

---

## 8. 阶段五：MTA 多目标应用打包

### 8.1 配置文件（已创建）

以下文件已就绪，无需手动创建：

| 文件 | 说明 |
|------|------|
| `mta.yaml` | MTA 部署描述符 |
| `xs-security.json` | XSUAA 权限配置 |
| `approuter/xs-app.json` | App Router 路由规则 |
| `approuter/package.json` | App Router 依赖声明 |

`app/kb-manager/ui5.yaml` 和 `app/chat-ui5/ui5.yaml` 已加入 `framework` 声明，`npm run build` 脚本已加入 `--include-task generateManifestBundle` 参数。

### 8.2 mta.yaml 说明

当前 `mta.yaml` 的关键设计：

- **AI Core** 引用 CF Space 中已有的服务实例（`existing-service`，名称 `aicore`）
- **html5-apps-repo** 使用 `managed-service`，分两个 plan：`app-host`（上传 UI）和 `app-runtime`（运行时访问）
- **html5 模块类型**必须用 `com.sap.application.content`，不能用 `html5`（后者在 mbt build 时无法正确打包 zip artifact，导致 html5-host 没有内容上传）
- **build-result** 指向 `ui5-task-zipper` 生成的 zip 文件路径（`dist/kbmanager.zip` / `dist/onboarding.kb.chat.zip`）
- **html5 模块**需要在 `requires` 中加 `content-target: true`，否则 MTA 部署器会跳过上传步骤
- **xs-app.json** 必须通过 `ui5-task-zipper` 的 `additionalFiles` 打包进每个 UI zip 内，HTML5 repo 依赖它做路由
- **sap.cloud.public: true** 必须在每个 app 的 `manifest.json` 里声明，否则 app 不会出现在 BTP Cockpit HTML5 Applications 列表
- **xs-app.json 路由 target** 必须和 `manifest.json` 的 `sap.app.id` 对应：`kb-manager` → `/kbmanager/$1`，`chat-ui5` → `/onboarding.kb.chat/$1`
- **全局参数** 必须包含 `deploy_mode: html5-repo`，否则 html5-host 上传步骤不会触发
- **Object Store 凭证**（`OS_*` 变量）不在 `mta.yaml` 中，部署后通过 `cf set-env` 注入（见 9.3 节）

html5 模块正确写法示例（已验证可工作）：

```yaml
parameters:
  deploy_mode: html5-repo
  enable-parallel-deployments: true

modules:
  - name: onboarding-kb-manager-ui
    type: com.sap.application.content
    path: app/kb-manager
    build-parameters:
      builder: custom
      commands:
        - npm ci --prefer-offline
        - npm run build         # ui5 build，ui5-task-zipper 生成 kbmanager.zip
      build-result: dist/kbmanager.zip
      supported-platforms: []
      timeout: 0
    requires:
      - name: onboarding-kb-html5-host
        parameters:
          content-target: true
```

**ui5-task-zipper 配置**（`ui5.yaml` 中）：

```yaml
builder:
  customTasks:
    - name: ui5-task-zipper
      afterTask: generateResourcesJson
      configuration:
        archiveName: kbmanager      # 生成 dist/kbmanager.zip
        additionalFiles:
          - xs-app.json             # 必须打包进 zip
```

**manifest.json 必须包含**：

```json
"sap.cloud": {
  "public": true,
  "service": "kbmanager"
}
```

> **注意：** 如果你的 CF Space 里 AI Core 实例名不是 `aicore`，先运行 `cf services` 确认实际名称，再修改 `mta.yaml` 中对应的 `service-name`。

> **常见坑：** 曾尝试使用 `type: html5` + 独立 `com.sap.application.content` 两层结构（仿照 captutorial 样例），但 mbt 会将 `resources/` 目录重新压缩成单个 `data.zip`，导致 html5-host 收到的不是正确的 app zip。正确做法是每个 UI app 单独一个 `com.sap.application.content` 模块，`build-result` 直接指向 zip 文件。

### 8.3 安装 approuter 依赖

```bash
cd approuter && npm install && cd ..
```

### 8.4 构建 MTA 包

> **前置条件：** `mbt`（MTA Build Tool）需要能下载 Go 二进制。如果公司网络屏蔽 GitHub，参考下方"mbt 安装问题"。

```bash
# 确认 cds build 产物存在
ls gen/db gen/srv

# 打包
mbt build -t ./

# 输出：onboarding-kb-assistant_1.0.0.mtar
```

**mbt 安装问题（GitHub 网络受限）：**

`mbt` 的 Go 二进制从 GitHub Releases 下载，公司网络可能超时。解决方法：

1. 在能访问 GitHub 的环境下载：
   `https://github.com/SAP/cloud-mta-build-tool/releases/tag/v1.2.45`
   → 下载 `cloud_mta_build_tool_Windows_amd64.tar.gz`
2. 解压，将 `mbt.exe` 放到：
   `C:\Users\<你的用户名>\AppData\Roaming\npm\node_modules\mbt\unpacked_bin\`
3. 验证：`mbt --version`

---

## 9. 阶段六：CF 部署与验证

### 9.1 部署到 Cloud Foundry

```bash
# 登录（如尚未登录）
cf login -a https://api.cf.eu12.hana.ondemand.com
cf target -o <your-org> -s <your-space>

# 部署（约 5-15 分钟）
cf deploy onboarding-kb-assistant_1.0.0.mtar

# 查看应用状态
cf apps
```

期望输出：
```
name                        requested state   instances
onboarding-kb-srv           started           1/1
onboarding-kb-db-deployer   stopped           0/1   (deployer 完成后自动停止)
onboarding-kb-approuter     started           1/1
```

### 9.2 部署后注入环境变量

`mta.yaml` 中仅包含非敏感配置。Object Store 凭证和 AI 配置需部署后手动注入：

```bash
# AI 配置
cf set-env onboarding-kb-srv AICORE_RESOURCE_GROUP onboarding-kb-assistant
cf set-env onboarding-kb-srv AICORE_GROUNDING_ENABLED true

# Object Store（从 BTP Cockpit → Object Store 实例 → Service Key 获取）
cf set-env onboarding-kb-srv OS_BUCKET <bucket-name>
cf set-env onboarding-kb-srv OS_HOST <s3-endpoint>
cf set-env onboarding-kb-srv OS_REGION eu-central-1
cf set-env onboarding-kb-srv OS_ACCESS_KEY_ID <access-key-id>
cf set-env onboarding-kb-srv OS_SECRET_ACCESS_KEY <secret-access-key>

cf restart onboarding-kb-srv
```

### 9.3 配置 AI Deployment ID（重要！）

部署后回到 AI Launchpad 确认 Deployment 状态，然后：

```bash
cf set-env onboarding-kb-srv AICORE_DEPLOYMENT_ID d1234567890abcdef
cf restart onboarding-kb-srv
```

### 9.4 分配角色并验证

1. 登录 **BTP Cockpit** → 你的 Subaccount
2. 进入 **Security** → **Role Collections**
3. 找到 `KB_Admin` 和 `KB_User`，分配给对应用户
4. 访问 App Router URL 验证：

```bash
cf app onboarding-kb-approuter | grep routes
```

访问路径：
- 员工聊天：`https://onboarding-kb-approuter.cfapps.eu12.hana.ondemand.com/chat-ui5/`
- 管理员界面：`https://onboarding-kb-approuter.cfapps.eu12.hana.ondemand.com/kb-manager/`

---

## 10. 阶段七：AI Launchpad 配置与监控

### 10.1 登录 AI Launchpad

```
URL: https://<your-ailaunchpad>.cfapps.eu10.hana.ondemand.com
```

在 BTP Cockpit → Service Marketplace 中找到 **AI Launchpad** 并访问。

### 10.2 Workspaces 配置

1. 进入 **Workspaces** → **Add**
2. 填写：
   - Name: `onboarding-kb`
   - Connection: 选择 `onboarding-kb-aicore` 实例
3. Save

### 10.3 模型部署管理

**查看已部署模型：**
1. 进入 Workspace → **ML Operations** → **Deployments**
2. 确认 `onboarding-kb-assistant` 部署的 Status 为 **Running**
3. 记录 Current URL（即 Deployment Endpoint）

**监控模型使用：**
1. 进入 **ML Operations** → **Deployments** → 点击你的 Deployment
2. 查看 **Metrics** 标签：请求数、延迟、错误率
3. 查看 **Logs** 标签：每次 LLM 调用的详细日志

### 10.4 Orchestration Service 管理

1. 进入 Workspace → **Orchestration**
2. 查看 **Configurations**：确认 `onboarding-kb-assistant-v1` 配置存在
3. **Test** 标签：可直接在 Launchpad 中测试 Orchestration 管道
4. **Metrics**：查看 Token 用量、请求统计、过滤触发次数

### 10.5 成本监控

1. BTP Cockpit → **Usage** → **Services**
2. 筛选 `sap-aicore`，查看 Token 消耗账单
3. 建议设置 **Quota Alert**：AI Core → Quota Management → 设置每月 Token 上限

### 10.6 模型切换（无需重新部署代码）

如需切换 LLM（如从 GPT-4o 换为 Claude 3.5），只需：

1. 在 AI Launchpad → **Deployments** → 创建新 Deployment（选择 Claude 3.5）
2. 等待新 Deployment 变为 **Running**
3. 更新环境变量：
   ```bash
   cf set-env onboarding-kb-srv AICORE_DEPLOYMENT_ID <new-deployment-id>
   cf restart onboarding-kb-srv
   ```
4. 无需修改任何代码！

---

## 11. 环境变量与 Secret 管理

### 11.1 本地开发环境变量（.env）

```env
# ── AI Provider 选择 ────────────────────────────────────────────
# 本地开发用 anthropic，BTP 用 orchestration
AI_PROVIDER=anthropic

# ── Anthropic 直连（AI_PROVIDER=anthropic 时使用）──────────────
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
ANTHROPIC_BASE_URL=http://localhost:6655/anthropic   # 公司代理（可选）
CLAUDE_MODEL=claude-sonnet-4-6

# ── SAP AI Core（AI_PROVIDER=aicore 或 orchestration 时使用）──
AICORE_DEPLOYMENT_ID=d1234567890abcdef
AICORE_RESOURCE_GROUP=onboarding-kb-assistant
AICORE_ORCHESTRATION_CONFIG_ID=orch-config-xxxxx
AICORE_GROUNDING_ENABLED=true
```

### 11.2 BTP/CF 环境变量

`mta.yaml` 的 `properties` 块注入非敏感配置（`AI_PROVIDER`、`AICORE_RESOURCE_GROUP` 等）。
敏感凭证部署后通过 `cf set-env` 手动注入：

```bash
# AI 配置
cf set-env onboarding-kb-srv AICORE_DEPLOYMENT_ID d1234567890abcdef
cf set-env onboarding-kb-srv AICORE_RESOURCE_GROUP onboarding-kb-assistant
cf set-env onboarding-kb-srv AICORE_GROUNDING_ENABLED true

# Object Store（从 BTP Cockpit → Object Store 实例 → Service Key 获取）
cf set-env onboarding-kb-srv OS_BUCKET <bucket-name>
cf set-env onboarding-kb-srv OS_HOST <s3-endpoint>
cf set-env onboarding-kb-srv OS_REGION eu-central-1
cf set-env onboarding-kb-srv OS_ACCESS_KEY_ID <access-key-id>
cf set-env onboarding-kb-srv OS_SECRET_ACCESS_KEY <secret-access-key>

cf restart onboarding-kb-srv
```

### 11.3 敏感信息处理

| 信息 | 本地 | BTP |
|------|------|-----|
| Anthropic API Key | `.env`（不提交 Git） | User-Provided Service 或 CF Env |
| AI Core 凭证 | `default-env.json`（不提交 Git） | 服务绑定（自动注入 VCAP_SERVICES） |
| HANA 连接串 | 不需要（本地用 SQLite） | HDI Container 服务绑定（自动注入） |
| XSUAA 凭证 | 不需要（本地跳过鉴权） | XSUAA 服务绑定（自动注入） |

---

## 12. 故障排查

### 12.1 AI Core 连接问题

**错误：** `Could not find service binding for sap-aicore`

```bash
# 检查服务绑定
cf env onboarding-kb-srv | grep VCAP_SERVICES

# 确认 AI Core 服务实例绑定到应用
cf services
cf bind-service onboarding-kb-srv onboarding-kb-aicore
cf restart onboarding-kb-srv
```

### 12.2 Deployment ID 无效

**错误：** `404 Not Found - Deployment not found`

1. 登录 AI Launchpad → Deployments
2. 确认 Deployment 状态为 **Running**（不是 Pending 或 Stopped）
3. 复制正确的 Deployment ID 并更新环境变量

### 12.3 HANA Cloud 实例不存在（Service broker error）

**错误：** `Service broker error: Service broker hana-broker failed with: Can not create service instance 'onboarding-kb-db': There is no database available.`

这表示 CF Space 里没有 HANA Cloud 数据库实例，HDI Container 无法创建。

**解决方案：在 BTP Cockpit 中创建 HANA Cloud 实例**

1. 登录 **BTP Cockpit** → 你的 Subaccount
2. 点击左侧菜单 **SAP HANA Cloud**（或 **Cloud Foundry** → **Spaces** → 你的 Space → **SAP HANA Cloud**）
3. 点击 **Create** → **SAP HANA Cloud, SAP HANA Database**
4. 填写：
   - Instance Name: `onboarding-kb-hana`（自定义）
   - Administrator Password: 设置并记录
   - 选择 **Free Tier** 或 最小规格（30 GB Memory）
   - **CF Mappings**：选择你的 Org 和 Space（`dev-onboarding-assistant`）
5. 点击 **Create** → 等待约 **10-15 分钟**直到状态变为 **Running**

> ⚠️ **注意：** HANA Cloud 实例是 Space 级别的资源，必须在 CF Mappings 中绑定到目标 Space，否则 Service Broker 无法发现它。

**确认实例可用后重新部署：**

```bash
# 确认 HANA 实例状态
cf marketplace -e hana

# 重新部署
cf deploy onboarding-kb-assistant_1.0.0.mtar
```

**如果 HANA Cloud 实例存在于其他 Space：**

在 BTP Cockpit → HANA Cloud 实例 → **CF Mappings** 中，将你的 Space（`dev-onboarding-assistant`）添加到映射列表，然后重新部署。

### 12.4 HANA HDI 部署失败

**错误：** `HDI deployment failed`

```bash
# 查看 DB Deployer 日志
cf logs onboarding-kb-db-deployer --recent
```

常见原因：
1. HANA Cloud 实例未启动（进 BTP Cockpit → HANA Cloud → Start）
2. HDI Container 配额不足
3. `gen/db/` 产物过旧 — 重新运行 `cds build --production` 后再部署

### 12.5 XSUAA 403 Forbidden

```bash
# 检查角色分配
# BTP Cockpit → Security → Users → 确认用户有 KB_Admin 或 KB_User 角色集合

# 检查 xs-security.json scope 名称是否与 CDS @requires 一致
# knowledge-service.cds: @(requires: 'admin')
# xs-security.json scope: "$XSAPPNAME.admin"
```

### 12.6 Content Filter 触发（Orchestration）

**错误：** `content_filter: Input/output was filtered`

```bash
# 查看 AI Launchpad → Orchestration → Metrics → Filter Events
# 调整 orchestration-config.js 中的 severity 阈值（0-6，数字越小越严格）
```

### 12.7 前端 401 未授权

```bash
# 检查 xs-app.json 中的 scope 配置
# 确认 App Router 路由中的 scope 与 xs-security.json 定义匹配

# 查看 App Router 日志
cf logs onboarding-kb-approuter --recent | grep -i "scope\|auth\|401"
```

### 12.8 常用诊断命令

```bash
# 查看所有应用状态
cf apps

# 实时日志
cf logs onboarding-kb-srv
cf logs onboarding-kb-approuter

# 查看最近日志
cf logs onboarding-kb-srv --recent

# 查看服务绑定
cf services
cf env onboarding-kb-srv

# 查看应用事件
cf events onboarding-kb-srv

# SSH 进入容器调试
cf ssh onboarding-kb-srv
```

---

## 附录 A：快速检查清单

### 部署前检查

- [ ] `npm install` 已执行（含 `@cap-js/hana`）
- [ ] `approuter/node_modules` 已安装（`cd approuter && npm install`）
- [ ] `cds build --production` 成功，`gen/db/` 和 `gen/srv/` 目录已生成
- [ ] `mbt` Go 二进制已就绪（`mbt --version` 有输出）
- [ ] `mta.yaml` 中 AI Core 服务名、html5-apps-repo-rt 服务名与 CF Space 实际名称匹配（`cf services` 核对）
- [ ] HANA Cloud 实例已在目标 CF Space 中创建并处于 **Running** 状态（BTP Cockpit → SAP HANA Cloud）
- [ ] HANA Cloud 实例的 CF Mappings 已绑定到目标 Org/Space
- [ ] AI Core 实例已在 CF Space 中创建并可见
- [ ] LLM 和 Orchestration Deployment 均在 AI Launchpad 中处于 Running 状态
- [ ] `AICORE_DEPLOYMENT_ID` 已记录，部署后通过 `cf set-env` 注入（见 9.3 节）
- [ ] Object Store Service Key 凭证已备好，部署后通过 `cf set-env` 注入（见 9.2 节）
- [ ] `.gitignore` 包含 `default-env.json` 和 `.env`

### 部署后验证

- [ ] `cf apps` 显示 srv 和 approuter 均为 `started`
- [ ] 能通过 App Router URL 访问聊天界面（需登录）
- [ ] 能通过 App Router URL 访问管理界面（需 KB_Admin 角色）
- [ ] 发送测试问题，AI 正常返回答案
- [ ] AI Launchpad Deployments → Metrics 有请求记录
- [ ] BTP Cockpit 角色集合分配完毕

---

## 附录 B：AI Launchpad 功能导航速查

| 功能 | 路径 | 本项目用途 |
|------|------|----------|
| 查看模型部署 | Workspace → ML Operations → Deployments | 获取 Deployment ID |
| 测试 LLM 调用 | Workspace → ML Operations → Deployments → Test | 快速验证模型响应 |
| Orchestration 测试 | Workspace → Orchestration → Playground | 调试 Prompt 模板 |
| Token 用量统计 | Workspace → ML Operations → Deployments → Metrics | 成本监控 |
| 内容过滤日志 | Workspace → Orchestration → Metrics | 合规审计 |
| 创建新 Configuration | Workspace → ML Operations → Configurations | 切换模型版本 |
| 查看 AI Core 日志 | Workspace → ML Operations → Deployments → Logs | 线上问题排查 |

---

*文档维护：请在每次架构变更后及时更新本文档*
