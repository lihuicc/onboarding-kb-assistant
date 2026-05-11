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
    console.error('[orchestration] error details:', JSON.stringify({
      message: err.message,
      responseData: err.cause?.response?.data,
      responseStatus: err.cause?.response?.status,
      responseHeaders: err.cause?.response?.headers
    }, null, 2));
    throw err;
  }
}

module.exports = { generateAnswerWithOrchestration };
