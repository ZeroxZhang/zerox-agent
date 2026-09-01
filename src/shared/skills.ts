import { parse as parseYaml } from "yaml";

export type SkillExecutionMode = "agent" | "script";

export type SkillInputType = "string" | "path" | "number" | "boolean" | "choice";

export type SkillInput = {
  name: string;
  label: string;
  type: SkillInputType;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  choices?: string[];
};

export type SkillPermissions = {
  files: {
    read: string[];
    write: string[];
  };
  shell: {
    commands: string[];
  };
  web: {
    search: boolean;
    fetchDomains: string[];
  };
  memory: {
    read: boolean;
    write: boolean;
  };
};

export type SkillPlanningConfig = {
  required: boolean;
  maxSteps?: number;
};

export type SkillToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  entrypoint: string;
};

export type SkillMcpStdioServerConfig = {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  readRoots?: string[];
  network?: boolean;
};

export type SkillMcpRemoteServerConfig = {
  name: string;
  transport: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
};

export type SkillMcpServerConfig =
  | SkillMcpStdioServerConfig
  | SkillMcpRemoteServerConfig;

export type SkillExecutionConfig = {
  mode: SkillExecutionMode;
  entrypoint: string | null;
  maxTurns?: number;
};

export type SkillManifest = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  execution: SkillExecutionConfig;
  inputs: SkillInput[];
  permissions: SkillPermissions;
  planning?: SkillPlanningConfig;
  tools?: SkillToolDefinition[];
  mcpServers?: SkillMcpServerConfig[];
  dependencies?: string[];
};

export type ParsedSkillMarkdown = {
  manifest: SkillManifest;
  body: string;
};

export type SkillRecord = ParsedSkillMarkdown & {
  rootDir: string;
  skillFile: string;
};

export type PublicSkillMcpStdioServerConfig = Omit<
  SkillMcpStdioServerConfig,
  "args" | "env"
>;

export type PublicSkillMcpRemoteServerConfig = Pick<
  SkillMcpRemoteServerConfig,
  "name" | "transport"
>;

export type PublicSkillMcpServerConfig =
  | PublicSkillMcpStdioServerConfig
  | PublicSkillMcpRemoteServerConfig;

export type PublicSkillManifest = Omit<SkillManifest, "mcpServers"> & {
  mcpServers?: PublicSkillMcpServerConfig[];
};

export type PublicSkillSnapshot = Omit<SkillRecord, "manifest"> & {
  manifest: PublicSkillManifest;
};

export type SkillSnapshotSource = Omit<SkillRecord, "manifest"> & {
  manifest: SkillManifest | PublicSkillManifest;
};

export type SkillDiscoveryError = {
  folderName: string;
  message: string;
};

export type SkillDiscoveryResult = {
  skills: SkillRecord[];
  errors: SkillDiscoveryError[];
};

export function createPublicSkillSnapshot(
  skill: SkillSnapshotSource,
): PublicSkillSnapshot {
  const manifest = skill.manifest;
  return {
    rootDir: skill.rootDir,
    skillFile: skill.skillFile,
    body: skill.body,
    manifest: {
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      version: manifest.version,
      execution: {
        mode: manifest.execution.mode,
        entrypoint: manifest.execution.entrypoint,
        ...(manifest.execution.maxTurns !== undefined
          ? { maxTurns: manifest.execution.maxTurns }
          : {}),
      },
      inputs: manifest.inputs.map((input) => ({
        name: input.name,
        label: input.label,
        type: input.type,
        required: input.required,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.defaultValue !== undefined
          ? { defaultValue: input.defaultValue }
          : {}),
        ...(input.choices !== undefined ? { choices: [...input.choices] } : {}),
      })),
      permissions: {
        files: {
          read: [...manifest.permissions.files.read],
          write: [...manifest.permissions.files.write],
        },
        shell: { commands: [...manifest.permissions.shell.commands] },
        web: {
          search: manifest.permissions.web.search,
          fetchDomains: [...manifest.permissions.web.fetchDomains],
        },
        memory: {
          read: manifest.permissions.memory.read,
          write: manifest.permissions.memory.write,
        },
      },
      ...(manifest.planning !== undefined
        ? {
            planning: {
              required: manifest.planning.required,
              ...(manifest.planning.maxSteps !== undefined
                ? { maxSteps: manifest.planning.maxSteps }
                : {}),
            },
          }
        : {}),
      ...(manifest.tools !== undefined
        ? {
            tools: manifest.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              // JSON Schema is intentionally open content. The surrounding
              // Skill-owned DTO is still reconstructed exactly.
              parameters: structuredClone(tool.parameters),
              entrypoint: tool.entrypoint,
            })),
          }
        : {}),
      ...(manifest.mcpServers !== undefined
        ? {
            mcpServers: manifest.mcpServers.map((server) =>
              createPublicMcpServerConfig(server),
            ),
          }
        : {}),
      ...(manifest.dependencies !== undefined
        ? { dependencies: [...manifest.dependencies] }
        : {}),
    },
  };
}

