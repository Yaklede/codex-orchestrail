import { describe, expect, it } from 'vitest';
import { normalizeUsage, parseExec, parseRollout, sumThreads, transcriptLocations, weeklyObservation, SUPPORTED_CODEX_VERSION } from '../scripts/benchmark/metrics.mjs';

const usage = { input_tokens: 100, cached_input_tokens: 70, output_tokens: 20, reasoning_output_tokens: 8 };
const line = value => JSON.stringify(value) + '\n';
const rollout = totals => line({ type: 'session_meta', payload: { id: 'fixture' } }) + totals.map(total => line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } })).join('');

describe('benchmark usage accounting', () => {
  it('keeps live child and parent transcript owners separate before the child stops', () => {
    const hooks = [{ event: 'SessionStart', sessionId: 'parent', transcriptPath: '/parent' }, { event: 'SubagentStart', sessionId: 'parent', agentId: 'child', transcriptPath: '/child' }];
    expect([...transcriptLocations(hooks)]).toEqual([['parent', '/parent'], ['child', '/child']]);
    hooks.push({ event: 'SubagentStop', sessionId: 'parent', agentId: 'child', transcriptPath: '/parent', agentTranscriptPath: '/child' });
    expect([...transcriptLocations(hooks)]).toEqual([['parent', '/parent'], ['child', '/child']]);
  });
  it('does not double count cache or reasoning subsets', () => {
    expect(normalizeUsage(usage)).toMatchObject({ total_tokens: 120, uncached_input_tokens: 30, cache_write_input_tokens: 0 });
    expect(sumThreads([{ threadId: 'parent', usage }, { threadId: 'child', usage }]).total_tokens).toBe(240);
  });
  it('rejects missing, invalid and inconsistent observations instead of using zero', () => {
    for (const raw of [null, {}, { ...usage, input_tokens: -1 }, { ...usage, cached_input_tokens: 101 }, { ...usage, reasoning_output_tokens: 21 }, { ...usage, total_tokens: 121 }]) expect(() => normalizeUsage(raw)).toThrow();
    expect(() => sumThreads([])).toThrow();
    expect(() => sumThreads([{ threadId: 'same', usage }, { threadId: 'same', usage }])).toThrow();
  });
  it('uses the last cumulative observation once, including duplicate token events', () => {
    const later = { ...usage, input_tokens: 140 };
    expect(parseRollout(rollout([usage, later, later]), 'fixture', SUPPORTED_CODEX_VERSION).usage.total_tokens).toBe(160);
  });
  it('rejects changed versions, unrelated transcripts and reset counters', () => {
    expect(() => parseRollout(rollout([usage]), 'fixture', 'codex-cli 9')).toThrow();
    expect(() => parseRollout(rollout([usage]), 'other', SUPPORTED_CODEX_VERSION)).toThrow();
    expect(() => parseRollout(rollout([usage, { ...usage, input_tokens: 99 }]), 'fixture', SUPPORTED_CODEX_VERSION)).toThrow();
    expect(() => parseRollout(rollout([]), 'fixture', SUPPORTED_CODEX_VERSION)).toThrow();
  });
  it('requires one completed native turn', () => {
    const output = line({ type: 'thread.started', thread_id: 'fixture' }) + line({ type: 'turn.completed', usage });
    expect(parseExec(output).usage.total_tokens).toBe(120);
    expect(() => parseExec(output + line({ type: 'turn.completed', usage }))).toThrow();
    expect(() => parseExec(line({ type: 'turn.failed' }))).toThrow();
  });
  it('does not compare weekly windows across a reset or interpret no data as zero', () => {
    expect(weeklyObservation([]).deltaPercentagePoints).toBeNull();
    expect(weeklyObservation([{ at: 'a', usedPercent: 40, resetsAt: 1 }, { at: 'b', usedPercent: 40, resetsAt: 1 }]).deltaPercentagePoints).toBe(0);
    expect(weeklyObservation([{ at: 'a', usedPercent: 40, resetsAt: 1 }, { at: 'b', usedPercent: 1, resetsAt: 2 }]).deltaPercentagePoints).toBeNull();
  });
  it('finds the weekly window by duration rather than assuming secondary', () => {
    const records = rollout([usage]) + line({ timestamp: 'a', type: 'event_msg', payload: { type: 'token_count', rate_limits: {
      limit_id: 'codex', primary: { window_minutes: 10080, used_percent: 40, resets_at: 7 }, secondary: null,
    } } }) + line({ timestamp: 'b', type: 'event_msg', payload: { type: 'token_count', rate_limits: {
      limit_id: 'codex', primary: { window_minutes: 300, used_percent: 99, resets_at: 2 }, secondary: { window_minutes: 10080, used_percent: 41, resets_at: 7 },
    } } }) + line({ timestamp: 'c', type: 'event_msg', payload: { type: 'token_count', rate_limits: {
      limit_id: 'codex_bengalfox', primary: { window_minutes: 10080, used_percent: 80, resets_at: 7 },
    } } });
    const observed = parseRollout(records, 'fixture', SUPPORTED_CODEX_VERSION).weekly;
    expect(observed).toHaveLength(2);
    expect(weeklyObservation(observed).deltaPercentagePoints).toBe(1);
  });
});
