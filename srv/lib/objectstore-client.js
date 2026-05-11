'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let _s3Client = null;
let _bucket = null;

function getCredentials() {
  // From VCAP_SERVICES (CF service binding)
  const vcap = process.env.VCAP_SERVICES;
  if (vcap) {
    const services = JSON.parse(vcap);
    const binding = (services.objectstore || [])[0];
    if (binding) return binding.credentials;
  }
  // Fallback: legacy env vars
  const host = process.env.OS_HOST;
  if (host && process.env.OS_ACCESS_KEY_ID && process.env.OS_SECRET_ACCESS_KEY) {
    return {
      host,
      region: process.env.OS_REGION || 'eu-central-1',
      access_key_id: process.env.OS_ACCESS_KEY_ID,
      secret_access_key: process.env.OS_SECRET_ACCESS_KEY,
      bucket: process.env.OS_BUCKET
    };
  }
  throw new Error('Object Store 凭据未配置（需绑定 objectstore 服务或设置 OS_HOST / OS_ACCESS_KEY_ID / OS_SECRET_ACCESS_KEY）');
}

function getS3Client() {
  if (!_s3Client) {
    const creds = getCredentials();
    _bucket = creds.bucket;
    _s3Client = new S3Client({
      endpoint: `https://${creds.host}`,
      region: creds.region || 'eu-central-1',
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key
      },
      forcePathStyle: true
    });
  }
  return _s3Client;
}

function articleToText(article) {
  const content = (article.content || '').replace(/\\n/g, '\n');
  return [
    `标题：${article.title}`,
    `摘要：${article.summary || ''}`,
    `标签：${article.tags || ''}`,
    '',
    content
  ].join('\n');
}

function articleToKey(article) {
  return article.title.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
}

async function upsertArticle(article) {
  const client = getS3Client();
  const bucket = _bucket;
  const key = articleToKey(article);
  const body = Buffer.from(articleToText(article), 'utf8');

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'text/plain; charset=utf-8'
  }));
}

async function deleteArticle(article) {
  const client = getS3Client();
  const bucket = _bucket;
  const key = articleToKey(article);

  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key
  }));
}

module.exports = { upsertArticle, deleteArticle };
