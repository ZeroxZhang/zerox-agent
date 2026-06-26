import path from "node:path";

type Env = Record<string, string | undefined>;

export function resolveUserDataDirOverride(
  env: Env,
  resolvePath: (input: string) => string = path.resolve,
): string | null {
  const raw = env.ZEROX_AGENT_USER_DATA_DIR ?? env.BUILDING_AGENT_USER_DATA_DIR;
  const trimmed = raw?.trim();
  return trimmed ? resolvePath(trimmed) : null;
}

export function applyUserDataDirOverride(options: {
  env: Env;
  setPath: (name: "userData", value: string) => void;
  resolvePath?: (input: string) => string;
}): string | null {
  const overridePath = resolveUserDataDirOverride(options.env, options.resolvePath);
  if (!overridePath) {
    return null;
  }
  options.setPath("userData", overridePath);
  return overridePath;
}
