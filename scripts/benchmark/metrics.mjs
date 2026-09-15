// Benchmark-only adapter. Rollout JSON is NOT a stable plugin/runtime interface.
export const SUPPORTED_CODEX_VERSION = 'codex-cli 0.154.0';
const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];

export function jsonLines(text) {
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Missing usage');
  const usage = {};
  for (const key of fields) {
    const value = key === 'cache_write_input_tokens' ? raw[key] ?? 0 : raw[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid usage field: ${key}`);
    usage[key] = value;
  }
  if (usage.cached_input_tokens > usage.input_tokens || usage.reasoning_output_tokens > usage.output_tokens) throw new Error('Usage subsets exceed totals');
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  if (!Number.isSafeInteger(usage.total_tokens)) throw new Error('Usage total overflow');
  if (raw.total_tokens !== undefined && raw.total_tokens !== usage.total_tokens) throw new Error('Inconsistent usage total');
  usage.uncached_input_tokens = usage.input_tokens - usage.cached_input_tokens;
  return usage;
}

export function parseExec(text) {
  const events = jsonLines(text);
  const threads = events.filter(e => e.type === 'thread.started');
  const completions = events.filter(e => e.type === 'turn.completed');
  if (threads.length !== 1 || completions.length !== 1) throw new Error('Expected exactly one thread and completed turn');
  return {
    threadId: threads[0].thread_id,
    usage: normalizeUsage(completions[0].usage),
    commandCount: events.filter(e => e.type === 'item.completed' && e.item?.type === 'command_execution').length,
  };
}

export function parseRollout(text, expectedId, version) {
  if (version !== SUPPORTED_CODEX_VERSION) throw new Error(`Unsupported rollout adapter: ${version}`);
  const events = jsonLines(text);
  const meta = events.find(e => e.type === 'session_meta')?.payload;
  if (meta?.id !== expectedId) throw new Error('Rollout does not belong to the expected benchmark thread');
  const usages = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info?.total_token_usage)
    .map(e => normalizeUsage(e.payload.info.total_token_usage));
  if (!usages.length) throw new Error('No observed thread usage');
  for (let i = 1; i < usages.length; i++) {
    for (const key of fields) if (usages[i][key] < usages[i - 1][key]) throw new Error('Cumulative usage decreased; aggregation is unsafe');
  }
  const weekly = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'token_count').flatMap(e => {
    const limits = e.payload.rate_limits;
    if (!limits || limits.limit_id !== 'codex') return [];
    return [limits.primary, limits.secondary].filter(w => w?.window_minutes === 10080).map(w => ({
      at: e.timestamp, usedPercent: w.used_percent, resetsAt: w.resets_at,
    }));
  });
  return { usage: usages.at(-1), weekly };
}

export function sumThreads(threads) {
  const seen = new Set();
  const sum = Object.fromEntries(fields.map(key => [key, 0]));
  for (const thread of threads) {
    if (!thread.threadId || seen.has(thread.threadId)) throw new Error('Duplicate or missing thread ID');
    seen.add(thread.threadId);
    const usage = normalizeUsage(thread.usage);
    for (const key of fields) sum[key] += usage[key];
  }
  if (!seen.size) throw new Error('No measured threads');
  return normalizeUsage(sum);
}

export function weeklyObservation(points) {
  const ordered = [...points].sort((a, b) => a.at.localeCompare(b.at));
  if (!ordered.length) return { first: null, last: null, deltaPercentagePoints: null };
  const first = ordered[0], last = ordered.at(-1);
  const comparable = ordered.every(p => p.resetsAt === first.resetsAt && Number.isFinite(p.usedPercent)) && last.usedPercent >= first.usedPercent;
  return { first, last, deltaPercentagePoints: comparable ? last.usedPercent - first.usedPercent : null };
}
