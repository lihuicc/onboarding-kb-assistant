'use strict';

const cds = require('@sap/cds');
const { generateAnswer } = require('./lib/claude-client');
const { upsertArticle, deleteArticle } = require('./lib/objectstore-client');

const GROUNDING_ENABLED = process.env.AICORE_GROUNDING_ENABLED === 'true';

module.exports = class KnowledgeService extends cds.ApplicationService {

  async init() {
    const db = await cds.connect.to('db');
    const { KnowledgeArticles, ChatSessions, ChatMessages, ChatMessageArticles } = db.entities('onboarding.kb');

    // ─── Object Store 自动同步（仅在 Grounding 启用时生效）────
    if (GROUNDING_ENABLED) {
      cds.on('served', async () => {
        const AdminSrv = await cds.connect.to('AdminService');

        AdminSrv.after(['CREATE', 'UPDATE', 'draftActivate'], 'KnowledgeArticles', async (article) => {
          if (!article?.ID) return;
          try {
            const row = await SELECT.one.from(KnowledgeArticles)
              .columns('ID', 'title', 'summary', 'tags', 'content', 'isActive')
              .where({ ID: article.ID });
            if (!row) return;
            if (row.isActive) {
              await upsertArticle(row);
              console.log(`[objectstore] 已同步文章：${row.title}`);
            } else {
              await deleteArticle(row);
              console.log(`[objectstore] 已停用文章，从 Object Store 删除：${row.title}`);
            }
          } catch (err) {
            console.error(`[objectstore] 同步失败：${err.message}`);
          }
        });

        AdminSrv.before('DELETE', 'KnowledgeArticles', async (req) => {
          try {
            const id = req.data?.ID ?? req.params?.[0]?.ID;
            if (!id) return;
            const row = await SELECT.one.from(KnowledgeArticles)
              .columns('ID', 'title')
              .where({ ID: id });
            if (row) req._articleToDelete = row;
          } catch (err) {
            console.error(`[objectstore] 删除前查询失败：${err.message}`);
          }
        });

        AdminSrv.after('DELETE', 'KnowledgeArticles', async (_, req) => {
          const row = req._articleToDelete;
          if (!row) return;
          try {
            await deleteArticle(row);
            console.log(`[objectstore] 已删除文章：${row.title}`);
          } catch (err) {
            console.error(`[objectstore] 删除失败：${err.message}`);
          }
        });
      });
    }

    // ─── askQuestion Handler ─────────────────────────────
    this.on('askQuestion', async (req) => {
      const { sessionId, question } = req.data;
      const userId = req.user?.id ?? 'anonymous';

      if (!question || question.trim().length === 0) {
        return req.error(400, '问题不能为空');
      }

      // 1. 从知识库检索相关文章
      const keywords = extractKeywords(question);
      let articles = [];

      if (keywords.length > 0) {
        const found = new Map();
        for (const kw of keywords) {
          const like = `%${kw}%`;
          const results = await SELECT.from(KnowledgeArticles)
            .columns('ID', 'title', 'summary', 'tags', 'content')
            .where({ isActive: true })
            .and(`title like '${like}' or summary like '${like}' or tags like '${like}' or content like '${like}'`)
            .limit(10);
          for (const a of results) {
            if (!found.has(a.ID)) found.set(a.ID, a);
          }
          if (found.size >= 5) break;
        }
        articles = [...found.values()].slice(0, 5);
      }

      // 兜底：没有匹配时取最新 5 篇
      if (articles.length === 0) {
        articles = await SELECT.from(KnowledgeArticles)
          .columns('ID', 'title', 'summary', 'tags', 'content')
          .where({ isActive: true })
          .limit(5);
      }

      // 2. 调用 AI
      let aiResult;
      try {
        aiResult = await generateAnswer(question, articles);
      } catch (err) {
        req.error(500, `AI 服务调用失败：${err.message}`);
        return;
      }

      const { answer, referencedArticleIds, promptTokens, answerTokens } = aiResult;

      // 3. 获取或创建会话
      let sessionID;
      if (sessionId) {
        const existing = await SELECT.one.from(ChatSessions).columns('ID').where({ ID: sessionId });
        if (!existing) return req.error(404, `会话 ${sessionId} 不存在`);
        sessionID = sessionId;
      } else {
        sessionID = cds.utils.uuid();
        await INSERT.into(ChatSessions).entries({
          ID: sessionID,
          userId,
          title: question.substring(0, 50),
          status: 'ACTIVE',
          createdAt: new Date(),
          modifiedAt: new Date()
        });
      }

      // 4. 保存问答消息
      const messageID = cds.utils.uuid();
      await INSERT.into(ChatMessages).entries({
        ID: messageID,
        session_ID: sessionID,
        question,
        answer,
        promptTokens: promptTokens ?? 0,
        answerTokens: answerTokens ?? 0,
        createdAt: new Date()
      });

      // 5. 保存文章引用关联
      const validArticleIds = referencedArticleIds.filter(id =>
        articles.some(a => a.ID === id)
      );

      if (validArticleIds.length > 0) {
        const refs = validArticleIds.map((articleId, idx) => ({
          message_ID: messageID,
          article_ID: articleId,
          relevance: parseFloat((1 - idx * 0.1).toFixed(2))
        }));
        await INSERT.into(ChatMessageArticles).entries(refs);
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
      const result = await UPDATE(ChatMessages)
        .set({ rating })
        .where({ ID: messageId });
      if (result === 0) {
        return req.error(404, `消息 ${messageId} 不存在`);
      }
      return true;
    });

    await super.init();
  }
};

// ─── 工具函数 ────────────────────────────────────────────

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
    .slice(0, 8);
}
