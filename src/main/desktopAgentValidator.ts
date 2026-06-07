import type { AgentBootstrapValidationReport } from "../shared/agentBootstrap";
import {
  parseApiInfoProfiles,
  redactApiInfoProfile,
  type ApiInfoProfile,
  type RedactedApiInfoProfile,
} from "../shared/apiInfoProfiles";
import type { ModelSettingsInput, PublicModelSettings } from "../shared/modelSettings";

export type DesktopAgentValidationAttempt = {
  profile: RedactedApiInfoProfile;
  ready: boolean;
  report: AgentBootstrapValidationReport | null;
  error?: string;
};

export type DesktopAgentValidationResult = {
  ok: boolean;
  checkedAt: string;
  totalProfiles: number;
  selectedProfile: RedactedApiInfoProfile | null;
  attempts: DesktopAgentValidationAttempt[];
};

export async function runDesktopAgentValidation(options: {
  apiInfoMarkdown: string;
  modelSettingsStore: {
    save(input: ModelSettingsInput): Promise<PublicModelSettings>;
  };
  validateAgent: () => Promise<AgentBootstrapValidationReport>;
  now?: () => Date;
}): Promise<DesktopAgentValidationResult> {
  const profiles = parseApiInfoProfiles(options.apiInfoMarkdown);
  const attempts: DesktopAgentValidationAttempt[] = [];
  const now = options.now ?? (() => new Date());

  for (const profile of profiles) {
    const redactedProfile = redactApiInfoProfile(profile);

    try {
      await options.modelSettingsStore.save(toModelSettingsInput(profile));
      const report = await options.validateAgent();
      const attempt = {
        profile: redactedProfile,
        ready: report.ready,
        report,
      };
      attempts.push(attempt);

      if (report.ready) {
        return {
          ok: true,
          checkedAt: now().toISOString(),
          totalProfiles: profiles.length,
          selectedProfile: redactedProfile,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        profile: redactedProfile,
        ready: false,
        report: null,
        error: sanitizeError(
          error instanceof Error ? error.message : String(error),
          profiles,
        ),
      });
    }
  }

  return {
    ok: false,
    checkedAt: now().toISOString(),
    totalProfiles: profiles.length,
    selectedProfile: null,
    attempts,
  };
}

function toModelSettingsInput(profile: ApiInfoProfile): ModelSettingsInput {
  return {
    baseUrl: profile.baseUrl,
    chatModel: profile.model,
    embeddingModel: "",
    apiKey: profile.apiKey,
    temperature: 0.2,
    maxTokens: 8192,
  };
}

function sanitizeError(message: string, profiles: ApiInfoProfile[]): string {
  return profiles.reduce(
    (current, profile) => current.replaceAll(profile.apiKey, "[REDACTED]"),
    message,
  );
}
