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

export type SkillMcpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

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

export type SkillDiscoveryError = {
  folderName: string;
  message: string;
};

export type SkillDiscoveryResult = {
  skills: SkillRecord[];
  errors: SkillDiscoveryError[];
};

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
    ...(Array.isArray(data.mcpServers) && data.mcpServers.length > 0
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
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const server = readRecord(entry);
      if (!readString(server.name) || !readString(server.command)) return null;
      return {
        name: readString(server.name),
        command: readString(server.command),
        ...(Array.isArray(server.args) ? { args: readStringArray(server.args) } : {}),
        ...(isRecord(server.env) ? { env: Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, String(v)])) } : {}),
      };
    })
    .filter((s): s is SkillMcpServerConfig => s !== null);
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
