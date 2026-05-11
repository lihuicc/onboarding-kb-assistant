'use strict';

const { buildAzureContentSafety, buildLlmConfig, buildOrchestrationConfig } = require('@sap-ai-sdk/orchestration');

/**
 * HR 知识库助手 Orchestration 管道配置
 * 
 * 管道：Input Filter → Prompt Template → LLM → Output Filter
 */
function createHRAssistantConfig() {
  return buildOrchestrationConfig({
    // ── 1. LLM 配置 ────────────────────────────────────────
    llm: buildLlmConfig({
      modelName: 'gpt-4o',              // 或 'claude-3-5-sonnet' 视采购决定
      modelVersion: 'latest',
      modelParams: {
        max_tokens: 1024,
        temperature: 0.3
      }
    }),

    // ── 2. Prompt 模板（支持动态变量 {{?variable}}）────────
    templating: {
      template: [
        {
          role: 'system',
          content: `你是一位专业的企业内部 HR 助手。
只根据知识库中的内容回答问题，不得编造。
如知识库无相关信息，告知联系 hr@company.com。
使用中文回答，返回 JSON 格式：{"answer":"...","referencedArticleIds":["..."]}

知识库参考内容：{{?grounding_output_variable}}`
        },
        {
          role: 'user',
          content: `员工问题：{{?question}}`
        }
      ]
    },

    // ── 3. Input 内容过滤（Azure Content Safety）──────────
    inputFiltering: buildAzureContentSafety({
      hate: 0,          // 0=屏蔽所有仇恨言论
      selfHarm: 0,
      sexual: 0,
      violence: 0
    }),

    // ── 4. Output 内容过滤 ─────────────────────────────────
    outputFiltering: buildAzureContentSafety({
      hate: 0,
      selfHarm: 0,
      sexual: 0,
      violence: 2      // 轻微暴力描述允许（如急救说明）
    })
  });
}

module.exports = { createHRAssistantConfig };