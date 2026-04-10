namespace onboarding.kb;

using { cuid, managed } from '@sap/cds/common';

// ─── 知识分类 ───────────────────────────────────────────
entity Categories : cuid {
  name        : String(100) not null;
  description : String(500);
  articles    : Association to many KnowledgeArticles on articles.category = $self;
}

// ─── 知识文章 ───────────────────────────────────────────
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

// ─── 对话会话 ───────────────────────────────────────────
entity ChatSessions : cuid, managed {
  title    : String(200);
  userId   : String(100);
  status   : String(20) default 'ACTIVE';
  messages : Composition of many ChatMessages on messages.session = $self;
}

// ─── 问答消息 ───────────────────────────────────────────
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

// ─── 消息-文章引用关联表 ────────────────────────────────
entity ChatMessageArticles {
  key message  : Association to ChatMessages;
  key article  : Association to KnowledgeArticles;
  relevance    : Decimal(3,2);
}
