'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

const { createApp, normalizeQueryDates } = require('../server');

const baseConfig = {
  apiKey: '',
  bigQueryKeyFilename: '',
  bigQueryLocation: 'US',
  bigQueryProjectId: '',
  bigQueryTables: {},
  corsOrigin: 'http://localhost:8000',
  dataSource: 'mock',
  port: 3000,
};

test('GET / exposes service metadata', async () => {
  const app = createApp(baseConfig);

  const res = await request(app).get('/').expect(200);

  assert.equal(res.body.service, 'flamegraph-analytics-api');
  assert.equal(res.body.dataSource, 'mock');
  assert.deepEqual(res.body.endpoints, ['/fetch-filters', '/fetch-data']);
});

test('mock mode does not require an API key even when configured', async () => {
  const app = createApp({ ...baseConfig, apiKey: 'private-demo-key' });

  await request(app).get('/fetch-filters').expect(200);
  await request(app).get('/fetch-data').expect(200);
});

test('private data source enforces x-api-key', async () => {
  const app = createApp(
    {
      ...baseConfig,
      apiKey: 'private-demo-key',
      dataSource: 'bigquery',
    },
    {
      bigQueryProvider: {
        fetchFilters: async () => ({ environments: [] }),
        fetchData: async () => [],
      },
    },
  );

  await request(app).get('/fetch-filters').expect(403);
  await request(app)
    .get('/fetch-filters')
    .set('x-api-key', 'private-demo-key')
    .expect(200);
});

test('GET /fetch-filters returns mock dimensions', async () => {
  const app = createApp(baseConfig);

  const res = await request(app).get('/fetch-filters').expect(200);

  assert.ok(res.body.environments.length > 0);
  assert.ok(res.body.userTypes.length > 0);
  assert.ok(res.body.userIds.length > 0);
  assert.ok(res.body.moduleIds.length > 0);
  assert.ok(res.body.contentIds.length > 0);
  assert.ok(res.body.ttsEngines.length > 0);
});

test('GET /fetch-data returns flamegraph stats rows', async () => {
  const app = createApp(baseConfig);

  const res = await request(app).get('/fetch-data').expect(200);

  assert.ok(res.body.length > 0);
  assert.equal(res.body[0].stats.name, 'Total Duration (ms)');
  assert.ok(Array.isArray(res.body[0].stats.pipeline));
});

test('normalizeQueryDates fills invalid date bounds', () => {
  const q = normalizeQueryDates({ start_date: 'bad', end_date: 'also-bad' });

  assert.match(q.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(q.end_date, /^\d{4}-\d{2}-\d{2}$/);
});
