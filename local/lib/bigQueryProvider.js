'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

/**
 * Create BigQuery client from optional explicit credentials path / project id.
 *
 * @param {AppConfig} config
 */
function createBigQueryClient(config) {
  const opts = {};
  if (config.bigQueryProjectId) opts.projectId = config.bigQueryProjectId;
  if (config.bigQueryKeyFilename) opts.keyFilename = config.bigQueryKeyFilename;
  return Object.keys(opts).length ? new BigQuery(opts) : new BigQuery();
}

/**
 * @param {AppConfig} config
 */
function validateBigQueryTables(config) {
  const required = [
    'sessionMetadata',
    'latencyEvents',
    'ttsMetrics',
    'asrMetrics',
    'sessionEnrichment',
  ];
  const missing = required.filter((k) => !config.bigQueryTables[k]);
  if (missing.length) {
    throw new Error(
      `DATA_SOURCE=bigquery requires env BIGQUERY_TABLE_* for: ${missing.join(', ')}. `
      + 'See local/.env.example.',
    );
  }
}

/**
 * Environment label normalization used by the filters API.
 */
function sqlEnvironmentExpr() {
  return `
      CASE WHEN environment IS null THEN 'missing'
      WHEN environment LIKE '%hk%' THEN 'HK'
      ELSE UPPER(environment)
      END`;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStrArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [String(value)];
}

/**
 * @param {AppConfig} config
 * @param {import('express').Request['query']} query
 */
async function fetchFilters(config, query) {
  validateBigQueryTables(config);
  const bigquery = createBigQueryClient(config);

  const tMeta = config.bigQueryTables.sessionMetadata;
  const tLatency = config.bigQueryTables.latencyEvents;
  const tTts = config.bigQueryTables.ttsMetrics;

  const envSql = sqlEnvironmentExpr();

  const environmentQuery = `
      SELECT DISTINCT ${envSql} AS environment
      FROM \`${tMeta}\`
      ORDER BY environment
    `;

  const moduleIdQuery = `
      SELECT DISTINCT latency_row.latency_payload.flow_info.module_id AS module_id
      FROM \`${tLatency}\` AS latency_row
      WHERE latency_row.latency_payload.flow_info.module_id > ''
      ORDER BY module_id
    `;

  const contentIdQuery = `
      SELECT DISTINCT latency_row.latency_payload.flow_info.content_id AS content_id
      FROM \`${tLatency}\` AS latency_row
      WHERE latency_row.latency_payload.flow_info.module_id > ''
      ORDER BY content_id
    `;

  const userIdQuery = `
      SELECT DISTINCT auid AS user_id
      FROM \`${tMeta}\`
      ORDER BY user_id
    `;

  const userTypeQuery = `
      SELECT DISTINCT user_type
      FROM \`${tMeta}\`
      ORDER BY user_type
    `;

  const ttsEngineQuery = `
      SELECT DISTINCT tts_metrics.tts_engine AS tts_engine
      FROM \`${tTts}\` AS tts_metrics
      WHERE tts_metrics.tts_engine IS NOT NULL
      ORDER BY tts_engine
    `;

  const location = config.bigQueryLocation;

  const [environmentRows, userTypeRows, userIdRows, moduleIdRows, contentIdRows, ttsEngineRows] =
    await Promise.all([
      bigquery.query({ query: environmentQuery, location }),
      bigquery.query({ query: userTypeQuery, location }),
      bigquery.query({ query: userIdQuery, location }),
      bigquery.query({ query: moduleIdQuery, location }),
      bigquery.query({ query: contentIdQuery, location }),
      bigquery.query({ query: ttsEngineQuery, location }),
    ]);

  const environments = [...new Set(
    environmentRows[0].map((row) => row.environment).filter(Boolean),
  )];
  const userTypes = [...new Set(
    userTypeRows[0].map((row) => row.user_type).filter(Boolean),
  )];
  const userIds = [...new Set(
    userIdRows[0].map((row) => row.user_id).filter(Boolean),
  )];
  const moduleIds = [...new Set(
    moduleIdRows[0].map((row) => row.module_id).filter(Boolean),
  )];
  const contentIds = [...new Set(
    contentIdRows[0].map((row) => row.content_id).filter(Boolean),
  )];
  const ttsEngines = [...new Set(
    ttsEngineRows[0].map((row) => row.tts_engine).filter(Boolean),
  )];

  return {
    environments,
    userTypes,
    userIds,
    moduleIds,
    contentIds,
    ttsEngines,
  };
}