export function createPublicSkillDiscoveryResult(
  result: SkillDiscoveryResult,
): SkillDiscoveryResult {
  return {
    skills: result.skills.map(
      (skill) => createPublicSkillSnapshot(skill) as SkillRecord,
    ),
    errors: structuredClone(result.errors),
  };
}

function createPublicMcpServerConfig(
  server: SkillMcpServerConfig | PublicSkillMcpServerConfig,
): PublicSkillMcpServerConfig {
  if (server.transport === "stdio") {
    return {
      name: server.name,
      transport: "stdio",
      command: server.command,
      ...(server.readRoots !== undefined
        ? { readRoots: [...server.readRoots] }
        : {}),
      ...(server.network !== undefined ? { network: server.network } : {}),
    };
  }
  return {
    name: server.name,
    transport: server.transport,
  };
}

export class SkillManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillManifestError";
  }
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new SkillManifestError("SKILL.md must start with YAML frontmatter.");
  }

  const rawFrontmatter = match[1];
  const body = markdown.slice(match[0].length).replace(/^\s*\r?\n/, "");
  const data = parseYaml(rawFrontmatter) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    throw new SkillManifestError("SKILL.md frontmatter must be an object.");
  }

  const manifest = normalizeManifest(data);
  validateManifest(manifest);

  return {
    manifest,
    body,
  };
}

function normalizeManifest(data: Record<string, unknown>): SkillManifest {
  const execution = readRecord(data.execution);
  const permissions = readRecord(data.permissions);
  const files = readRecord(permissions.files);
  const shell = readRecord(permissions.shell);
  const web = readRecord(permissions.web);
  const memory = readRecord(permissions.memory);
  const planning = readRecord(data.planning);

  return {
    name: readString(data.name),
    displayName: readString(data.displayName) || readString(data.name),
    description: readString(data.description),
    version: readString(data.version) || "0.1.0",
    execution: {
      mode: readExecutionMode(execution.mode),
      entrypoint: readNullableString(execution.entrypoint),
      ...(readOptionalNumber(execution.maxTurns) !== null
        ? { maxTurns: readOptionalNumber(execution.maxTurns)! }
        : {}),
    },
    inputs: readInputs(data.inputs),
    permissions: {
      files: {
        read: readStringArray(files.read),
        write: readStringArray(files.write),
      },
      shell: {
        commands: readStringArray(shell.commands),
      },
      web: {
        search: readBoolean(web.search, false),
        fetchDomains: readStringArray(web.fetchDomains),
      },
      memory: {
        read: readBoolean(memory.read, false),
        write: readBoolean(memory.write, false),
      },
    },
    ...(planning.required !== undefined || planning.maxSteps !== undefined
      ? {
          planning: {
            required: readBoolean(planning.required, false),
            ...(readOptionalNumber(planning.maxSteps) !== null
              ? { maxSteps: readOptionalNumber(planning.maxSteps)! }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(data.tools) && data.tools.length > 0
      ? { tools: readSkillToolDefinitions(data.tools) }
      : {}),
    ...(data.mcpServers !== undefined
      ? { mcpServers: readMcpServerConfigs(data.mcpServers) }
      : {}),
    ...(Array.isArray(data.dependencies) && data.dependencies.length > 0
      ? { dependencies: readDependencies(data.dependencies) }
      : {}),
  };
}

function validateManifest(manifest: SkillManifest) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
    throw new SkillManifestError(
      "Skill name must use lowercase letters, numbers, and hyphens.",
    );
  }

  if (!manifest.description) {
    throw new SkillManifestError("Skill description is required.");
  }

  if (
    manifest.execution.mode === "script" &&
    !manifest.execution.entrypoint
  ) {
    throw new SkillManifestError("Script skills require execution.entrypoint.");
  }
}

function readInputs(value: unknown): SkillInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const input = readRecord(entry);
    const name = readString(input.name);
    const label = readString(input.label) || name;
    const type = readInputType(input.type);
    const description = readString(input.description);
    const defaultValue = readInputDefaultValue(input.defaultValue);
    const choices = readStringArray(input.choices);

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      throw new SkillManifestError(
        "Skill input names must use letters, numbers, and underscores.",
      );
    }

    return {
      name,
      label,
      type,
      required: readBoolean(input.required, false),
      ...(description ? { description } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(choices.length > 0 ? { choices } : {}),
    };
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  const stringValue = readString(value);
  return stringValue || null;
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

function readInputDefaultValue(value: unknown): string | number | boolean | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function readSkillToolDefinitions(value: unknown): SkillToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const tool = readRecord(entry);
      if (!readString(tool.name) || !readString(tool.description) || !readString(tool.entrypoint)) {
        return null;
      }
      return {
        name: readString(tool.name),
        description: readString(tool.description),
        parameters: isRecord(tool.parameters) ? tool.parameters : { type: "object", properties: {} },
        entrypoint: readString(tool.entrypoint),
      };
    })
    .filter((t): t is SkillToolDefinition => t !== null);
}

