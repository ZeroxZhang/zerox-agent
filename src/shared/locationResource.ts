export type LocationResourceEnvironment = {
  homeDir?: string;
  workspaceRoot?: string;
  platform?: NodeJS.Platform;
};

type NodeFsBoundaryApi = {
  lstatSync(value: string): { isSymbolicLink(): boolean };
  realpathSync(value: string): string;
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

export type LocationPathBoundaryResult =
  | { ok: true; path: string; root: string }
  | { ok: false; path: string; reason: string };

export type LocationPathBoundaryOptions = {
  allowSymlinks?: boolean;
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

export function validatePathInsideLocationRoots(
  candidatePath: string,
  rootPaths: string[],
  env: LocationResourceEnvironment = {},
  options: LocationPathBoundaryOptions = {},
): LocationPathBoundaryResult {
  const resolvedEnv = normalizeLocationEnvironment(env);
  const candidate = normalizeLocationPath(candidatePath, resolvedEnv);
  const roots = rootPaths.map((rootPath) =>
    normalizeLocationBoundaryPath(rootPath, resolvedEnv),
  );

  for (const root of roots) {
    if (!isNormalizedPathInsideBoundary(candidate, root)) {
      continue;
    }

    if (!options.allowSymlinks) {
      const symlinkPath = findSymlinkPathSegment(root, candidate, resolvedEnv);
      if (symlinkPath) {
        return {
          ok: false,
          path: candidate,
          reason: `Path crosses a symlinked boundary segment: ${symlinkPath}`,
        };
      }
    }

    const realRoot = resolveComparableRealPath(root);
    const realCandidate = resolveComparableRealPath(candidate);
    if (isNormalizedPathInsideBoundary(realCandidate, realRoot)) {
      return { ok: true, path: candidate, root };
    }
  }

  return {
    ok: false,
    path: candidate,
    reason: "Path resolves outside the allowed boundary roots.",
  };
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

function isNormalizedPathInsideBoundary(
  candidatePath: string,
  rootPath: string,
): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function findSymlinkPathSegment(
  rootPath: string,
  candidatePath: string,
  env: Required<LocationResourceEnvironment>,
): string | null {
  const fs = getNodeFsBoundaryApi();
  if (!fs) {
    return null;
  }

  const root = normalizeLocationBoundaryPath(rootPath, env);
  const candidate = normalizeLocationPath(candidatePath, env);
  const relative = candidate === root ? "" : candidate.slice(root.length + 1);
  const segments = relative ? relative.split("/") : [];
  let current = root;

  for (const segment of ["", ...segments]) {
    if (segment) {
      current = joinLocationPath(current, segment);
    }

    try {
      if (fs.lstatSync(current).isSymbolicLink() && !isAllowedSystemPathAlias(current)) {
        return current;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  return null;
}

function resolveComparableRealPath(value: string): string {
  const fs = getNodeFsBoundaryApi();
  const normalized = normalizeAbsolutePath(value);
  if (!fs) {
    return normalized;
  }

  try {
    return normalizeAbsolutePath(fs.realpathSync(normalized));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const parts = normalized.split("/").filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const existingPrefix = `/${parts.slice(0, index + 1).join("/")}`;
    try {
      const realPrefix = normalizeAbsolutePath(fs.realpathSync(existingPrefix));
      const suffix = parts.slice(index + 1).join("/");
      return normalizeAbsolutePath(joinLocationPath(realPrefix, suffix));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return normalized;
}

function isAllowedSystemPathAlias(segmentPath: string): boolean {
  const fs = getNodeFsBoundaryApi();
  if (!fs) {
    return false;
  }

  if (getDefaultPlatform() !== "darwin") {
    return false;
  }

  const normalized = normalizeAbsolutePath(segmentPath);
  if (normalized !== "/var" && normalized !== "/tmp") {
    return false;
  }

  try {
    const target = normalizeAbsolutePath(fs.realpathSync(segmentPath));
    return (
      (normalized === "/var" && target === "/private/var") ||
      (normalized === "/tmp" && target === "/private/tmp")
    );
  } catch {
    return false;
  }
}

function getNodeFsBoundaryApi(): NodeFsBoundaryApi | null {
  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    return null;
  }

  try {
    return runtimeRequire("node:fs") as NodeFsBoundaryApi;
  } catch {
    return null;
  }
}

function getRuntimeRequire(): ((moduleName: string) => unknown) | null {
  const builtinLoader = (
    getRuntimeProcess() as
      | (NodeJS.Process & {
          getBuiltinModule?: (moduleName: string) => unknown;
        })
      | undefined
  )?.getBuiltinModule;
  if (builtinLoader) {
    return (moduleName: string) => builtinLoader(moduleName);
  }

  try {
    const runtimeRequire = (0, eval)(
      "typeof require === 'function' ? require : undefined",
    ) as unknown;
    return typeof runtimeRequire === "function"
      ? (moduleName: string) => runtimeRequire(moduleName)
      : null;
  } catch {
    return null;
  }
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
