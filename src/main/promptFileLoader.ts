import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentPromptProfile } from "../shared/agentProtocol";

/** Custom loader type for test injection. */
export type PromptFileLoader = (profile: AgentPromptProfile) => string;

let _loader: PromptFileLoader | undefined;
let _cache = new Map<AgentPromptProfile, string>();
let _baseDir: string | undefined;

/**
 * Set the base directory for prompt files.
 * In development: path.join(__dirname, '../../prompts')
 * In production: path.join(app.getAppPath(), 'prompts')
 */
export function setPromptBaseDir(dir: string): void {
  if (_baseDir !== dir) {
    _baseDir = dir;
    _cache.clear();
  }
}

/**
 * Default file-system loader. Reads .txt files from the prompts/ directory.
 */
function defaultLoad(profile: AgentPromptProfile): string {
  if (_cache.has(profile)) {
    return _cache.get(profile)!;
  }

  if (!_baseDir) {
    // Best-effort: __dirname is dist-electron/main/ in dev
    _baseDir = join(__dirname, "../../prompts");
  }

  const filePath = join(_baseDir, `${profile}.txt`);
  try {
    const content = readFileSync(filePath, "utf-8").trim();
    _cache.set(profile, content);
    return content;
  } catch {
    // Fallback: try default.txt
    try {
      const defaultPath = join(_baseDir, "default.txt");
      const content = readFileSync(defaultPath, "utf-8").trim();
      _cache.set(profile, content);
      return content;
    } catch {
      return "";
    }
  }
}

/**
 * Override the loader (primarily for tests).
 * Pass undefined to restore the default.
 */
export function setPromptFileLoader(loader: PromptFileLoader | undefined): void {
  _loader = loader;
  _cache.clear();
}

/**
 * Load the model-specific prompt content for a given profile.
 * Returns empty string if the file cannot be loaded.
 */
export function loadModelPromptFile(profile: AgentPromptProfile): string {
  const loader = _loader ?? defaultLoad;
  return loader(profile);
}
