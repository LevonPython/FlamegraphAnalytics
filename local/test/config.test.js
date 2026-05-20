'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadConfig } = require('../lib/config');

const ENV_KEYS = [
  'API_KEY',
  'BIGQUERY_KEY_FILE',
  'BIGQUERY_LOCATION',
  'BIGQUERY_PROJECT_ID',
  'BIGQUERY_TABLE_ASR_METRICS',
  'BIGQUERY_TABLE_PROCESSING_EVENTS',
  'BIGQUERY_TABLE_SESSION_ENRICHMENT',
  'BIGQUERY_TABLE_SESSION_METADATA',
  'BIGQUERY_TABLE_TTS_METRICS',
  'CORS_ORIGIN',
  'DATA_SOURCE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PORT',
];

function withEnv(values, fn) {
  const previous = {};
  ENV_KEYS.forEach((key) => {
    previous[key] = process.env[key];
    delete process.env[key];
  });
  Object.assign(process.env, values);

  try {
    return fn();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
  }
}

test('loadConfig defaults to mock mode', () => {
  withEnv({}, () => {
    const config = loadConfig();

    assert.equal(config.dataSource, 'mock');
    assert.equal(config.port, 3000);
    assert.equal(config.corsOrigin, '*');
    assert.equal(config.apiKey, '');
  });
});

test('loadConfig reads BigQuery table and credential settings', () => {
  withEnv(
    {
      DATA_SOURCE: 'bigquery',
      API_KEY: 'secret',
      PORT: '4040',
      CORS_ORIGIN: 'http://localhost:8000,https://example.com',
      BIGQUERY_PROJECT_ID: 'demo-project',
      BIGQUERY_KEY_FILE: '/tmp/key.json',
      BIGQUERY_LOCATION: 'EU',
      BIGQUERY_TABLE_SESSION_METADATA: 'p.d.session_metadata',
      BIGQUERY_TABLE_PROCESSING_EVENTS: 'p.d.processing_events',
      BIGQUERY_TABLE_TTS_METRICS: 'p.d.tts_metrics',
      BIGQUERY_TABLE_ASR_METRICS: 'p.d.asr_metrics',
      BIGQUERY_TABLE_SESSION_ENRICHMENT: 'p.d.session_enrichment',
    },
    () => {
      const config = loadConfig();

      assert.equal(config.dataSource, 'bigquery');
      assert.equal(config.apiKey, 'secret');
      assert.equal(config.port, 4040);
      assert.deepEqual(config.corsOrigin, [
        'http://localhost:8000',
        'https://example.com',
      ]);
      assert.equal(config.bigQueryProjectId, 'demo-project');
      assert.equal(config.bigQueryKeyFilename, '/tmp/key.json');
      assert.equal(config.bigQueryLocation, 'EU');
      assert.deepEqual(config.bigQueryTables, {
        sessionMetadata: 'p.d.session_metadata',
        processingEvents: 'p.d.processing_events',
        ttsMetrics: 'p.d.tts_metrics',
        asrMetrics: 'p.d.asr_metrics',
        sessionEnrichment: 'p.d.session_enrichment',
      });
    },
  );
});
