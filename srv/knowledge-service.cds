using onboarding.kb as db from '../db/schema';

// ─── HR 管理服务 ────────────────────────────────────────
@requires: 'admin'
service AdminService @(path: '/admin') {

  entity Categories      as projection on db.Categories;

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
  entity ChatSessions    as projection on db.ChatSessions;
}

// ─── 员工问答服务 ────────────────────────────────────────
@requires: 'user'
service KnowledgeService @(path: '/api') {

  // 知识库浏览（只读，仅显示已启用文章）
  @readonly
  entity KnowledgeArticles as select from db.KnowledgeArticles {
    ID, title, summary, tags, createdAt,
    category.name as categoryName
  } where isActive = true;

  // 对话历史
  entity ChatSessions  as projection on db.ChatSessions;
  entity ChatMessages  as projection on db.ChatMessages;

  // AI 问答
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

  // 评分
  action rateAnswer(
    messageId : UUID not null,
    rating    : Integer not null
  ) returns Boolean;
}
