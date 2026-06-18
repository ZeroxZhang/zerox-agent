export type LocationResourceEnvironment = {
  homeDir?: string;
  workspaceRoot?: string;
  platform?: NodeJS.Platform;
};

export type LocationResource = {
  original: string;
  path: string;
  root: string;
};

export type LocationResolver = {
  env: Required<LocationResourceEnvironment>;
  resolve(value: string): LocationResource;
  normalizePath(value: string): string;
  normalizeBoundaryPath(value: string): string;
  isInsideRoot(candidatePath: string, rootPath: string): boolean;
};

const desktopAliases = new Set(["Desktop", "桌面"]);
const downloadsAliases = new Set(["Downloads", "下载"]);

export function createLocationResolver(
  env: LocationResourceEnvironment = {},
): LocationResolver {
  const resolvedEnv: Required<LocationResourceEnvironment> = {
    homeDir: normalizeAbsolutePath(env.homeDir ?? getDefaultHomeDir()),
    workspaceRoot: normalizeAbsolutePath(env.workspaceRoot ?? getDefaultWorkspaceRoot()),
    platform: env.platform ?? getDefaultPlatform(),
  };

  return {
    env: resolvedEnv,
    resolve(value) {
      return resolveLocationResource(value, resolvedEnv);
    },
    normalizePath(value) {
      return normalizeLocationPath(value, resolvedEnv);
    },
    normalizeBoundaryPath(value) {
      return normalizeLocationBoundaryPath(value, resolvedEnv);
    },
    isInsideRoot(candidatePath, rootPath) {
      return isPathInsideLocationRoot(candidatePath, rootPath, resolvedEnv);
    },
  };
}

export function resolveLocationResource(
  value: string,
  env: LocationResourceEnvironment = {},
): LocationResource {
  const normalizedPath = normalizeLocationPath(value, env);
  return {
    original: value,
    path: normalizedPath,
    root: normalizeParentRoot(normalizedPath),
  };
}

export function normalizeLocationPath(
  value: string,
  env: LocationResourceEnvironment = {},
): string {
  const resolvedEnv = normalizeLocationEnvironment(env);
  const cleaned = normalizeSeparators(value.trim());

  if (!cleaned || cleaned === ".") {
    return resolvedEnv.workspaceRoot;
  }

  if (cleaned === "~") {
    return resolvedEnv.homeDir;
  }

  if (cleaned.startsWith("~/")) {
    return normalizeHomeRelativePath(cleaned.slice(2), resolvedEnv.homeDir);
  }

  if (isAbsoluteLocationPath(cleaned)) {
    return normalizeAbsolutePath(cleaned);
  }

  const [firstSegment, ...rest] = cleaned.split("/");
  if (desktopAliases.has(firstSegment)) {
    return normalizeAbsolutePath(
      joinLocationPath(resolvedEnv.homeDir, "Desktop", rest.join("/")),
    );
  }

  if (downloadsAliases.has(firstSegment)) {
    return normalizeAbsolutePath(
      joinLocationPath(resolvedEnv.homeDir, "Downloads", rest.join("/")),
    );
  }

  return normalizeAbsolutePath(joinLocationPath(resolvedEnv.workspaceRoot, cleaned));
}

export function normalizeLocationBoundaryPath(
  value: string,
  env: LocationResourceEnvironment = {},
): string {
  return normalizeLocationPath(value, env);
}

export function getLocationResourceRoot(
  value: string,
  env: LocationResourceEnvironment = {},
): string {
  return resolveLocationResource(value, env).root;
}

export function isPathInsideLocationRoot(
  candidatePath: string,
  rootPath: string,
  env: LocationResourceEnvironment = {},
): boolean {
  const candidate = normalizeLocationPath(candidatePath, env);
  const root = normalizeLocationBoundaryPath(rootPath, env);

  return candidate === root || candidate.startsWith(`${root}/`);
}

export function normalizeLocationEnvironment(
  env: LocationResourceEnvironment = {},
): Required<LocationResourceEnvironment> {
  return {
    homeDir: normalizeAbsolutePath(env.homeDir ?? getDefaultHomeDir()),
    workspaceRoot: normalizeAbsolutePath(env.workspaceRoot ?? getDefaultWorkspaceRoot()),
    platform: env.platform ?? getDefaultPlatform(),
  };
}

function normalizeParentRoot(value: string): string {
  if (value === "/") {
    return "/";
  }

  const withoutTrailingSlash = value.replace(/\/+$/g, "");
  const index = withoutTrailingSlash.lastIndexOf("/");
  return index <= 0 ? "/" : withoutTrailingSlash.slice(0, index);
}

function normalizeHomeRelativePath(value: string, homeDir: string): string {
  const [firstSegment, ...rest] = value.split("/");
  if (desktopAliases.has(firstSegment)) {
    return normalizeAbsolutePath(joinLocationPath(homeDir, "Desktop", rest.join("/")));
  }

  if (downloadsAliases.has(firstSegment)) {
    return normalizeAbsolutePath(joinLocationPath(homeDir, "Downloads", rest.join("/")));
  }

  return normalizeAbsolutePath(joinLocationPath(homeDir, value));
}

function normalizeAbsolutePath(value: string): string {
  const cleaned = normalizeSeparators(value);
  const absolute = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  const parts: string[] = [];

  for (const part of absolute.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  const normalized = `/${parts.join("/")}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/g, "") : normalized;
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isAbsoluteLocationPath(value: string): boolean {
  return value.startsWith("/");
}

function joinLocationPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function getDefaultHomeDir(): string {
  return getRuntimeProcess()?.env?.HOME ?? "/";
}

function getDefaultWorkspaceRoot(): string {
  const runtimeProcess = getRuntimeProcess();
  if (typeof runtimeProcess?.cwd === "function") {
    return runtimeProcess.cwd();
  }
  return "/";
}

function getDefaultPlatform(): NodeJS.Platform {
  return getRuntimeProcess()?.platform ?? "darwin";
}

function getRuntimeProcess():
  | (NodeJS.Process & { cwd?: () => string })
  | undefined {
  return typeof process === "undefined" ? undefined : process;
}