function readMcpServerConfigs(value: unknown): SkillMcpServerConfig[] {
  if (!Array.isArray(value)) {
    throw new SkillManifestError("Skill mcpServers must be an array.");
  }
  return value.map((entry, index) => {
    const server = readRecord(entry);
    const name = readString(server.name);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new SkillManifestError(
        `Skill mcpServers[${index}] requires a valid name.`,
      );
    }
    const transport = readString(server.transport) || "stdio";
    if (transport === "stdio") {
      const command = readString(server.command);
      if (!command) {
        throw new SkillManifestError(
          `Skill MCP stdio server "${name}" requires command.`,
        );
      }
      if (server.url !== undefined || server.headers !== undefined) {
        throw new SkillManifestError(
          `Skill MCP stdio server "${name}" cannot declare url or headers.`,
        );
      }
      return {
        name,
        transport: "stdio" as const,
        command,
        ...(Array.isArray(server.args) ? { args: readStringArray(server.args) } : {}),
        ...(server.env !== undefined
          ? { env: readStringRecord(server.env, `MCP stdio server "${name}" env`) }
          : {}),
        ...(server.readRoots !== undefined
          ? { readRoots: readStringArrayStrict(server.readRoots, `MCP stdio server "${name}" readRoots`) }
          : {}),
        ...(server.network !== undefined
          ? { network: readStrictBoolean(server.network, `MCP stdio server "${name}" network`) }
          : {}),
      };
    }
    if (transport === "http" || transport === "sse") {
      if (
        server.command !== undefined ||
        server.args !== undefined ||
        server.env !== undefined ||
        server.readRoots !== undefined ||
        server.network !== undefined
      ) {
        throw new SkillManifestError(
          `Skill MCP ${transport} server "${name}" cannot declare stdio fields.`,
        );
      }
      const url = readString(server.url);
      if (!isHttpsUrl(url)) {
        throw new SkillManifestError(
          `Skill MCP ${transport} server "${name}" requires an https URL.`,
        );
      }
      return {
        name,
        transport,
        url,
        ...(server.headers !== undefined
          ? { headers: readStringRecord(server.headers, `MCP ${transport} server "${name}" headers`) }
          : {}),
      };
    }
    throw new SkillManifestError(
      `Skill MCP server "${name}" has unsupported transport "${transport}".`,
    );
  });
}

function readStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  if (!isRecord(value)) {
    throw new SkillManifestError(`${label} must be an object.`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim() || typeof item !== "string") {
      throw new SkillManifestError(`${label} values must be strings.`);
    }
    result[key] = item;
  }
  return result;
}

function readStringArrayStrict(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new SkillManifestError(`${label} must be an array of strings.`);
  }
  return readStringArray(value);
}

function readStrictBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new SkillManifestError(`${label} must be a boolean.`);
  }
  return value;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function readDependencies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((d) => readString(d)).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readString(item))
    .filter((item) => item.length > 0);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readExecutionMode(value: unknown): SkillExecutionMode {
  if (value === "agent" || value === "script") {
    return value;
  }
  // Default to "agent" for shared skills that don't specify execution mode
  return "agent";
}

function readInputType(value: unknown): SkillInputType {
  if (
    value === "string" ||
    value === "path" ||
    value === "number" ||
    value === "boolean" ||
    value === "choice"
  ) {
    return value;
  }

  return "string";
}
