'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH
    ? process.env.DOTENV_CONFIG_PATH
    : path.join(__dirname, '.env'),
});

const { loadConfig } = require('./lib/config');
const mockProvider = require('./lib/mockProvider');
const bigQueryProvider = require('./lib/bigQueryProvider');

const config = loadConfig();
const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

/**
 * Validates `x-api-key` for private data sources. Mock mode is always open so
 * the demo works even if an old local `.env` still contains API_KEY.
 */
function validateApiKey(req, res, next) {
  if (config.dataSource === 'mock' || !config.apiKey) {
    next();
    return;
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === config.apiKey) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }
}

app.use(validateApiKey);

app.get('/', (req, res) => {
  res.json({
    service: 'flamegraph-analytics-api',
    dataSource: config.dataSource,
    endpoints: ['/fetch-filters', '/fetch-data'],
  });
});

function isValidDate(dateString) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
}

function getDefaultDateRange() {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);

  const startDate = sevenDaysAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  return { startDate, endDate };
}

/**
 * Ensures ISO date bounds exist for filter queries.
 *
 * @param {import('express').Request['query']} query
 */
function normalizeQueryDates(query) {
  let start = query.start_date;
  let end = query.end_date;
  if (!isValidDate(String(start)) || !isValidDate(String(end))) {
    const { startDate, endDate } = getDefaultDateRange();
    start = startDate;
    end = endDate;
  }
  return { ...query, start_date: start, end_date: end };
}

app.get('/fetch-filters', async (req, res) => {
  try {
    const q = normalizeQueryDates(req.query);
    const payload =
      config.dataSource === 'bigquery'
        ? await bigQueryProvider.fetchFilters(config, q)
        : await mockProvider.fetchFilters(q);
    res.json(payload);
  } catch (error) {
    console.error('Error fetching filters:', error.message);
    res.status(500).send('Error fetching filters');
  }
});

app.get('/fetch-data', async (req, res) => {
  try {
    const q = normalizeQueryDates(req.query);
    const payload =
      config.dataSource === 'bigquery'
        ? await bigQueryProvider.fetchData(config, q)
        : await mockProvider.fetchData(q);
    res.json(payload);
  } catch (error) {
    console.error('Error occurred:', error.message);
    res.status(500).send(`Error fetching data: ${error.message}`);
  }
});

app.listen(config.port, () => {
  console.log(
    `Latency flamegraph API (${config.dataSource}) at http://localhost:${config.port}`,
  );
});
