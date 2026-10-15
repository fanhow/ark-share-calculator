import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEED_BASE, validDay, taipeiDay, safeURL, latestEntry,
  normalizeContext, normalizeBrief, dateStatus, changeText, loadLatest, loadSaved,
} from '../background-data.js';

// Fixed times keep the safety checks independent of the runner's day or timezone.
const NOW = new Date('2026-10-15T18:00:00Z');
const DAY = '2026-10-16';
const AS_OF = '2026-10-16T01:00:00+08:00';
const options = { now: NOW, referenceDate: DAY };
const measure = (value, unit, extra = {}) => ({
  value, unit, asOf: AS_OF, source: 'test fixture, not investment data', ...extra,
});
const quote = (extra = {}) => ({
  symbol: 'AAPL', market: 'US', currency: 'USD', priceType: 'close',
  price: measure('200.25', 'USD'),
  arkK9: measure('1.2', 'strategy_K9', { kind: 'ark_observed' }),
  ...extra,
});
const brief = (extra = {}) => ({
  date: DAY, generatedAt: AS_OF, headline: 'Fixture',
  market: [{ label: '台股加權', value: '20000', change: '0.5', unit: '點', asOf: '2026-10-15' }],
  ...extra,
});
const jsonResponse = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });

test('index selection uses the latest valid past/present day, regardless of source ordering', () => {
  const index = [
    { date: '2026-10-14', generatedAt: '2026-10-14T19:00:00+08:00' },
    { date: DAY, generatedAt: '2026-10-16T00:00:00+08:00' },
    { date: '2026-10-17', generatedAt: '2026-10-17T12:00:00+08:00' },
    { date: '2026-02-30' }, { date: '../private' }, null,
    { date: '2026-10-15', generatedAt: '2026-10-15T22:00:00+08:00' },
    { date: DAY, generatedAt: AS_OF },
  ];
  const before = JSON.stringify(index);
  assert.deepEqual(latestEntry(index, DAY), { date: DAY, generatedAt: AS_OF });
  assert.equal(JSON.stringify(index), before, 'selection must not reorder the caller’s source');
  assert.throws(() => latestEntry([{ date: '2026-10-17' }, { date: '2026-02-30' }], DAY));
  assert.throws(() => latestEntry({ date: DAY }, DAY));
});

test('calendar validation and the import day respect Asia/Taipei across midnight', () => {
  assert.equal(validDay('2024-02-29'), true);
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-13-01', '', null]) {
    assert.equal(validDay(invalid), false, String(invalid));
  }
  assert.equal(taipeiDay(new Date('2026-10-15T15:59:59Z')), '2026-10-15');
  assert.equal(taipeiDay(new Date('2026-10-15T16:00:00Z')), DAY);
  assert.equal(dateStatus('2026-10-15', DAY).kind, 'older');
  assert.equal(dateStatus(DAY, DAY).kind, 'same');
  assert.equal(dateStatus('2026-10-17', DAY).kind, 'newer');
  assert.equal(dateStatus(null, DAY).kind, 'missing');
});

test('brief dates must match the selected index entry and contain usable market rows', () => {
  assert.throws(() => normalizeBrief(brief({ date: '2026-10-15' }), DAY, options));
  assert.throws(() => normalizeBrief(brief({ date: '2026-02-30' }), '2026-02-30', options));
  assert.throws(() => normalizeBrief(brief({ market: [] }), DAY, options));
  assert.throws(() => normalizeBrief(brief({ market: [null, {}] }), DAY, options));
});

test('missing numeric data remain missing while actual zero values remain zero', () => {
  const normalized = normalizeBrief(brief({ market: [
    { label: 'missing', value: null, change: null },
    { label: 'empty', value: '', change: ' ' },
    { label: 'invalid', value: 'NaN', change: Infinity },
    { label: 'zero', value: '0', change: 0, changeUnit: '%' },
  ] }), DAY, options);
  for (const row of normalized.market.slice(0, 3)) {
    assert.equal(row.value, null);
    assert.equal(row.change, null);
    assert.equal(changeText(row), '變動待提供');
  }
  assert.equal(normalized.market[3].value, 0);
  assert.equal(normalized.market[3].change, 0);
  assert.equal(changeText(normalized.market[3]), '0 %');
});

