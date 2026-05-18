'use strict';

/**
 * Runtime configuration for the latency flamegraph API.
 *
 * @typedef {Object} AppConfig
 * @property {'mock'|'bigquery'} dataSource
 * @property {string} apiKey Optional. When unset, API key checks are skipped (local demo).
 * @property {number} port
 * @property {string|string[]} corsOrigin
 * @property {string} bigQueryLocation
 * @property {Record<string, string>} bigQueryTables Fully-qualified table ids.
 */

/**
 * Reads `DATA_SOURCE` env: `mock` (default) or `bigquery`.
 *
 * @returns {AppConfig}
 */
function loadConfig() {
  const dataSourceRaw = (process.env.DATA_SOURCE || 'mock').toLowerCase();
  const dataSource = dataSourceRaw === 'bigquery' ? 'bigquery' : 'mock';

  const corsRaw = process.env.CORS_ORIGIN || 'http://localhost:8000';
  const corsOrigin = corsRaw.includes(',')
    ? corsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : corsRaw.trim();

  /** @type {Record<string, string>} */
  const bigQueryTables = {
    sessionMetadata: process.env.BIGQUERY_TABLE_SESSION_METADATA || '',
    latencyEvents: process.env.BIGQUERY_TABLE_LATENCY_EVENTS || '',
    ttsMetrics: process.env.BIGQUERY_TABLE_TTS_METRICS || '',
    asrMetrics: process.env.BIGQUERY_TABLE_ASR_METRICS || '',
    sessionEnrichment: process.env.BIGQUERY_TABLE_SESSION_ENRICHMENT || '',
  };

  return {
    dataSource,
    apiKey: process.env.API_KEY || '',
    port: Number(process.env.PORT || 3000),
    corsOrigin,
    bigQueryLocation: process.env.BIGQUERY_LOCATION || 'US',
    bigQueryKeyFilename:
      process.env.BIGQUERY_KEY_FILE
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || '',
    bigQueryProjectId: process.env.BIGQUERY_PROJECT_ID || '',
    bigQueryTables,
  };
}

module.exports = { loadConfig };
