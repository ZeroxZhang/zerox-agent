export type ApiInfoProfile = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type RedactedApiInfoProfile = Omit<ApiInfoProfile, "apiKey"> & {
  hasApiKey: boolean;
};

export function parseApiInfoProfiles(markdown: string): ApiInfoProfile[] {
  return markdown
    .split(/^#\s+/m)
    .map((section) => section.trim())
    .filter(Boolean)
    .map(parseApiInfoSection)
    .filter((profile): profile is ApiInfoProfile => profile !== null);
}

export function redactApiInfoProfile(
  profile: ApiInfoProfile,
): RedactedApiInfoProfile {
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasApiKey: Boolean(profile.apiKey),
  };
}

function parseApiInfoSection(section: string): ApiInfoProfile | null {
  const [nameLine, ...bodyLines] = section.split(/\n/);
  const body = bodyLines.join("\n");
  const profile = {
    name: nameLine.trim(),
    baseUrl: extractAssignment(body, "base_url"),
    apiKey: extractAssignment(body, "api_key"),
    model: extractAssignment(body, "model"),
  };

  if (!profile.name || !profile.baseUrl || !profile.apiKey || !profile.model) {
    return null;
  }

  return profile;
}

function extractAssignment(body: string, field: string): string {
  const match = body.match(
    new RegExp(`${field}\\s*=\\s*(?:"([^"]+)"|([^\\n}]+))`, "i"),
  );
  const value = match?.[1] ?? match?.[2] ?? "";

  return value.trim().replace(/,$/, "");
}