test('US yield changes use percentage points even when explicitly grouped as US market', () => {
  const { market } = normalizeBrief(brief({ market: [
    { label: '美國 10 年債殖利率', market: 'US', value: 5.21, change: -0.03, unit: '%' },
    { label: '聯邦基金有效利率', market: 'US', value: 3.88, change: null, unit: '%' },
  ] }), DAY, options);
  assert.equal(market[0].changeUnit, '百分點');
  assert.equal(changeText(market[0]), '-0.03 百分點');
  assert.equal(market[1].changeUnit, '百分點');
  assert.equal(changeText(market[1]), '變動待提供');
});

test('macro changes retain their own units and missing units are not invented', () => {
  const { macro } = normalizeBrief(brief({ macroRadar: { items: [
    { label: 'real yield', value: 2.1, change: 3, unit: '%', changeUnit: '基點' },
    { label: 'conditions', value: -0.1, change: -0.02, unit: '標準差', changeUnit: '標準差' },
    { label: 'unlabelled change', value: 1, change: 2 },
  ] } }), DAY, options);
  assert.equal(changeText(macro[0]), '+3 基點');
  assert.equal(changeText(macro[1]), '-0.02 標準差');
  assert.equal(changeText(macro[2]), '+2（單位待提供）');
  assert.equal(macro.every(row => row.group === 'MACRO'), true);
});

test('R=0 is valid; absent fields and unsupported schema never become fabricated inputs', () => {
  const zero = normalizeContext({ schemaVersion: 1, targetStockRatio: measure('0', 'percent', { kind: 'ark_observed' }) }, options);
  assert.equal(zero.ratio.value, '0');
  assert.equal(zero.fx, null);
  assert.deepEqual(zero.quotes, []);
  const absent = normalizeContext(undefined, options);
  assert.equal(absent.ratio, null);
  assert.equal(absent.fx, null);
  const incompatible = normalizeContext({ schemaVersion: 2, targetStockRatio: measure('80', 'percent', { kind: 'ark_observed' }) }, options);
  assert.equal(incompatible.ratio, null);
  assert.ok(incompatible.warnings.length);
});

test('future R, FX, price, and K timestamps are rejected independently', () => {
  const future = { asOf: '2026-10-16T03:00:00+08:00' };
  const result = normalizeContext({
    schemaVersion: 1,
    targetStockRatio: measure('70', 'percent', { kind: 'ark_observed', ...future }),
    usdTwd: measure('32', 'TWD_per_USD', future),
    quotes: [
      quote({ symbol: 'FUTURE', price: measure('200', 'USD', future) }),
      quote({ arkK9: measure('1.2', 'strategy_K9', { kind: 'ark_observed', ...future }) }),
    ],
  }, options);
  assert.equal(result.ratio, null);
  assert.equal(result.fx, null);
  assert.deepEqual(result.quotes.map(row => row.symbol), ['AAPL']);
  assert.equal(result.quotes[0].k, null);
  assert.ok(result.warnings.some(message => message.includes('未來')));
});

test('impossible calendar dates and 24:00 timestamps cannot become calculator inputs', () => {
  for (const asOf of ['2026-02-30T01:00:00+08:00', '2026-10-14T24:00:00+08:00']) {
    const result = normalizeContext({
      schemaVersion: 1,
      targetStockRatio: measure('70', 'percent', { kind: 'ark_observed', asOf }),
      usdTwd: measure('32', 'TWD_per_USD', { asOf }),
      quotes: [
        quote({ symbol: 'BADPRICE', price: measure('200', 'USD', { asOf }) }),
        quote({ arkK9: measure('1.2', 'strategy_K9', { kind: 'ark_observed', asOf }) }),
      ],
    }, options);
    assert.equal(result.ratio, null, asOf);
    assert.equal(result.fx, null, asOf);
    assert.deepEqual(result.quotes.map(row => row.symbol), ['AAPL']);
    assert.equal(result.quotes[0].k, null, asOf);
    assert.equal(normalizeBrief(brief({ generatedAt: asOf }), DAY, options).generatedAt, '');
  }
});

test('stale K is retained with warnings about its age and different price date', () => {
  const result = normalizeContext({ schemaVersion: 1, quotes: [quote({
    arkK9: measure('1.2', 'strategy_K9', { kind: 'ark_observed', asOf: '2026-10-14T20:00:00+08:00' }),
  })] }, options);
  assert.equal(result.quotes[0].k.value, '1.2');
  assert.ok(result.warnings.some(message => message.includes('策略 K') && message.includes('早於')));
  assert.ok(result.warnings.some(message => message.includes('日期不同')));
});

