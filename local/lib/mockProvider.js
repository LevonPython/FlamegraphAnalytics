'use strict';

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * @param {number} seed
 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string} str
 */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {Date} d
 */
function toYmd(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Builds nested latency stats compatible with the flamegraph UI (`pipeline`, `total_rc`).
 *
 * @param {() => number} rng
 */
function buildStatsTree(rng) {
  const split = (total, weights) => {
    if (total <= 0) return weights.map(() => 0);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const raw = weights.map((weight) => Math.floor((total * weight) / weightTotal));
    let remainder = total - raw.reduce((sum, value) => sum + value, 0);
    for (let i = 0; remainder > 0; i += 1) {
      raw[i % raw.length] += 1;
      remainder -= 1;
    }
    return raw;
  };

  const gateway = 45 + Math.floor(rng() * 120);
  const [tls, auth, rateLimit, requestDecode] = split(gateway, [0.18, 0.25, 0.16, 0.41]);

  const routing = 80 + Math.floor(rng() * 170);
  const [intent, context, profile, experiment] = split(routing, [0.28, 0.33, 0.24, 0.15]);
  const [cacheLookup, vectorSearch, featureHydration] = split(context, [0.22, 0.48, 0.30]);

  const asrOuter = 90 + Math.floor(rng() * 220);
  const [vad, noiseSuppression, acousticDecode, punctuation] = split(
    asrOuter,
    [0.17, 0.19, 0.47, 0.17],
  );

  const ttsOuter = 70 + Math.floor(rng() * 200);
  const [translate, markup, synth, audioEncode] = split(ttsOuter, [0.23, 0.18, 0.44, 0.15]);

  const voiceStackMs = asrOuter + ttsOuter;
  const model = 180 + Math.floor(rng() * 520);
  const [promptBuild, safety, inference, postProcess] = split(model, [0.14, 0.11, 0.58, 0.17]);
  const [systemPrompt, userMemory, toolContext] = split(promptBuild, [0.25, 0.35, 0.40]);
  const [queueWait, tokenGeneration, ranking] = split(inference, [0.16, 0.68, 0.16]);

  const responseAssembly = 50 + Math.floor(rng() * 140);
  const [templateMerge, localization, payloadEncode] = split(
    responseAssembly,
    [0.30, 0.32, 0.38],
  );

  const observability = 20 + Math.floor(rng() * 70);
  const [metrics, traces, auditLog] = split(observability, [0.35, 0.40, 0.25]);

  const retryTotal = Math.max(0, Math.floor(rng() * 90) - 25);
  const [providerRetry, jitterWait, circuitCheck] = split(
    retryTotal,
    [0.42, 0.34, 0.24],
  );
  const normalizedRetryTotal = retryTotal > 0 ? retryTotal : 0;

  const knowledgeSignals = 12 + Math.floor(rng() * 45);
  const [entityExtraction, topicScoring] = split(knowledgeSignals, [0.45, 0.55]);
  const cacheWrite = 8 + Math.floor(rng() * 25);
  const asyncHandoff = 8 + Math.floor(rng() * 25);
  const enrichment = knowledgeSignals + cacheWrite + asyncHandoff;

  const totalRc =
    gateway
    + routing
    + voiceStackMs
    + model
    + responseAssembly
    + observability
    + normalizedRetryTotal
    + enrichment;

  return {
    name: 'Total Duration (ms)',
    total_rc: totalRc,
    pipeline: [
      {
        name: 'Gateway',
        total: gateway,
        pipeline: [
          { name: 'TLS handshake', total: tls },
          { name: 'Auth check', total: auth },
          { name: 'Rate limit', total: rateLimit },
          { name: 'Request decode', total: requestDecode },
        ],
      },
      {
        name: 'Routing',
        total: routing,
        pipeline: [
          { name: 'Intent classification', total: intent },
          {
            name: 'Context fetch',
            total: context,
            pipeline: [
              { name: 'Cache lookup', total: cacheLookup },
              { name: 'Vector search', total: vectorSearch },
              { name: 'Feature hydration', total: featureHydration },
            ],
          },
          { name: 'Profile load', total: profile },
          { name: 'Experiment routing', total: experiment },
        ],
      },
      {
        name: 'Voice stack',
        total: voiceStackMs,
        pipeline: [
          {
            name: 'ASR',
            total: asrOuter,
            pipeline: [
              { name: 'Voice activity detection', total: vad },
              { name: 'Noise suppression', total: noiseSuppression },
              { name: 'Acoustic decode', total: acousticDecode },
              { name: 'Punctuation', total: punctuation },
            ],
          },
          {
            name: 'TTS',
            total: ttsOuter,
            pipeline: [
              { name: 'Translate', total: translate },
              { name: 'Markup', total: markup },
              { name: 'Synthesize', total: synth },
              { name: 'Audio encode', total: audioEncode },
            ],
          },
        ],
      },
      {
        name: 'Model orchestration',
        total: model,
        pipeline: [
          {
            name: 'Prompt build',
            total: promptBuild,
            pipeline: [
              { name: 'System prompt', total: systemPrompt },
              { name: 'User memory', total: userMemory },
              { name: 'Tool context', total: toolContext },
            ],
          },
          { name: 'Safety checks', total: safety },
          {
            name: 'Inference',
            total: inference,
            pipeline: [
              { name: 'Queue wait', total: queueWait },
              { name: 'Token generation', total: tokenGeneration },
              { name: 'Candidate ranking', total: ranking },
            ],
          },
          { name: 'Post process', total: postProcess },
        ],
      },
      {
        name: 'Response assembly',
        total: responseAssembly,
        pipeline: [
          { name: 'Template merge', total: templateMerge },
          { name: 'Localization', total: localization },
          { name: 'Payload encode', total: payloadEncode },
        ],
      },
      {
        name: 'Observability',
        total: observability,
        pipeline: [
          { name: 'Metrics', total: metrics },
          { name: 'Traces', total: traces },
          { name: 'Audit log', total: auditLog },
        ],
      },
      {
        name: 'Retries and backoff',
        total: normalizedRetryTotal,
        pipeline: [
          { name: 'Provider retry', total: retryTotal > 0 ? providerRetry : 0 },
          { name: 'Jitter wait', total: retryTotal > 0 ? jitterWait : 0 },
          { name: 'Circuit check', total: retryTotal > 0 ? circuitCheck : 0 },
        ],
      },
      {
        name: 'Background enrichment',
        total: enrichment,
        pipeline: [
          {
            name: 'Knowledge signals',
            total: knowledgeSignals,
            pipeline: [
              { name: 'Entity extraction', total: entityExtraction },
              { name: 'Topic scoring', total: topicScoring },
            ],
          },
          { name: 'Cache write', total: cacheWrite },
          { name: 'Async handoff', total: asyncHandoff },
        ],
      },
    ],
  };
}

const DEMO_ENVIRONMENTS = ['DEV', 'STAGING', 'PROD', 'EU', 'HK', 'missing'];
const DEMO_USER_TYPES = ['trial', 'standard', 'premium', 'partner'];
const DEMO_TTS = ['standard-v1', 'neural-fast', 'neural-hd', 'compact'];

function buildDemoCatalog() {
  /** @type {Array<{ date: string, environment: string, userType: string, userId: string, moduleId: string, contentId: string, ttsEngine: string, stats: ReturnType<typeof buildStatsTree> }>} */
  const rows = [];
  const today = new Date();

  for (let i = 0; i < 160; i += 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - (i % 55));
    const date = toYmd(day);
    const environment = DEMO_ENVIRONMENTS[i % DEMO_ENVIRONMENTS.length];
    const userType = DEMO_USER_TYPES[i % DEMO_USER_TYPES.length];
    const userId = `user-${String((i * 17) % 40).padStart(3, '0')}`;
    const moduleId = `module-${String.fromCharCode(65 + (i % 6))}`;
    const contentId = `content-${(i % 9) + 1}`;
    const ttsEngine = DEMO_TTS[i % DEMO_TTS.length];
    const rng = mulberry32(hashSeed(`${date}|${i}|${userId}`));
    const stats = buildStatsTree(rng);
    rows.push({
      date,
      environment,
      userType,
      userId,
      moduleId,
      contentId,
      ttsEngine,
      stats,
    });
  }

  return rows;
}

