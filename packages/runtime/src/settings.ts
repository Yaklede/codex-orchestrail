import { Config, Effort, Role, type SettingsInput } from './contracts.js';
import { exists, hash, readJson, safePath } from './files.js';

export const presets = {
  balanced: { scout: 'medium', builder: 'high', reviewer: 'high', expert: 'high' },
  'all-medium': { scout: 'medium', builder: 'medium', reviewer: 'medium', expert: 'medium' },
  'all-high': { scout: 'high', builder: 'high', reviewer: 'high', expert: 'high' },
} as const;
export const configHash = (config: Config) => hash(JSON.stringify(config));
export const hasPreferences = (input: SettingsInput) => !!input.preset || Object.values(input.models ?? {}).some(model => model?.model !== undefined || model?.effort !== undefined);
export const hasChanges = (input: SettingsInput) => hasPreferences(input) || Object.keys(input.limits ?? {}).length > 0;

export function mergeSettings(current: Config, input: SettingsInput): Config {
  const config = structuredClone(current);
  for (const role of Role.options) {
    if (input.preset) config.models[role].effort = presets[input.preset][role];
    Object.assign(config.models[role], input.models?.[role]);
  }
  Object.assign(config.limits, input.limits);
  return Config.parse(config);
}

export async function settings(project: string) {
  const file = await safePath(project, '.orchestrail/config.json');
  const configured = await exists(file);
  const config = configured ? Config.parse(await readJson(file)) : Config.parse({});
  return { configured, config, configHash: configured ? configHash(config) : null, presets, effortValues: Effort.options,
    scope: 'This project. Main conversation settings remain controlled by Codex.',
    modelAvailability: 'Use models and effort levels available on the current host; accepting a config value does not prove availability.' };
}