test('chart K and user estimates cannot substitute for observed Ark strategy K', () => {
  const result = normalizeContext({ schemaVersion: 1, quotes: [
    quote({ symbol: 'USER', arkK9: measure('1.2', 'strategy_K9', { kind: 'user_target' }) }),
    quote({ symbol: 'CHART', arkK9: measure('70', 'stochastic_K', { kind: 'ark_observed' }) }),
    quote({ symbol: 'UNKNOWN', arkK9: measure('1.2', 'strategy_K9', { kind: 'model_guess' }) }),
    quote({ symbol: 'ZERO', arkK9: measure('0', 'strategy_K9', { kind: 'ark_observed' }) }),
  ] }, options);
  assert.equal(result.quotes.length, 4, 'valid prices remain usable without a valid K');
  assert.deepEqual(result.quotes.slice(0, 3).map(row => row.k), [null, null, null]);
  assert.equal(result.quotes[3].k.value, '0');
  assert.equal(result.warnings.filter(message => message.includes('未帶入')).length, 3);
});

test('quotes require consistent market/currency/price units and positive prices', () => {
  const result = normalizeContext({ schemaVersion: 1, quotes: [
    quote({ symbol: 'WRONGCCY', currency: 'TWD' }),
    quote({ symbol: 'WRONGUNIT', price: measure('200', 'TWD') }),
    quote({ symbol: 'NOPRICE', price: measure(null, 'USD') }),
    quote({ symbol: 'ZERO', price: measure('0', 'USD') }),
    quote({ symbol: 'BADTYPE', priceType: 'forecast' }),
    quote({ symbol: 'aapl' }), quote(),
    quote({ symbol: '0050', market: 'TW', currency: 'TWD', price: measure('100', 'TWD') }),
  ] }, options);
  assert.deepEqual(result.quotes.map(row => [row.symbol, row.currency]), [['AAPL', 'USD'], ['0050', 'TWD']]);
});

test('source links only allow HTTPS without embedded credentials', () => {
  assert.equal(safeURL('https://example.com/market'), 'https://example.com/market');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', '/relative']) {
    assert.equal(safeURL(url), '');
  }
});

test('loader fetches the latest public brief with omitted credentials and keeps source dates separate', async () => {
  const calls = [];
  const responses = [
    [{ date: '2026-10-15' }, { date: DAY }, { date: '2026-10-14' }],
    brief(),
  ];
  const result = await loadLatest(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(responses.shift());
  }, { now: NOW });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/ark-agent/data/briefs/index.json', '/ark-agent/data/briefs/2026-10-16.json',
  ]);
  for (const { url, init } of calls) {
    assert.ok(url.startsWith(FEED_BASE));
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(result.date, DAY);
  assert.equal(result.generatedAt, AS_OF);
  assert.equal(result.market[0].asOf, '2026-10-15');
  assert.equal(result.loadedAt, NOW.toISOString());
  assert.equal(result.sourceURL, FEED_BASE + DAY + '.json');
});

test('loader rejects an index/source date mismatch', async () => {
  let request = 0;
  await assert.rejects(loadLatest(async () => jsonResponse(request++ === 0 ? [{ date: DAY }] : brief({ date: '2026-10-15' })), { now: NOW }), /日期不一致/);
});

test('HTTP failures reject without accepting a partial import', async () => {
  let calls = 0;
  await assert.rejects(loadLatest(async () => {
    calls++;
    return { ok: false, status: 401, text: async () => { throw new Error('must not parse failure body'); } };
  }, { now: NOW }), /HTTP 401/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(loadLatest(async () => {
    if (calls++ === 0) return jsonResponse([{ date: DAY }]);
    return { ok: false, status: 503 };
  }, { now: NOW }), /HTTP 503/);
  assert.equal(calls, 2);
});

test('invalid JSON and oversized source responses are rejected', async () => {
  await assert.rejects(loadLatest(async () => ({ ok: true, text: async () => '<html>Login</html>' }), { now: NOW }), /JSON/);
  await assert.rejects(loadLatest(async () => ({ ok: true, text: async () => ' '.repeat(2_000_001) }), { now: NOW }), /資料過大/);
});

test('timeout aborts a stalled transport rather than leaving the import pending', async () => {
  let observedSignal;
  const fetcher = async (_url, { signal }) => {
    observedSignal = signal;
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
      if (signal.aborted) rejectAbort();
      else signal.addEventListener('abort', rejectAbort, { once: true });
    });
  };
  await assert.rejects(loadLatest(fetcher, { now: NOW, timeoutMs: 5 }), { name: 'AbortError' });
  assert.equal(observedSignal.aborted, true);
});