/**
 * @param {AppConfig} config
 * @param {import('express').Request['query']} query
 */
async function fetchData(config, query) {
  validateBigQueryTables(config);
  const bigquery = createBigQueryClient(config);

  const tMeta = config.bigQueryTables.sessionMetadata;
  const tLatency = config.bigQueryTables.latencyEvents;
  const tTts = config.bigQueryTables.ttsMetrics;
  const tAsr = config.bigQueryTables.asrMetrics;
  const tEnrich = config.bigQueryTables.sessionEnrichment;

  const envSql = sqlEnvironmentExpr();

  const {
    start_date: start_dateRaw,
    end_date: end_dateRaw,
    environment,
    user_id,
    user_type,
    module_id,
    content_id,
    tts_engine,
  } = query;

  const validStartDate = String(start_dateRaw || '');
  const validEndDate = String(end_dateRaw || '');

  let sql = `
       WITH users AS (
        SELECT auid AS user_id, user_type,
          ${envSql} AS environment
        FROM \`${tMeta}\`
      ),
      sessions AS (
        SELECT DISTINCT session_id
        FROM \`${tLatency}\`
        INNER JOIN \`${tTts}\` AS tts_metrics
          USING(session_id)
      ),
      modules AS (
        SELECT DISTINCT session_id,
          latency_row.latency_payload.event_id AS event_id,
          MAX(latency_row.latency_payload.flow_info.module_id) AS module_id,
          MAX(latency_row.latency_payload.flow_info.content_id) AS content_id
        FROM \`${tLatency}\` AS latency_row
        INNER JOIN sessions
          USING(session_id)
        WHERE latency_row.latency_payload.event_id > ''
        GROUP BY session_id, event_id
      ),
      tts_breakdown AS (
      SELECT session_id,
        CONCAT(
          '''{"name": "Total Duration (ms)", "pipeline": [{"name": "TTS metrics", "pipeline": [{"name": "translation_time", "total":''',
        IFNULL(tts_metrics.translation_time, 0),
          '''},{"name": "automarkup_time", "total": ''',
          IFNULL(tts_metrics.automarkup_time, 0),
          '''},{"name": "synthesis_time", "total": ''',
          IFNULL(tts_metrics.synthesis_time, 0),
          '''}], "total": ''',
          IFNULL(tts_metrics.total_time, 0),
          '''}], "total_rc": ''',
          IFNULL(tts_metrics.total_time, 0),
          '''}'''
          ) AS stats_string,
          tts_metrics.event_id AS event_id
        FROM \`${tTts}\` AS tts_metrics
        INNER JOIN sessions
          USING(session_id)
        WHERE tts_metrics.total_time>0
      ),
    asr_breakdown AS (
      SELECT session_id,
        CONCAT(
          '''{"name": "Total Duration (ms)", "pipeline": [{"name": "Voice activity", "total":''',
          GREATEST(IFNULL(asr_metrics.last_final_asr_response, 0)-IFNULL(asr_metrics.detected_speech_start, 0), 0),
          ''',"pipeline": [{"name": "Early decode", "total":''',
          GREATEST(IFNULL(asr_metrics.last_final_asr_response, 0)-IFNULL(asr_metrics.asr_detected_speech_start, 0), 0),
           ''',"pipeline": [{"name": "Tail decode", "total":''',
          GREATEST(IFNULL(asr_metrics.last_final_asr_response, 0)-IFNULL(asr_metrics.asr_detected_speech_end, 0), 0),
          '''}]}]}], "total_rc": ''',
          GREATEST(IFNULL(asr_metrics.last_final_asr_response, 0)-IFNULL(asr_metrics.detected_speech_start, 0), 0),
          '''}'''
          ) AS stats_string,
          asr_metrics.event_id AS event_id
        FROM \`${tAsr}\` AS asr_metrics
        INNER JOIN sessions
          USING(session_id)
        WHERE asr_metrics.event_id>""
    ),
    unified_data AS (
      SELECT session_id,
        CONCAT('''{"name": "Total Duration (ms)", "pipeline": [''',
        REPLACE(latency_row.stats_string, "total_rc", "total"),
        '''], "total_rc":''',
        SPLIT(latency_row.stats_string, '''"total_rc":''')[ORDINAL(2)])
        AS stats_string,
        IFNULL(latency_row.latency_payload.flow_info.module_id, '') AS module_id,
        IFNULL(latency_row.latency_payload.flow_info.content_id, '') AS content_id,
      FROM \`${tLatency}\` AS latency_row
      INNER JOIN sessions
          USING(session_id)
      WHERE latency_row.latency_payload.processing_time > 200
        AND latency_row.latency_payload.result = 0
        AND latency_row.latency_payload.backend IN ('router', 'default')
        AND (latency_row.latency_payload.not_respond IS NULL OR latency_row.latency_payload.not_respond IS NOT TRUE)
      UNION ALL

      SELECT session_id, stats_string,
        IFNULL(module_id, '') AS module_id, IFNULL(content_id, '') AS content_id
      FROM tts_breakdown
      LEFT JOIN modules USING(session_id, event_id)

      UNION ALL

      SELECT session_id, stats_string,
        IFNULL(module_id, '') AS module_id, IFNULL(content_id, '') AS content_id
      FROM asr_breakdown
      LEFT JOIN modules USING(session_id, event_id)
    )
      SELECT stats_string
      FROM unified_data
      INNER JOIN \`${tEnrich}\` AS enriched_session USING(session_id)
      INNER JOIN users USING(user_id)
      WHERE DATE(TIMESTAMP_MILLIS(enriched_session.session_start_timestamp)) BETWEEN ? AND ?
    `;

  const params = [validStartDate, validEndDate];

  const envArr = toStrArray(environment);
  if (envArr.length) {
    sql += ` AND environment IN (${envArr.map(() => '?').join(',')})`;
    params.push(...envArr);
  }

  const userTypeArr = toStrArray(user_type);
  if (userTypeArr.length) {
    sql += ` AND user_type IN (${userTypeArr.map(() => '?').join(',')})`;
    params.push(...userTypeArr);
  }

  const userIdArr = toStrArray(user_id);
  if (userIdArr.length) {
    sql += ` AND user_id IN (${userIdArr.map(() => '?').join(',')})`;
    params.push(...userIdArr);
  }

  const moduleIdArr = toStrArray(module_id);
  if (moduleIdArr.length) {
    sql += ` AND module_id IN (${moduleIdArr.map(() => '?').join(',')})`;
    params.push(...moduleIdArr);
  }

  const contentIdArr = toStrArray(content_id);
  if (contentIdArr.length) {
    sql += ` AND content_id IN (${contentIdArr.map(() => '?').join(',')})`;
    params.push(...contentIdArr);
  }

  const ttsArr = toStrArray(tts_engine);
  if (ttsArr.length) {
    sql += ` AND session_id IN (
        SELECT DISTINCT session_id
        FROM \`${tTts}\` AS tts_metrics
        WHERE tts_metrics.tts_engine IN (${ttsArr.map(() => '?').join(',')}))`;
    params.push(...ttsArr);
  }

  const [rows] = await bigquery.query({
    query: sql,
    location: config.bigQueryLocation,
    params,
  });

  return rows
    .map((row) => {
      if (!row.stats_string) return null;
      try {
        const stats = JSON.parse(row.stats_string);
        return stats ? { stats } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  fetchFilters,
  fetchData,
};
