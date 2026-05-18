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

/**
 * Validates `x-api-key` for private data sources. Mock mode is always open so
 * the demo works even if an old local `.env` still contains API_KEY.
 *
 * @param {import('./lib/config').AppConfig} runtimeConfig
 */
function validateApiKey(runtimeConfig) {
  return (req, res, next) => {
    if (runtimeConfig.dataSource === 'mock' || !runtimeConfig.apiKey) {
      next();
      return;
    }
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === runtimeConfig.apiKey) {
      next();
    } else {
      res.status(403).json({ error: 'Forbidden: Invalid API key' });
    }
  };
}

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

/**
 * Creates an Express app without binding a port. Tests use this directly.
 *
 * @param {import('./lib/config').AppConfig} runtimeConfig
 * @param {{ mockProvider?: typeof mockProvider, bigQueryProvider?: typeof bigQueryProvider }} providers
 */
function createApp(
  runtimeConfig = config,
  providers = { mockProvider, bigQueryProvider },
) {
  const app = express();
  const activeProviders = {
    mockProvider,
    bigQueryProvider,
    ...providers,
  };

  app.use(cors({ origin: runtimeConfig.corsOrigin }));
  app.use(express.json());
  app.use(validateApiKey(runtimeConfig));

  app.get('/', (req, res) => {
    res.json({
      service: 'flamegraph-analytics-api',
      dataSource: runtimeConfig.dataSource,
      endpoints: ['/fetch-filters', '/fetch-data'],
    });
  });

  app.get('/fetch-filters', async (req, res) => {
    try {
      const q = normalizeQueryDates(req.query);
      const payload =
        runtimeConfig.dataSource === 'bigquery'
          ? await activeProviders.bigQueryProvider.fetchFilters(runtimeConfig, q)
          : await activeProviders.mockProvider.fetchFilters(q);
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
        runtimeConfig.dataSource === 'bigquery'
          ? await activeProviders.bigQueryProvider.fetchData(runtimeConfig, q)
          : await activeProviders.mockProvider.fetchData(q);
      res.json(payload);
    } catch (error) {
      console.error('Error occurred:', error.message);
      res.status(500).send(`Error fetching data: ${error.message}`);
    }
  });

  return app;
}

function start() {
  const app = createApp(config);
  return app.listen(config.port, () => {
    console.log(
      `Latency flamegraph API (${config.dataSource}) at http://localhost:${config.port}`,
    );
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  getDefaultDateRange,
  isValidDate,
  normalizeQueryDates,
  start,
  validateApiKey,
};