const savedSnapshot = (extra = {}) => ({
  schemaVersion: 1,
  importedAt: '2026-10-16T01:30:00+08:00',
  sourceURL: FEED_BASE + DAY + '.json',
  brief: brief(),
  ...extra,
});
const savedStatus = (extra = {}) => ({
  schemaVersion: 1,
  status: 'success',
  checkedAt: '2026-10-16T01:30:00+08:00',
  lastSuccessfulImportAt: '2026-10-16T01:30:00+08:00',
  ...extra,
});
const savedFetcher = (snapshot = savedSnapshot(), status = savedStatus(), calls = []) => async (url, init) => {
  calls.push({ url, init });
  const path = url.split('?')[0];
  if (path === './data/background.json') return jsonResponse(snapshot);
  if (path === './data/import-status.json') return jsonResponse(status);
  throw new Error('Unexpected request: ' + url);
};

test('saved loader normalizes the local snapshot without overwriting source timestamps', async () => {
  const calls = [];
  const snapshot = savedSnapshot({ brief: brief({ calculatorContext: {
    schemaVersion: 1,
    targetStockRatio: measure('0', 'percent', { kind: 'ark_observed' }),
    quotes: [quote({ symbol: 'aapl' })],
  } }) });
  const result = await loadSaved(savedFetcher(snapshot, savedStatus(), calls), { now: NOW });
  assert.deepEqual(calls.map(call => call.url.split('?')[0]).sort(), [
    './data/background.json', './data/import-status.json',
  ]);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(result.market[0].value, 20000);
  assert.equal(result.market[0].asOf, '2026-10-15');
  assert.equal(result.context.ratio.value, '0');
  assert.equal(result.context.quotes[0].symbol, 'AAPL');
  assert.equal(result.generatedAt, AS_OF);
  assert.equal(result.importedAt, snapshot.importedAt);
  assert.equal(result.loadedAt, NOW.toISOString());
  assert.equal(result.sourceURL, snapshot.sourceURL);
  assert.equal(result.importStatus.status, 'success');
});

test('an import error status preserves the last good snapshot and its original freshness', async () => {
  const snapshot = savedSnapshot({
    importedAt: '2026-10-15T20:00:00+08:00',
    sourceURL: FEED_BASE + '2026-10-15.json',
    brief: brief({ date: '2026-10-15', generatedAt: '2026-10-15T19:00:00+08:00' }),
  });
  const status = savedStatus({
    status: 'error',
    message: 'Source unavailable',
    lastSuccessfulImportAt: snapshot.importedAt,
  });
  const result = await loadSaved(savedFetcher(snapshot, status), { now: NOW });
  assert.equal(result.date, '2026-10-15');
  assert.equal(result.importedAt, '2026-10-15T20:00:00+08:00');
  assert.equal(result.generatedAt, '2026-10-15T19:00:00+08:00');
  assert.deepEqual(result.importStatus, status);
  assert.equal(result.market[0].value, 20000);
});

test('saved source URLs must match the exact public feed and snapshot day', async () => {
  for (const sourceURL of [
    'https://example.com/2026-10-16.json',
    'https://fanhow.github.io.evil.example/ark-agent/data/briefs/2026-10-16.json',
    'https://ark-agent.fanhow.chatgpt.site/api/briefs',
    FEED_BASE + '2026-10-15.json',
    FEED_BASE + DAY + '.json?redirect=https://example.com',
  ]) {
    await assert.rejects(loadSaved(savedFetcher(savedSnapshot({ sourceURL })), { now: NOW }), /快照格式不符/);
  }
});

test('saved snapshots reject future import times, future status times, and future brief days', async () => {
  const future = '2026-10-16T03:00:00+08:00';
  await assert.rejects(loadSaved(savedFetcher(savedSnapshot({ importedAt: future })), { now: NOW }), /未來/);
  await assert.rejects(loadSaved(savedFetcher(savedSnapshot(), savedStatus({ checkedAt: future })), { now: NOW }), /未來/);
  await assert.rejects(loadSaved(savedFetcher(savedSnapshot({
    brief: brief({ date: '2026-10-17' }),
    sourceURL: FEED_BASE + '2026-10-17.json',
  })), { now: NOW }), /未來/);
});

test('saved loader requires both local snapshot and status HTTP reads to succeed', async () => {
  for (const failingPath of ['./data/background.json', './data/import-status.json']) {
    const otherwise = savedFetcher();
    await assert.rejects(loadSaved(async (url, init) => {
      if (url.split('?')[0] === failingPath) return { ok: false, status: 404 };
      return otherwise(url, init);
    }, { now: NOW }), /尚未取得/);
  }
});
