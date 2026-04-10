'use strict';

/**
 * claude-client.js 单元测试
 * 运行: npx jest test/claude-client.test.js
 */

// 模拟 Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            answer: '根据公司政策，正式员工每年享有10天年假。',
            referencedArticleIds: ['art-001'],
            confidence: 0.95,
          }),
        }],
        usage: { input_tokens: 500, output_tokens: 50 },
      }),
    },
  }));
});

// 设置环境变量（必须在 require 之前）
process.env.ANTHROPIC_API_KEY = 'test-key';

const { generateAnswer } = require('../srv/lib/claude-client');

describe('generateAnswer', () => {
  const mockArticles = [
    {
      ID: 'art-001',
      title: '年假申请流程',
      content: '正式员工每年享有10天年假...',
      summary: '年假政策',
    },
  ];

  test('正常问答返回结构正确', async () => {
    const result = await generateAnswer('年假有多少天？', mockArticles);

    expect(result).toHaveProperty('answer');
    expect(result).toHaveProperty('referencedArticleIds');
    expect(result).toHaveProperty('promptTokens');
    expect(result).toHaveProperty('answerTokens');
    expect(typeof result.answer).toBe('string');
    expect(Array.isArray(result.referencedArticleIds)).toBe(true);
  });

  test('知识库为空时也能正常返回', async () => {
    const result = await generateAnswer('年假有多少天？', []);
    expect(result).toHaveProperty('answer');
  });

  test('未配置 API Key 时抛出错误', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    // 重置模块缓存以触发重新初始化
    jest.resetModules();
    const { generateAnswer: gen } = require('../srv/lib/claude-client');
    await expect(gen('test', [])).rejects.toThrow('ANTHROPIC_API_KEY');
    process.env.ANTHROPIC_API_KEY = savedKey;
  });
});
