/**
 * Comprehensive smoke test runner for the Tarasa backend.
 *
 * Usage (backend must be running):
 *   API_KEY=<key> API_BASE=http://localhost:4000 npx ts-node src/scripts/smoke-tests.ts
 *
 * It checks (aligned with README):
 * - /api/health (status ok, checks populated)
 * - /api/settings (groups, limits, base URL)
 * - /api/stats (counts, quota)
 * - /api/posts (data shape, classified inline)
 * - /api/messages (queue/sent shape, stats)
 * - /api/logs (recent entries, type presence)
 * - optional manual triggers if API_KEY is provided (scrape, classify, message)
 */

import fetch from 'node-fetch';

type CheckResult = { name: string; ok: boolean; details?: string };

const API_BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY || process.env.X_API_KEY;

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const expect = (cond: boolean, message: string) => {
  if (!cond) {
    throw new Error(message);
  }
};

const run = async () => {
  const results: CheckResult[] = [];

  // Helper to call endpoints with optional API key
  const call = async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = Object.assign({}, (init.headers as Record<string, string>) || {});
    if (API_KEY) {
      (headers as Record<string, string>)['X-API-Key'] = API_KEY;
    }
    // node-fetch types are slightly stricter; strip null body explicitly
    const { body, ...rest } = init;
    const safeInit: any = { ...rest, headers };
    if (body !== null && body !== undefined) {
      safeInit.body = body;
    }
    const res = await fetch(`${API_BASE}${path}`, safeInit);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { res, json };
  };

  const record = (name: string, ok: boolean, details?: string) => {
    results.push({ name, ok, details });
  };

  try {
    // Health
    const { res: healthRes, json: health } = await call('/api/health');
    const healthOk = healthRes.ok && (health as any)?.status === 'ok';
    try {
      expect(typeof (health as any)?.checks === 'object', 'health checks missing');
      expect(typeof (health as any)?.checks?.database === 'boolean', 'database check missing');
      expect(typeof (health as any)?.checks?.facebookSession === 'boolean', 'facebookSession check missing');
      expect(typeof (health as any)?.checks?.openaiKey === 'boolean', 'openaiKey check missing');
      expect(typeof (health as any)?.checks?.apifyToken === 'boolean', 'apifyToken check missing');
    } catch (e) {
      record('Health shape', false, (e as Error).message);
    }
    record('Health', healthOk, pretty(health));

    // Settings
    const { res: settingsRes, json: settings } = await call('/api/settings');
    const settingsOk = settingsRes.ok;
    try {
      const s: any = settings;
      expect(Array.isArray(s.groups), 'settings.groups not array');
      expect('messageLimit' in s, 'settings.messageLimit missing');
      expect(typeof s.baseTarasaUrl === 'string' && s.baseTarasaUrl.length > 0, 'settings.baseTarasaUrl missing');
    } catch (e) {
      record('Settings shape', false, (e as Error).message);
    }
    record('Settings', settingsOk, pretty(settings));

    // Stats
    const { res: statsRes, json: stats } = await call('/api/stats');
    const statsOk = statsRes.ok;
    try {
      const s: any = stats;
      expect(typeof s.postsTotal === 'number', 'stats.postsTotal missing');
      expect(typeof s.classifiedTotal === 'number', 'stats.classifiedTotal missing');
      expect(typeof s.historicTotal === 'number', 'stats.historicTotal missing');
      expect(typeof s.queueCount === 'number', 'stats.queueCount missing');
      expect(typeof s.sentLast24h === 'number', 'stats.sentLast24h missing');
      expect(typeof s.quotaRemaining === 'number', 'stats.quotaRemaining missing');
    } catch (e) {
      record('Stats shape', false, (e as Error).message);
    }
    record('Stats', statsOk, pretty(stats));

    // Posts
    const { res: postsRes, json: posts } = await call('/api/posts');
    const postsOk = postsRes.ok;
    try {
      const data = (posts as any)?.data;
      expect(Array.isArray(data), 'posts.data not array');
      if (Array.isArray(data) && data.length > 0) {
        const p = data[0];
        expect('fbPostId' in p, 'post.fbPostId missing');
        expect('groupId' in p, 'post.groupId missing');
        expect('text' in p, 'post.text missing');
        if (p.classified) {
          expect(typeof p.classified.isHistoric === 'boolean', 'classified.isHistoric missing');
          expect(typeof p.classified.confidence === 'number', 'classified.confidence missing');
        }
      }
    } catch (e) {
      record('Posts shape', false, (e as Error).message);
    }
    record('Posts', postsOk, postsRes.ok ? `count=${Array.isArray((posts as any)?.data) ? (posts as any).data.length : 'unknown'}` : pretty(posts));

    // Messages
    const { res: msgRes, json: messages } = await call('/api/messages');
    const msgOk = msgRes.ok;
    const queueLen = (messages as any)?.queue?.length ?? 'unknown';
    const sentLen = (messages as any)?.sent?.length ?? 'unknown';
    try {
      const m: any = messages;
      expect(Array.isArray(m.queue), 'messages.queue not array');
      expect(Array.isArray(m.sent), 'messages.sent not array');
      expect(typeof m.stats?.queue === 'number', 'messages.stats.queue missing');
      expect(typeof m.stats?.sentLast24h === 'number', 'messages.stats.sentLast24h missing');
      // Invariant checks for queue
      if (Array.isArray(m.queue)) {
        const baseUrl = (settings as any)?.baseTarasaUrl || 'https://tarasa.com';
        for (const q of m.queue) {
          expect(q.messageText?.includes('tarasa'), 'queue message missing tarasa mention');
          expect(q.messageText?.includes(baseUrl) || q.messageText?.includes('tarasa.com'), 'queue message missing link');
          expect(q.link?.includes('refPost='), 'queue link missing refPost');
          expect(q.post?.authorLink, 'queue post missing authorLink (cannot dispatch)');
        }
      }
    } catch (e) {
      record('Messages shape', false, (e as Error).message);
    }
    record('Messages', msgOk, msgOk ? `queue=${queueLen}, sent=${sentLen}` : pretty(messages));

    // Logs
    const { res: logsRes, json: logs } = await call('/api/logs?limit=5');
    const logsOk = logsRes.ok;
    try {
      const l: any = logs;
      expect(Array.isArray(l.data), 'logs.data not array');
    } catch (e) {
      record('Logs shape', false, (e as Error).message);
    }
    record('Logs', logsOk, logsOk ? `recent=${(logs as any)?.data?.length ?? 'unknown'}` : pretty(logs));

    // Error logs check (ensure recent errors are not present)
    const { res: errLogsRes, json: errLogs } = await call('/api/logs?limit=3&type=error');
    const errLogsOk = errLogsRes.ok && Array.isArray((errLogs as any)?.data);
    const hasErrors = errLogsOk && (errLogs as any).data.length > 0;
    record('Logs (errors)', !hasErrors, hasErrors ? `recent errors=${pretty(errLogs)}` : 'none');

    // Invariants across endpoints
    try {
      const statsObj: any = stats;
      const msgObj: any = messages;
      // queueCount should match queue length
      if (typeof statsObj.queueCount === 'number' && Array.isArray(msgObj.queue)) {
        expect(statsObj.queueCount === msgObj.queue.length, 'stats.queueCount mismatch queue length');
      }
      // quotaRemaining bounds
      if (typeof statsObj.quotaRemaining === 'number' && typeof statsObj.messageLimit === 'number') {
        expect(statsObj.quotaRemaining <= statsObj.messageLimit, 'quotaRemaining exceeds messageLimit');
        expect(statsObj.quotaRemaining >= 0, 'quotaRemaining negative');
      }
      // classification coverage: if posts exist, most should be classified
      if (typeof statsObj.postsTotal === 'number' && statsObj.postsTotal > 0) {
        const coverage = statsObj.classifiedTotal / statsObj.postsTotal;
        expect(coverage >= 0.5 || statsObj.postsTotal <= 5, 'classification coverage below 50%');
      }
    } catch (e) {
      record('Invariants', false, (e as Error).message);
    }

    // Optional manual triggers if API key is set
    if (API_KEY) {
      const triggerEndpoints = [
        { name: 'Trigger Scrape', path: '/api/trigger-scrape' },
        { name: 'Trigger Classification', path: '/api/trigger-classification' },
        { name: 'Trigger Message', path: '/api/trigger-message' },
      ];

      for (const t of triggerEndpoints) {
        const { res, json } = await call(t.path, { method: 'POST' });
        record(t.name, res.ok, pretty(json));
      }
    } else {
      record('Triggers (skipped)', true, 'No API_KEY provided');
    }
  } catch (error) {
    record('Unhandled error', false, (error as Error).message);
  }

  // Print summary
  console.log('=== Smoke Test Results ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} - ${r.name}${r.details ? ` -> ${r.details}` : ''}`);
  }

  // Exit non-zero if any failed
  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
};

run();
