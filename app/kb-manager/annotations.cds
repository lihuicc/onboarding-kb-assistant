using AdminService from '../../srv/knowledge-service';

// ─── category 关联字段：下拉 ValueHelp ──────────────────
annotate AdminService.KnowledgeArticles with {
  category @(
    Common.Text            : category.name,
    Common.TextArrangement : #TextOnly,
    Common.ValueListWithFixedValues: true,
    Common.ValueList: {
      $Type         : 'Common.ValueListType',
      CollectionPath: 'Categories',
      Parameters    : [
        {
          $Type            : 'Common.ValueListParameterOut',
          LocalDataProperty: category_ID,
          ValueListProperty: 'ID'
        },
        {
          $Type            : 'Common.ValueListParameterDisplayOnly',
          ValueListProperty: 'name'
        }
      ]
    }
  );
};

// ─── KnowledgeArticles — List Report + Object Page ─────
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
    TypeName      : '知识文章',
    TypeNamePlural: '知识文章',
    Title         : { Value: title },
    Description   : { Value: summary }
  },

  UI.FieldGroup #General: {
    Label: '基本信息',
    Data : [
      { Value: title,       Label: '标题' },
      { Value: category_ID, Label: '分类' },
      { Value: summary,     Label: '摘要' },
      { Value: tags,        Label: '标签（逗号分隔）' },
      { Value: isActive,    Label: '是否启用' }
    ]
  },

  UI.FieldGroup #Content: {
    Label: '文章内容',
    Data : [
      { Value: content, Label: '正文（支持 Markdown）' }
    ]
  },

  UI.FieldGroup #Stats: {
    Label: '统计',
    Data : [
      { Value: viewCount,    Label: '浏览次数' },
      { Value: helpfulCount, Label: '有帮助数' },
      { Value: createdAt,    Label: '创建时间' },
      { Value: modifiedAt,   Label: '修改时间' }
    ]
  },

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', Label: '文章内容', Target: '@UI.FieldGroup#Content' },
    { $Type: 'UI.ReferenceFacet', Label: '统计数据', Target: '@UI.FieldGroup#Stats'   }
  ]
);

// ─── Categories — List ──────────────────────────────────
annotate AdminService.Categories with @(

  UI.LineItem: [
    { Value: name,        Label: '分类名称' },
    { Value: description, Label: '描述' }
  ],

  UI.HeaderInfo: {
    TypeName      : '知识分类',
    TypeNamePlural: '知识分类',
    Title         : { Value: name }
  },

  UI.FieldGroup #CatInfo: {
    Data: [
      { Value: name,        Label: '分类名称' },
      { Value: description, Label: '描述' }
    ]
  },

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: '分类信息', Target: '@UI.FieldGroup#CatInfo' }
  ]
);

// ─── ChatSessions — 只读监控 ───────────────────────────
annotate AdminService.ChatSessions with @(
  UI.LineItem: [
    { Value: userId,    Label: '用户 ID' },
    { Value: title,     Label: '会话标题' },
    { Value: status,    Label: '状态' },
    { Value: createdAt, Label: '创建时间' }
  ]
);