const catalog = buildDemoCatalog();

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
 * @param {string} dateStr
 * @param {string} start
 * @param {string} end
 */
function isBetweenDates(dateStr, start, end) {
  return dateStr >= start && dateStr <= end;
}

/**
 * Mock implementation of GET /fetch-filters.
 *
 * @param {{ start_date?: string, end_date?: string }} query
 */
async function fetchFilters(query) {
  const start = query.start_date;
  const end = query.end_date;
  const inRange = catalog.filter((row) =>
    start && end ? isBetweenDates(row.date, start, end) : true,
  );

  const uniq = (arr) => [...new Set(arr)].sort();

  return {
    environments: uniq(inRange.map((r) => r.environment)),
    userTypes: uniq(inRange.map((r) => r.userType)),
    userIds: uniq(inRange.map((r) => r.userId)),
    moduleIds: uniq(inRange.map((r) => r.moduleId)),
    contentIds: uniq(inRange.map((r) => r.contentId)),
    ttsEngines: uniq(inRange.map((r) => r.ttsEngine)),
  };
}

/**
 * Mock implementation of GET /fetch-data.
 *
 * @param {Record<string, unknown>} query
 */
async function fetchData(query) {
  const start = String(query.start_date || '');
  const end = String(query.end_date || '');
  const environments = toStrArray(query.environment);
  const userTypes = toStrArray(query.user_type);
  const userIds = toStrArray(query.user_id);
  const moduleIds = toStrArray(query.module_id);
  const contentIds = toStrArray(query.content_id);
  const ttsEngines = toStrArray(query.tts_engine);

  let filtered = catalog.filter((row) =>
    start && end ? isBetweenDates(row.date, start, end) : true,
  );

  if (environments.length) {
    filtered = filtered.filter((r) => environments.includes(r.environment));
  }
  if (userTypes.length) {
    filtered = filtered.filter((r) => userTypes.includes(r.userType));
  }
  if (userIds.length) {
    filtered = filtered.filter((r) => userIds.includes(r.userId));
  }
  if (moduleIds.length) {
    filtered = filtered.filter((r) => moduleIds.includes(r.moduleId));
  }
  if (contentIds.length) {
    filtered = filtered.filter((r) => contentIds.includes(r.contentId));
  }
  if (ttsEngines.length) {
    filtered = filtered.filter((r) => ttsEngines.includes(r.ttsEngine));
  }

  /** Limit payload size for the demo UI */
  const maxRows = 400;
  return filtered.slice(0, maxRows).map((row) => ({ stats: row.stats }));
}

module.exports = {
  fetchFilters,
  fetchData,
};
