import { createUuid } from '../src/uuid.js';
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { Redis } from 'ioredis';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Explicit operator command; normal application startup never creates/drops a database.
const args = process.argv.slice(2);
const envPath = args.find(arg => arg.startsWith('--env-file='))?.slice('--env-file='.length) || '.env';
let db, redis, s3;
try {
  const env = parseEnv(await fs.readFile(envPath, 'utf8'));
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_PREFIX', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'REDIS_CHANNEL_PREFIX'])
    assert.ok(env[name], `Missing ${name}`);
  const database = new URL(env.DATABASE_URL);
  const schema = decodeURIComponent(database.pathname.slice(1));
  assert.equal(database.protocol, 'mysql:');
  assert.match(schema, /^[a-z][a-z0-9_]{0,63}$/);
  const prefix = env.S3_PREFIX.replace(/\/+$/, '');
  assert.ok(prefix.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)), 'Invalid S3_PREFIX');
  assert.match(env.REDIS_CHANNEL_PREFIX, /^[A-Za-z0-9:_-]+$/);
  db = await mysql.createConnection({host: database.hostname, port: Number(database.port || 3306),
    user: decodeURIComponent(database.username), password: decodeURIComponent(database.password), connectTimeout: 10000});
  const [[version]] = await db.query('SELECT VERSION() AS version');
  const [existing] = await db.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema]);
  redis = new Redis(env.REDIS_URL, {lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 1, retryStrategy: () => null});
  redis.on('error', () => {});
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
  s3 = new S3Client({endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'us-east-1', forcePathStyle: true,
    credentials: {accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY}, maxAttempts: 1});
  const send = command => s3.send(command, {abortSignal: AbortSignal.timeout(15000)});
  await send(new HeadBucketCommand({Bucket: env.S3_BUCKET}));
  if (args.includes('--verify-write')) {
    const key = `${prefix}/infrastructure-checks/${createUuid()}.txt`;
    const body = Buffer.from(`nebu-agent-engine storage check ${createUuid()}`);
    try {
      await send(new PutObjectCommand({Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: 'text/plain'}));
      const object = await send(new GetObjectCommand({Bucket: env.S3_BUCKET, Key: key}));
      assert.deepEqual(Buffer.from(await object.Body.transformToByteArray()), body);
    } finally {
      // Only the unique object created by this check is removed. Never list/delete bucket contents.
      await send(new DeleteObjectCommand({Bucket: env.S3_BUCKET, Key: key}));
    }
    const channel = `${env.REDIS_CHANNEL_PREFIX}:infrastructure-check:${createUuid()}`;
    const subscriber = redis.duplicate();
    subscriber.on('error', () => {});
    try {
      await subscriber.connect();
      await subscriber.subscribe(channel);
      const received = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Redis notification timeout')), 5000);
        subscriber.once('message', (actualChannel, message) => {clearTimeout(timeout); resolve({actualChannel, message});});
      });
      const [, message] = await Promise.all([redis.publish(channel, 'ready'), received]);
      assert.deepEqual(message, {actualChannel: channel, message: 'ready'});
    } finally {subscriber.disconnect();}
  }
  if (args.includes('--create-database'))
    await db.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(schema)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  else assert.ok(existing.length, 'Engine database is missing; use --create-database to create it explicitly');
  console.log(JSON.stringify({checkedAt: new Date().toISOString(),
    mysql: {host: database.hostname, port: Number(database.port || 3306), schema, version: version.version, created: !existing.length},
    redis: {host: new URL(env.REDIS_URL).hostname, ping: 'PONG', channelPrefix: env.REDIS_CHANNEL_PREFIX},
    s3: {endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, prefix: prefix + '/'},
    fileRoundTripAndRedisNotification: args.includes('--verify-write')}, null, 2));
} catch (error) {
  // Do not print connection options, credentials, SDK request objects or service responses.
  console.error(JSON.stringify({error: error.code || error.name, message: error instanceof assert.AssertionError ? error.message : 'Infrastructure check failed; check reachability, credentials and permissions'}));
  process.exitCode = 1;
} finally {
  redis?.disconnect();
  s3?.destroy();
  await db?.end();
}
