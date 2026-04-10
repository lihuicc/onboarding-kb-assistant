'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// 懒加载：首次调用时初始化，避免启动时报错（未配置 KEY 时）
let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY 环境变量未配置。请在 .env 文件中设置。');
    }
    const options = { apiKey: process.env.ANTHROPIC_API_KEY };
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

/**
 * 根据知识库文章和用户问题生成 AI 答案
 * @param {string} question - 用户问题
 * @param {Array}  articles - 检索到的相关文章 [{ID, title, content, summary}]
 * @returns {{ answer, referencedArticleIds, promptTokens, answerTokens }}
 */
async function generateAnswer(question, articles) {
  const client = getClient();

  // 构建知识库上下文
  const context = articles.length > 0
    ? articles.map((a, i) =>
        `--- 文章 ${i + 1} (ID: ${a.ID}) ---\n标题：${a.title}\n内容：${a.content}`
      ).join('\n\n')
    : '（当前知识库中没有检索到相关文章）';

  const userMessage = `知识库文章：\n${context}\n\n员工问题：${question}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text.trim();

  let parsed;
  try {
    // 提取第一个 { 到最后一个 } 之间的内容，兼容任何 markdown 包装
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const cleaned = jsonMatch ? jsonMatch[0] : raw;
    parsed = JSON.parse(cleaned);
  } catch {
    // 容错：AI 返回非标准 JSON
    parsed = { answer: raw, referencedArticleIds: [], confidence: 0.5 };
  }

  return {
    answer: parsed.answer || raw,
    referencedArticleIds: Array.isArray(parsed.referencedArticleIds)
      ? parsed.referencedArticleIds
      : [],
    promptTokens: response.usage.input_tokens,
    answerTokens: response.usage.output_tokens,
  };
}

module.exports = { generateAnswer };
