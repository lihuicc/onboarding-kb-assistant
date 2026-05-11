'use strict';

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

  const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';

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
  } else if (AI_PROVIDER === 'orchestration') {
    // ── orchestration 路径 ──────────────────
    const { generateAnswerWithOrchestration } = require('./orchestration-client');
    return generateAnswerWithOrchestration(question);
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