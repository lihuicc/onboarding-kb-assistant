#!/usr/bin/env node
/**
 * 本地快速测试脚本：直接调用 Claude API 验证连通性
 * 运行：node test/quick-test.js
 * 前提：已配置 .env 文件中的 ANTHROPIC_API_KEY
 */

'use strict';

// 加载 .env 文件
const path = require('path');
const fs = require('fs');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { generateAnswer } = require('../srv/lib/claude-client');

async function main() {
  const testArticles = [
    {
      ID: 'art-001',
      title: '年假申请流程',
      content: `正式员工每年享有以下年假：
- 工作1-3年：10天
- 工作3-10年：15天
- 工作10年以上：20天

申请流程：
1. 登录HR系统（hr.company.com）
2. 进入「假期管理」模块
3. 填写假期起止日期
4. 提交直属上级审批`,
      summary: '年假天数和申请流程',
    },
    {
      ID: 'art-002',
      title: 'IT设备申请指南',
      content: '新员工可申请笔记本电脑、显示器等设备，联系IT部门（分机8888）办理。',
      summary: 'IT设备申请流程',
    },
  ];

  const testQuestions = [
    '年假有几天？怎么申请？',
    '我需要申请电脑，找谁？',
    '公司有哪些员工福利？',
  ];

  console.log('=== 知识库问答助手 - 快速测试 ===\n');

  for (const question of testQuestions) {
    console.log(`❓ 问题：${question}`);
    try {
      const result = await generateAnswer(question, testArticles);
      console.log(`💬 回答：${result.answer}`);
      console.log(`📎 引用文章：${result.referencedArticleIds.join(', ') || '无'}`);
      console.log(`📊 Token 消耗：输入 ${result.promptTokens}，输出 ${result.answerTokens}`);
    } catch (err) {
      console.error(`❌ 错误：${err.message}`);
    }
    console.log('---');
  }
}

main().catch(console.error);
