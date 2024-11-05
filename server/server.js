const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = 8002;  // Changed port to 8000      

const bigquery = new BigQuery({
  projectId: 'data-lake-325319', // Optional, set this if not using GOOGLE_APPLICATION_CREDENTIALS
  keyFilename: './data-lake-325319-610f290a37e8.json', // Ensure this path is correct
});

// Enable CORS to allow requests from the frontend
app.use(cors({
  origin: ['http://34.45.164.205:8000', 'http://34.45.164.205:8002'],  // Allow multiple origins
}));

app.use(express.json()); // For parsing application/json

// Middleware to validate API key
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_KEY) {
    next(); // API key is valid, proceed
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
}


// Apply API key validation middleware globally
app.use(validateApiKey);

function isValidDate(dateString) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
}

function getDefaultDateRange() {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);

  const startDate = sevenDaysAgo.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  return { startDate, endDate };
}

app.get('/fetch-filters', async (req, res) => {
  try {
    const { start_date, end_date,  environment, user_type, user_id, module_id, content_id, tts_engine} = req.query;

    console.time('Total Filter Query Time');

    let validStartDate = start_date;
    let validEndDate = end_date;
    if (!isValidDate(validStartDate) || !isValidDate(validEndDate)) {
      const { startDate, endDate } = getDefaultDateRange();
      validStartDate = startDate;
      validEndDate = endDate;
    }

    console.time('Filter Query Execution Time');

    const environmentQuery = `
      SELECT DISTINCT 
        CASE WHEN environment IS null THEN 'missing'
        WHEN environment LIKE '%hk%' THEN 'HK'
        ELSE UPPER(environment)
        END environment
      FROM data-lake-325319.interim_data.user_monitoring
      ORDER BY environment
    `;


    console.log('Filter environmentIdQuery:', environmentQuery);

    const moduleIdQuery = `
      SELECT DISTINCT remote_chat_response.flow_info.module_id, 
      FROM data-lake-325319.interim_data.RCResponses
      WHERE remote_chat_response.flow_info.module_id > ''
      ORDER BY module_id
    `;

    console.log('Filter moduleIdQuery:', moduleIdQuery);

    const contentIdQuery = `
      SELECT DISTINCT remote_chat_response.flow_info.content_id
      FROM data-lake-325319.interim_data.RCResponses
      WHERE remote_chat_response.flow_info.module_id > ''
      ORDER BY content_id
    `;

    console.log('Filter contentIdQuery:', contentIdQuery);

    const userIdQuery = `
      SELECT DISTINCT auid AS user_id
      FROM data-lake-325319.interim_data.user_monitoring
      ORDER BY user_id
    `;

    console.log('Filter userIdQuery:', userIdQuery);

    const userTypeQuery = `
      SELECT DISTINCT user_type
      FROM data-lake-325319.interim_data.user_monitoring
      ORDER BY user_type
    `;

    const CloudTTSSupplement = 'data-lake-325319.protos.CloudTTSSupplement'

    console.log('Filter userTypeQuery:', userTypeQuery);

    const ttsEngineQuery = `
      SELECT DISTINCT CloudTTSSupplement.tts_engine
      FROM \`${CloudTTSSupplement}\`
      WHERE CloudTTSSupplement.tts_engine is not null
      ORDER BY CloudTTSSupplement.tts_engine
    `;


    console.log('Filter ttsEngineQuery:', ttsEngineQuery);

    // Execute the queries in parallel
    const [environmentRows, userTypeRows, userIdRows, moduleIdRows, contentIdRows, ttsEngineRows] = await Promise.all([
      bigquery.query({ query: environmentQuery, location: 'US' }),
      bigquery.query({ query: userTypeQuery, location: 'US' }),
      bigquery.query({ query: userIdQuery, location: 'US' }),
      bigquery.query({ query: moduleIdQuery, location: 'US' }),
      bigquery.query({ query: contentIdQuery, location: 'US' }),
      bigquery.query({ query: ttsEngineQuery, location: 'US' })
    ]);

    console.timeEnd('Filter Query Execution Time');

    console.time('Filter Data Processing Time');

    // Process the results
    const environments = [...new Set(environmentRows[0].map(row => row.environment).filter(id => id))];
    const userTypes = [...new Set(userTypeRows[0].map(row => row.user_type).filter(id => id))];
    const userIds = [...new Set(userIdRows[0].map(row => row.user_id).filter(id => id))];
    const moduleIds = [...new Set(moduleIdRows[0].map(row => row.module_id).filter(id => id))];
    const contentIds = [...new Set(contentIdRows[0].map(row => row.content_id).filter(id => id))];
    const ttsEngines = [...new Set(ttsEngineRows[0].map(row => row.tts_engine).filter(id => id))];


    // console.log('environmentIds', environmentIds);
    console.timeEnd('Filter Data Processing Time');
    console.timeEnd('Total Filter Query Time');

    res.json({ environments, userTypes, userIds, moduleIds, contentIds, ttsEngines });
  } catch (error) {
    console.error('Error fetching filters:', error.message);
    res.status(500).send('Error fetching filters');
  }
});

