'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mockProvider = require('../lib/mockProvider');

function sumChildren(node) {
  return (node.pipeline || []).reduce((sum, child) => sum + child.total, 0);
}

function nodeTotal(node) {
  return node.total ?? node.total_value;
}

function walk(node, visit) {
  visit(node);
  (node.pipeline || []).forEach((child) => walk(child, visit));
}

function depth(node) {
  return 1 + Math.max(0, ...(node.pipeline || []).map(depth));
}

test('fetchFilters returns populated demo filter dimensions', async () => {
  const filters = await mockProvider.fetchFilters({});

  assert.ok(filters.environments.length >= 4);
  assert.ok(filters.userTypes.length >= 3);
  assert.ok(filters.userIds.length > 10);
  assert.ok(filters.moduleIds.includes('module-A'));
  assert.ok(filters.contentIds.includes('content-1'));
  assert.ok(filters.ttsEngines.length >= 3);
});

test('fetchData returns nested flamegraph-compatible stats', async () => {
  const rows = await mockProvider.fetchData({});
  const sample = rows[0].stats;

  assert.ok(rows.length > 0);
  assert.equal(sample.name, 'Total Duration (ms)');
  assert.ok(sample.total_value > 0);
  assert.ok(Array.isArray(sample.pipeline));
  assert.ok(sample.pipeline.length >= 6);
  assert.ok(depth(sample) >= 4);
});

test('generated branch totals are internally consistent', async () => {
  const rows = await mockProvider.fetchData({});
  const sample = rows[0].stats;

  assert.equal(sample.total_value, sumChildren(sample));

  walk(sample, (node) => {
    if (!node.pipeline || node.pipeline.length === 0) return;
    assert.equal(
      nodeTotal(node),
      sumChildren(node),
      `children should sum to parent for ${node.name}`,
    );
  });
});

test('filters narrow returned mock rows', async () => {
  const allRows = await mockProvider.fetchData({});
  const filteredRows = await mockProvider.fetchData({
    environment: 'DEV',
    user_type: 'trial',
    module_id: 'module-A',
  });

  assert.ok(filteredRows.length > 0);
  assert.ok(filteredRows.length < allRows.length);
});
