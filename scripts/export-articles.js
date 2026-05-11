'use strict';

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../db/data/onboarding.kb-KnowledgeArticles.csv');
const OUTPUT_DIR = path.join(__dirname, '../docs/grounding');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const raw = fs.readFileSync(CSV_PATH, 'utf8');
const lines = raw.trim().split('\n');
const headers = parseCSVLine(lines[0]);

let exported = 0;
for (let i = 1; i < lines.length; i++) {
  const values = parseCSVLine(lines[i]);
  const row = {};
  headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

  if (row.isActive !== 'true') continue;

  const filename = row.title.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
  const filepath = path.join(OUTPUT_DIR, filename);

  // 还原 \n 转义为真实换行
  const content = row.content.replace(/\\n/g, '\n');

  const text = [
    `标题：${row.title}`,
    `摘要：${row.summary}`,
    `标签：${row.tags}`,
    '',
    content
  ].join('\n');

  fs.writeFileSync(filepath, text, 'utf8');
  console.log(`✓ ${filename}`);
  exported++;
}

console.log(`\n共导出 ${exported} 篇文章 → ${OUTPUT_DIR}`);

// 解析单行 CSV（处理双引号包裹的字段）
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