app.get('/fetch-data', async (req, res) => {
  try {
    const { start_date, end_date, environment, user_id, user_type, module_id, content_id, tts_engine } = req.query;

    console.time('Total Data Query Time');

    console.log('Received parameters:', { start_date, end_date, environment, user_id, user_type, module_id, content_id, tts_engine });

    let validStartDate = start_date;
    let validEndDate = end_date;
    if (!isValidDate(validStartDate) || !isValidDate(validEndDate)) {
      const { startDate, endDate } = getDefaultDateRange();
      validStartDate = startDate;
      validEndDate = endDate;
    }

    console.time('Data Query Execution Time');
    const RemoteChatResponse = `data-lake-325319.protos.RemoteChatResponse`;
    const CloudTTSSupplement = `data-lake-325319.protos.CloudTTSSupplement`;
    const ASRAnalytics = `data-lake-325319.protos.ASRAnalytics`
    let query = `
       WITH users AS (
        SELECT auid AS user_id, user_type,
          CASE WHEN environment IS null THEN 'missing'
          WHEN environment LIKE '%hk%' THEN 'HK'
          ELSE UPPER(environment)
          END environment
        FROM data-lake-325319.interim_data.user_monitoring
      ),
      sessions AS (
        SELECT DISTINCT session_id
        FROM data-lake-325319.interim_data.RCResponses
        INNER JOIN \`${CloudTTSSupplement}\`
          USING(session_id)
      ),
      modules AS (
        SELECT DISTINCT session_id, 
          remote_chat_response.event_id, 
          MAX(remote_chat_response.flow_info.module_id) module_id, 
          MAX(remote_chat_response.flow_info.content_id) content_id
        FROM data-lake-325319.interim_data.RCResponses
        INNER JOIN sessions
          USING(session_id)
        WHERE remote_chat_response.event_id > ''
        GROUP BY session_id, event_id
      ),
      cloud_tts AS (
      SELECT session_id,
        CONCAT(
          '''{"name": "Total Duration (ms)", "pipeline": [{"name": "CloudTTSSupplement", "pipeline": [{"name": "translation_time", "total":''', 
        IFNULL(CloudTTSSupplement.translation_time, 0), 
          '''},{"name": "automarkup_time", "total": ''', 
          IFNULL(CloudTTSSupplement.automarkup_time, 0),
          '''},{"name": "synthesis_time", "total": ''', 
          IFNULL(CloudTTSSupplement.synthesis_time, 0),
          '''}], "total": ''', 
          IFNULL(CloudTTSSupplement.total_time, 0),
          '''}], "total_rc": ''',
          IFNULL(CloudTTSSupplement.total_time, 0),
          '''}'''
          ) AS stats_string,
          CloudTTSSupplement.event_id
        FROM \`${CloudTTSSupplement}\`
        INNER JOIN sessions
          USING(session_id)
        WHERE CloudTTSSupplement.total_time>0
      ),
    asr AS (
      SELECT session_id,
        CONCAT(
          '''{"name": "Total Duration (ms)", "pipeline": [{"name": "Speech Detection", "total":''',
          GREATEST(IFNULL(ASRAnalytics.last_final_asr_response, 0)-IFNULL(ASRAnalytics.detected_speech_start, 0), 0),
          ''',"pipeline": [{"name": "From ASR Start To Final Response", "total":''',
          GREATEST(IFNULL(ASRAnalytics.last_final_asr_response, 0)-IFNULL(ASRAnalytics.asr_detected_speech_start, 0), 0),
           ''',"pipeline": [{"name": "From ASR End To Final Response", "total":''',
          GREATEST(IFNULL(ASRAnalytics.last_final_asr_response, 0)-IFNULL(ASRAnalytics.asr_detected_speech_end, 0), 0),
          '''}]}]}], "total_rc": ''',
          GREATEST(IFNULL(ASRAnalytics.last_final_asr_response, 0)-IFNULL(ASRAnalytics.detected_speech_start, 0), 0),
          '''}'''
          ) AS stats_string,
          ASRAnalytics.event_id
        FROM \`${ASRAnalytics}\`
        INNER JOIN sessions
          USING(session_id)
        WHERE ASRAnalytics.event_id>""
    ),
    unified_data AS (
      SELECT session_id, 
        CONCAT('''{"name": "Total Duration (ms)", "pipeline": [''',
        REPLACE(stats_string, "total_rc", "total"),
        '''], "total_rc":''',
        SPLIT(stats_string, '''"total_rc":''')[ORDINAL(2)]) 
        AS stats_string, 
        IFNULL(remote_chat_response.flow_info.module_id, '') module_id,
        IFNULL(remote_chat_response.flow_info.content_id, '') content_id,
      FROM data-lake-325319.interim_data.RCResponses
      INNER JOIN sessions
          USING(session_id)
      WHERE remote_chat_response.processing_time > 200
        AND remote_chat_response.result = 0
        AND remote_chat_response.backend IN ('router', 'default')
        AND (remote_chat_response.not_respond IS NULL OR remote_chat_response.not_respond IS NOT TRUE)
      UNION ALL

      SELECT session_id, stats_string, 
        IFNULL(module_id, '') module_id, IFNULL(content_id, '') content_id
      FROM cloud_tts
      LEFT JOIN modules USING(session_id, event_id)

      UNION ALL

      SELECT session_id, stats_string, 
        IFNULL(module_id, '') module_id, IFNULL(content_id, '') content_id
      FROM asr
      LEFT JOIN modules USING(session_id, event_id)
    )
      SELECT stats_string
      FROM unified_data
      INNER JOIN data-lake-325319.analytics.AugmentedSessions USING(session_id)
      INNER JOIN users USING(user_id)
      WHERE DATE(TIMESTAMP_MILLIS(session_start_timestamp)) BETWEEN ? AND ?
    `;

    const params = [validStartDate, validEndDate];

    // Handle multiple selected filters
    if (environment && environment.trim()) {
      const environmentArray = Array.isArray(environment) ? environment : [environment];
      query += ` AND environment IN (${environmentArray.map(() => '?').join(',')})`;
      params.push(...environmentArray);
        }
    if (user_type && user_type.trim()) {
      const user_typeArray = Array.isArray(user_type) ? user_type : [user_type];
      query += ` AND user_type IN ($  {user_typeArray.map(() => '?').join(',')})`;
      params.push(...user_typeArray);
    }
    if (user_id && user_id.trim()) {
      const user_idArray = Array.isArray(user_id) ? user_id : [user_id];
      query += ` AND user_id IN (${user_idArray.map(() => '?').join(',')})`;
      params.push(...user_idArray);
    }
    if (module_id && module_id.trim()) {
      const module_idArray = Array.isArray(module_id) ? module_id : [module_id];
      query += ` AND module_id IN (${module_idArray.map(() => '?').join(',')})`;
      params.push(...module_idArray);
    }
    if (content_id && content_id.trim()) {
      const content_idArray = Array.isArray(content_id) ? content_id : [content_id];
      query += ` AND content_id IN (${content_idArray.map(() => '?').join(',')})`;
      params.push(...content_idArray);
    }
    if (tts_engine && tts_engine.trim()) {
      const tts_engineArray = Array.isArray(tts_engine) ? tts_engine : [tts_engine];
      query += ` AND session_id in (
        SELECT distinct session_id
        FROM \`${CloudTTSSupplement}\`
        WHERE CloudTTSSupplement.tts_engine IN (${tts_engineArray.map(() => '?').join(',')}))`;
      params.push(...tts_engineArray);
    }

    console.log('Data Query:', query);
    console.log('Data Query Parameters:', params);

    const options = {
      query: query,
      location: 'US',
      params: params
    };

    const [rows] = await bigquery.query(options);
    console.log('Rows returned:', rows);

    console.timeEnd('Data Query Execution Time');

    console.time('Data Processing Time');

    // Preprocess and transform the data
    const processedData = rows.map(row => {
      if (row.stats_string) {
        try {
          // Parse the stats_string field as JSON
          const stats = JSON.parse(row.stats_string);

          // Return the parsed stats, handling null/undefined values gracefully
          return stats ? { stats } : null;
        } catch (error) {
          console.warn('Error parsing stats_string:', error.message);
          return null;
        }
      } else {
        return null;
      }
    }).filter(row => row !== null);

    console.timeEnd('Data Processing Time');
    console.timeEnd('Total Data Query Time');

    res.json(processedData);
  } catch (error) {
    console.error('Error occurred:', error.message);
    res.status(500).send('Error fetching data: ' + error.message);
  }
});

app.listen(port, '0.0.0.0', () => { 
  console.log(`Server running at http://34.45.164.205:${port}`);
});
