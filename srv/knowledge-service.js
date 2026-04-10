'use strict';

const cds = require('@sap/cds');
const { generateAnswer } = require('./lib/claude-client');

module.exports = class KnowledgeService extends cds.ApplicationService {

  async init() {
    // All DB operations go through raw SQL to avoid service-layer projection constraints
    const db = await cds.connect.to('db');

    // ─── askQuestion Handler ─────────────────────────────
    this.on('askQuestion', async (req) => {
      const { sessionId, question } = req.data;
      const userId = req.user?.id ?? 'anonymous';

      if (!question || question.trim().length === 0) {
        return req.error(400, '问题不能为空');
      }

      // 1. 从知识库检索相关文章（关键词匹配，直接走 SQL 避免 CQL builder 限制）
      const keywords = extractKeywords(question);
      let articles = [];

      if (keywords.length > 0) {
        const found = new Map();
        for (const kw of keywords) {
          const like = `%${kw}%`;
          const results = await db.run(
            `SELECT ID, title, summary, tags, content FROM onboarding_kb_KnowledgeArticles
             WHERE isActive = 1
               AND (title LIKE ? OR summary LIKE ? OR tags LIKE ? OR content LIKE ?)
             LIMIT 10`,
            [like, like, like, like]
          );
          for (const a of results) {
            if (!found.has(a.ID)) found.set(a.ID, a);
          }
          if (found.size >= 5) break;
        }
        articles = [...found.values()].slice(0, 5);
      }

      // 如果没找到相关文章，取最新的5篇作为兜底上下文
      if (articles.length === 0) {
        articles = await db.run(
          `SELECT ID, title, summary, tags, content FROM onboarding_kb_KnowledgeArticles
           WHERE isActive = 1 LIMIT 5`
        );
      }

      // 2. 调用 Claude API
      let aiResult;
      try {
        aiResult = await generateAnswer(question, articles);
      } catch (err) {
        req.error(500, `AI 服务调用失败：${err.message}`);
        return;
      }

      const { answer, referencedArticleIds, promptTokens, answerTokens } = aiResult;

      // 3. 获取或创建会话（直接用 db 避免服务层投影限制）
      let sessionID;
      if (sessionId) {
        const row = await db.run(`SELECT ID FROM onboarding_kb_ChatSessions WHERE ID = ?`, [sessionId]);
        if (!row || row.length === 0) return req.error(404, `会话 ${sessionId} 不存在`);
        sessionID = sessionId;
      } else {
        sessionID = cds.utils.uuid();
        await db.run(
          `INSERT INTO onboarding_kb_ChatSessions (ID, userId, title, status, createdAt, modifiedAt)
           VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))`,
          [sessionID, userId, question.substring(0, 50)]
        );
      }

      // 4. 保存问答消息
      const messageID = cds.utils.uuid();
      await db.run(
        `INSERT INTO onboarding_kb_ChatMessages (ID, session_ID, question, answer, promptTokens, answerTokens, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [messageID, sessionID, question, answer, promptTokens ?? 0, answerTokens ?? 0]
      );

      // 5. 保存文章引用关联
      const validArticleIds = referencedArticleIds.filter(id =>
        articles.some(a => a.ID === id)
      );

      if (validArticleIds.length > 0) {
        for (let idx = 0; idx < validArticleIds.length; idx++) {
          const articleId = validArticleIds[idx];
          const relevance = parseFloat((1 - idx * 0.1).toFixed(2));
          await db.run(
            `INSERT INTO onboarding_kb_ChatMessageArticles (message_ID, article_ID, relevance)
             VALUES (?, ?, ?)`,
            [messageID, articleId, relevance]
          );
        }
      }

      // 6. 返回结果
      return {
        messageId: messageID,
        sessionId: sessionID,
        answer,
        referencedArticles: articles
          .filter(a => validArticleIds.includes(a.ID))
          .map((a, i) => ({
            articleId: a.ID,
            title: a.title,
            relevance: parseFloat((1 - i * 0.1).toFixed(2)),
          })),
      };
    });

    // ─── rateAnswer Handler ──────────────────────────────
    this.on('rateAnswer', async (req) => {
      const { messageId, rating } = req.data;
      if (rating < 1 || rating > 5) {
        return req.error(400, '评分必须在 1-5 之间');
      }
      const result = await db.run(
        `UPDATE onboarding_kb_ChatMessages SET rating = ? WHERE ID = ?`,
        [rating, messageId]
      );
      if (result === 0) {
        return req.error(404, `消息 ${messageId} 不存在`);
      }
      return true;
    });

    await super.init();
  }
};

// ─── 工具函数 ────────────────────────────────────────────

/** 从问题中提取关键词（去除停用词） */
function extractKeywords(question) {
  const stopWords = new Set([
    '的', '是', '在', '有', '我', '怎么', '如何', '什么', '哪里', '可以',
    '吗', '呢', '啊', '了', '和', '与', '或', '请', '帮', '告诉', '问',
    '一', '这', '那', '也', '都', '会', '能', '要', '想', '需要',
  ]);
  return question
    .replace(/[？?！!。，,；;：:""''「」【】（）()]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .slice(0, 8); // 最多取8个关键词
}
