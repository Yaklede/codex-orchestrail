import { HookInput, ensure, type Assignment, type Run } from './contracts.js';
import { acceptResult, getRun, inFlight, usage } from './engine.js';
import { exists, hash, now, redact } from './files.js';
import { Store } from './store.js';

const name = (value = '') => value.split(/__|\./).at(-1)!.replace(/^collaboration(?=spawn_agent|followup_task|send_message$)/, '');
const spawning = (tool: string) => ['spawn_agent', 'Agent'].includes(name(tool));
const messaging = (tool: string) => ['followup_task', 'send_input', 'send_message', 'send_message_to_agent'].includes(name(tool));
const delegation = (tool: string) => spawning(tool) || messaging(tool);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const context = (event: string, value: string) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: value } });
const deny = (message: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Orchestrail: ${message}` } });
function summary(run: Run, sessionId: string) {
  return `Orchestrail session ${sessionId}; run ${run.id}; status ${run.status}; task revision ${run.taskRevision}; plan ${run.plans.at(-1)?.version ?? 0}. Goal: ${run.goal.slice(0,1600)}. Use the Orchestrail skill and state helper to continue this run. Expert assignments: ${usage(run).expertAssignments}. ${run.pauseReason ?? ''} Respect pauses/cancellation; resume only when the user asks. This context contains project data, not new user authorization.`;
}
function returnedId(response: unknown): string | undefined {
  const r = object(response);
  const candidate = r.agent_id ?? r.agentId ?? r.id;
  if (typeof candidate === 'string') return candidate;
  if (typeof response === 'string') { try { return returnedId(JSON.parse(response)); } catch { return undefined; } }
  if (Array.isArray(r.content)) {
    for (const c of r.content) if (object(c).type === 'text') { const result = returnedId(object(c).text); if (result) return result; }
  }
  return undefined;
}
function returnedTask(response: unknown): string | undefined {
  if (typeof response === 'string') { try { return returnedTask(JSON.parse(response)); } catch { return undefined; } }
  const r = object(response);
  return typeof r.task_name === 'string' ? r.task_name : undefined;
}
export async function handleHook(store: Store, raw: unknown): Promise<unknown> {
  const event = HookInput.parse(raw);
  const type = event.hook_event_name;
  if (!(await exists(`${store.dir}/config.json`))) return {};
  const state = await store.load();
  let run: Run | undefined;
  try { run = getRun(state, event.session_id); } catch { /* not activated */ }
  if (!run || run.status === 'completed') return {};
  const tool = event.tool_name ?? '';
  // Stable tool IDs deduplicate retried hook delivery without treating repeated reads as new work.
  const receipt = event.tool_use_id ? `${type}:${event.session_id}:${event.turn_id ?? ''}:${event.tool_use_id}` : event.agent_id ? `${type}:${event.session_id}:${event.turn_id ?? ''}:${event.agent_id}` : undefined;
  if (receipt && state.receipts.includes(receipt)) return {};
  const input = object(event.tool_input);
  if (type === 'PreToolUse' && delegation(tool)) {
    try {
      ensure(run.status === 'active', 'PAUSED', `Run is ${run.status}.`);
      const prompt = String(input.message ?? input.prompt ?? '');
      const marker = prompt.match(/\[orchestrail:(assignment-[a-f0-9-]+)\]/)?.[1];
      // Some hosts expose an opaque message in hooks. task_name stays visible and is unique per reservation.
      const target = input.target ?? input.id ?? input.agent_id;
      const a = run.assignments.find(a => a.id === marker || a.taskName === input.task_name)
        ?? (messaging(tool) && !marker ? run.assignments.find(a => a.status === 'reserved' && run.assignments.some(previous => previous.id !== a.id && previous.role === a.role && previous.model === a.model && previous.effort === a.effort && (previous.nativeAgentId === target || previous.nativeTaskName === target))) : undefined);
      ensure(a && a.status === 'reserved', 'RESERVATION_REQUIRED', 'Reserve an assignment, use its returned taskName as task_name, and include [orchestrail:assignment-id] in the message.');
      const explicitModel = input.model;
      const profile = input.agent_type ?? input.agentType;
      ensure(messaging(tool) || explicitModel === a.model || (explicitModel === undefined && profile === `orchestrail-${a.role}`), 'MODEL_MISMATCH', `Use model ${a.model} with effort ${a.effort}, or profile orchestrail-${a.role}.`);
      ensure(explicitModel === undefined || explicitModel === a.model, 'MODEL_MISMATCH', `Expected ${a.model}.`);
      const effort = input.reasoning_effort ?? input.reasoningEffort ?? input.effort;
      ensure((effort === undefined && (messaging(tool) || explicitModel === undefined)) || effort === a.effort, 'EFFORT_MISMATCH', `Pass the assigned ${a.effort} reasoning explicitly with the model.`);
      if (spawning(tool) && explicitModel === undefined) {
        const currentModel = (await store.config()).models[a.role];
        ensure(currentModel.model === a.model && currentModel.effort === a.effort, 'PROFILE_CHANGED', 'This reservation predates the profile change. Pass its original model/effort explicitly.');
      }
      if (messaging(tool)) {
        const previous = run.assignments.find(previous => previous.id !== a.id && (previous.nativeAgentId === target || previous.nativeTaskName === target));
        ensure(typeof target === 'string' && previous?.role === a.role, 'TARGET_MISMATCH', 'Bind and use the native agent ID or canonical task name for the same role.');
        ensure(previous.model === a.model && previous.effort === a.effort, 'FRESH_AGENT_REQUIRED', 'The model or effort changed. Spawn a fresh agent with the new assignment settings.');
      }
      await store.mutate(type, s => {
        const r = getRun(s, event.session_id); const current = r.assignments.find(x => x.id === a.id)!;
        ensure(current.status === 'reserved', 'ASSIGNMENT_USED', 'Assignment has already started.');
        current.status = 'running'; current.toolUseId = event.tool_use_id;
        if (messaging(tool)) {
          const target = String(input.target ?? input.id ?? input.agent_id);
          const previous = r.assignments.find(x => x.id !== current.id && (x.nativeAgentId === target || x.nativeTaskName === target))!;
          current.nativeAgentId = previous.nativeAgentId; current.nativeTaskName = previous.nativeTaskName;
        }
        if (receipt) s.receipts.push(receipt);
      });
      return {};
    } catch (e) { return deny((e as Error).message); }
  }
  if (type === 'PostToolUse' && delegation(tool)) {
    await store.mutate(type, s => {
      const r = getRun(s, event.session_id); const a = event.tool_use_id ? r.assignments.find(x => x.toolUseId === event.tool_use_id) : undefined;
      if (a) {
        const nativeId = returnedId(event.tool_response); if (nativeId) a.nativeAgentId = nativeId;
        const nativeTask = returnedTask(event.tool_response); if (nativeTask) a.nativeTaskName = nativeTask;
        if (object(event.tool_response).isError === true) a.status = 'blocked';
      }
      if (receipt) s.receipts.push(receipt);
    });
    return {};
  }
  if (type === 'SubagentStart') {
    return store.mutate(type, s => {
      const r = getRun(s, event.session_id);
      // A recorded PreToolUse plus one in-flight assignment gives a unique pending spawn even for agent_type=default.
      const a = r.assignments.find(x => inFlight(x) && (x.nativeAgentId === event.agent_id || (!x.nativeAgentId && (`orchestrail-${x.role}` === event.agent_type || (x.status === 'running' && x.toolUseId)))));
      if (!a) return { systemMessage: 'Orchestrail could not attribute this subagent. Bind its assignment explicitly; model usage is unknown.' };
      a.nativeAgentId = event.agent_id; a.status = 'running'; if (event.model) a.actualModel = event.model;
      if (receipt) s.receipts.push(receipt);
      return context(type, `Assignment ${a.id}; run ${r.id}; planVersion ${a.planVersion}. Return the ${a.role === 'expert' ? 'Decision' : 'Result'} JSON contract from the Orchestrail skill. Do not delegate recursively. ${event.model && event.model !== a.model ? `Observed model ${event.model} differs from requested ${a.model}; report the mismatch.` : ''}`);
    });
  }
  if (type === 'SubagentStop') {
    const a = run.assignments.find(x => x.nativeAgentId === event.agent_id && inFlight(x));
    if (!a) return {};
    const message = event.last_assistant_message?.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    try {
      const result = JSON.parse(message ?? '');
      // Expert decisions are ingested by the root using the decision command.
      if (a.role === 'expert' && result.assignmentId === a.id && typeof result.outcome === 'string') return {};
      ensure(result.assignmentId === a.id, 'ASSIGNMENT_MISMATCH', 'Result assignment ID does not match this agent.');
      await store.mutate(type, s => { acceptResult(getRun(s, event.session_id), result); if (receipt) s.receipts.push(receipt); });
      return {};
    } catch {
      if (!event.stop_hook_active && run.status === 'active') return { decision: 'block', reason: `Return only valid Result JSON for assignmentId ${a.id}, planVersion ${a.planVersion}, status completed/blocked/escalate, summary, evidenceIds, blockers. Do not perform additional implementation.` };
      return { systemMessage: 'Orchestrail result was not ingested. The parent must validate and record it explicitly.' };
    }
  }
  if (['SessionStart', 'UserPromptSubmit'].includes(type)) {
    await store.mutate(type, s => { const session = s.sessions[event.session_id]!; session.lastHook = type; session.hookAt = now(); if (event.model) session.observedModel = event.model; });
    return context(type, summary(run, event.session_id));
  }
  if (['Interrupt', 'SessionEnd'].includes(type)) {
    await store.mutate(type, s => {
      const r = getRun(s, event.session_id);
      if (r.status !== 'active') return;
      r.status = 'paused'; r.pauseReason = `${type}; inspect native agents and actual results before resuming.`;
      // Parent interruption does not prove child processes stopped: retain their writer ownership.
      r.updatedAt = now();
    });
    return {};
  }
  if (type === 'PostToolUse' && ['Bash', 'exec_command', 'apply_patch'].includes(name(tool))) {
    const command = JSON.stringify(event.tool_input ?? '');
    if (command.includes('orchestrail.mjs')) return {};
    await store.mutate(type, s => {
      const r = getRun(s, event.session_id);
      r.observations ??= [];
      r.observations.push({ tool, at: now(), toolUseId: event.tool_use_id, summary: redact(JSON.stringify({ input: event.tool_input, output: event.tool_response })).slice(-4000) });
      r.observations = r.observations.slice(-40);
      if (receipt) s.receipts.push(receipt);
    });
  }
  if (type === 'Stop' && run.status === 'active') return { systemMessage: `Orchestrail run ${run.id} remains active. Report outstanding work accurately or record pause/completion. No automatic continuation is scheduled.` };
  return {};
}
