import { z } from 'zod';

export const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
const text = z.string().min(1).max(16000);
export const Role = z.enum(['scout', 'builder', 'reviewer', 'expert']);
export type Role = z.infer<typeof Role>;
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const Config = z.object({
  schemaVersion: z.literal(1).default(1),
  models: z.object({
    scout: z.object({ model: text, effort: Effort }).default({ model: 'gpt-5.6-sol', effort: 'medium' }),
    builder: z.object({ model: text, effort: Effort }).default({ model: 'gpt-5.6-sol', effort: 'high' }),
    reviewer: z.object({ model: text, effort: Effort }).default({ model: 'gpt-5.6-sol', effort: 'high' }),
    expert: z.object({ model: text, effort: Effort }).default({ model: 'gpt-6-astra', effort: 'high' }),
  }).default({ scout: { model: 'gpt-5.6-sol', effort: 'medium' }, builder: { model: 'gpt-5.6-sol', effort: 'high' }, reviewer: { model: 'gpt-5.6-sol', effort: 'high' }, expert: { model: 'gpt-6-astra', effort: 'high' } }),
  limits: z.object({
    expertAssignments: z.number().int().min(0).max(100).default(3),
    replans: z.number().int().min(0).max(20).default(2),
    failedFixAttempts: z.number().int().min(1).max(10).default(2),
    packetChars: z.number().int().min(2000).max(100000).default(16000),
  }).default({ expertAssignments: 3, replans: 2, failedFixAttempts: 2, packetChars: 16000 }),
}).strict();
export type Config = z.infer<typeof Config>;

const ModelPatch = z.object({ model: text.optional(), effort: Effort.optional() }).strict();
export const SettingsInput = z.object({
  preset: z.enum(['balanced', 'all-medium', 'all-high']).optional(),
  models: z.object({ scout: ModelPatch.optional(), builder: ModelPatch.optional(), reviewer: ModelPatch.optional(), expert: ModelPatch.optional() }).strict().optional(),
  limits: z.object({
    expertAssignments: z.number().int().min(0).max(100).optional(),
    replans: z.number().int().min(0).max(20).optional(),
    failedFixAttempts: z.number().int().min(1).max(10).optional(),
    packetChars: z.number().int().min(2000).max(100000).optional(),
  }).strict().optional(),
  expectedConfigHash: z.string().min(1).optional(),
}).strict();
export type SettingsInput = z.infer<typeof SettingsInput>;

export const Criterion = z.object({ id, description: text }).strict();
export const Plan = z.object({
  summary: text,
  invariants: z.array(text).default([]),
  steps: z.array(z.object({
    id, objective: text, role: Role.default('builder'),
    dependsOn: z.array(id).default([]), files: z.array(text).default([]),
    criteria: z.array(id).min(1),
  }).strict()).min(1),
}).strict();
export type Plan = z.infer<typeof Plan>;
export const RouteInput = z.object({
  kind: z.enum(['routine', 'feature', 'greenfield', 'architecture', 'incident', 'deployment']),
  unresolvedDecisions: z.array(text).default([]),
  environmentBlocker: z.string().max(4000).optional(),
  runbook: z.string().max(4000).optional(),
  reason: text,
}).strict();
export type RouteInput = z.infer<typeof RouteInput>;
export const Result = z.object({
  assignmentId: id, planVersion: z.number().int().min(0),
  status: z.enum(['completed', 'blocked', 'escalate']), summary: text,
  evidenceIds: z.array(id).default([]), blockers: z.array(text).default([]),
}).strict();
export type Result = z.infer<typeof Result>;
export const EvidenceInput = z.object({
  criterionId: id, description: text,
  kind: z.enum(['command', 'inspection']),
  command: z.string().max(8000).optional(), exitCode: z.number().int().nullable().optional(),
  passed: z.boolean(), output: z.string().max(64000).default(''),
  codeHash: text, source: z.enum(['agent', 'user', 'runtime']).default('agent'),
}).strict();
export type EvidenceInput = z.infer<typeof EvidenceInput>;
export const DecisionInput = z.object({
  assignmentId: id, outcome: z.enum(['KEEP_PLAN', 'PATCH_PLAN', 'REPLAN', 'NEEDS_INPUT']),
  summary: text, plan: Plan.optional(),
}).strict();
export type DecisionInput = z.infer<typeof DecisionInput>;
export const AttemptInput = z.object({
  criterionId: id, evidenceId: id, cause: text,
  category: z.enum(['implementation', 'environment']),
  fixDescription: z.string().max(4000).optional(),
}).strict();
export type AttemptInput = z.infer<typeof AttemptInput>;
export type Fingerprint = { head: string | null; hash: string; fileCount: number };
export type Assignment = {
  id: string; role: Role; model: string; effort: string; actualModel?: string;
  objective: string; planVersion: number; taskRevision: number; stepId?: string;
  status: 'reserved' | 'running' | 'completed' | 'blocked' | 'escalate' | 'interrupted';
  taskName: string; nativeTaskName?: string; nativeAgentId?: string; toolUseId?: string; at: string; result?: Result;
};
export type Evidence = EvidenceInput & { id: string; at: string; planVersion: number; taskRevision: number };
export type RunStatus = 'active' | 'waiting_for_input' | 'paused' | 'cancelled' | 'completed';
export type Run = {
  id: string; sessionId: string; goal: string; constraints: string[]; criteria: z.infer<typeof Criterion>[];
  taskRevision: number; status: RunStatus; createdAt: string; updatedAt: string;
  baseline: Fingerprint; plans: (Plan & { version: number; taskRevision: number; at: string })[];
  assignments: Assignment[]; evidence: Evidence[];
  decisions: (DecisionInput & { id: string; at: string; planVersion: number })[];
  attempts: (AttemptInput & { id: string; at: string; fingerprint: string; codeHash: string; taskRevision: number })[];
  route?: RouteInput & { role: Role | null; reasons: string[]; at: string; taskRevision: number };
  pauseReason?: string; resumeChanges?: { previous: string; current: string; at: string };
  observations?: { tool: string; at: string; summary: string; toolUseId?: string }[];
};
export type State = {
  schemaVersion: 1; revision: number; controlRevision?: number; project: string;
  sessions: Record<string, { runId?: string; observedModel?: string; lastHook?: string; hookAt?: string }>;
  runs: Record<string, Run>; receipts: string[];
};
export const StateShape = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), controlRevision: z.number().int().nonnegative().optional(), project: text,
  sessions: z.record(z.string(), z.object({ runId: z.string().optional(), observedModel: z.string().optional(), lastHook: z.string().optional(), hookAt: z.string().optional() })),
  runs: z.record(z.string(), z.unknown()), receipts: z.array(z.string()),
});
export const HookInput = z.object({
  hook_event_name: z.string(), session_id: id, cwd: text,
  turn_id: z.string().optional(), model: z.string().optional(), source: z.string().optional(),
  tool_name: z.string().optional(), tool_use_id: z.string().optional(),
  tool_input: z.unknown().optional(), tool_response: z.unknown().optional(),
  agent_id: z.string().optional(), agent_type: z.string().optional(),
  stop_hook_active: z.boolean().optional(), last_assistant_message: z.string().nullable().optional(),
}).passthrough();
export type HookInput = z.infer<typeof HookInput>;
export class HarnessError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'HarnessError'; }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new HarnessError(code, message);
}
