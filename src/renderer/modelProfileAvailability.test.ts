import { describe, expect, it } from "vitest";
import type { PublicModelCatalog } from "../shared/modelSettings";
import { availableChatProfiles } from "./modelProfileAvailability";

describe("available chat profiles", () => {
  it("exposes only exact model revisions verified on usable connections", () => {
    const catalog = {
      schemaVersion: 2,
      descriptors: [],
      entries: [],
      connections: [
        connection("legacy", "unknown"),
        connection("verified", "available", "passed"),
        connection("failed", "unavailable", "failed"),
        connection("unavailable", "unavailable"),
      ],
      profiles: [
        profile("legacy-profile", "legacy"),
        profile("verified-profile", "verified", "passed"),
        profile("untested-profile", "verified"),
        profile("model-failed-profile", "verified", "failed"),
        profile("failed-profile", "failed"),
        profile("unavailable-profile", "unavailable"),
      ],
      defaultChatProfileId: null,
      defaultEmbeddingProfileId: null,
      hiddenRoutedModelIds: [],
      updatedAt: null,
    } satisfies PublicModelCatalog;

    expect(
      availableChatProfiles(catalog).map((profile) => profile.id),
    ).toEqual(["verified-profile"]);
  });
});

function connection(
  id: string,
  availability: "unknown" | "available" | "unavailable",
  verificationStatus?: "passed" | "failed",
): PublicModelCatalog["connections"][number] {
  return {
    id,
    name: id,
    providerKind: "openai",
    values: { baseUrl: "https://api.example.com/v1" },
    credentialSource: "stored",
    hasCredential: true,
    availability,
    ...(verificationStatus
      ? {
          verification: {
            status: verificationStatus,
            checkedAt: "2026-07-31T00:00:00.000Z",
            message: verificationStatus,
            connectionRevision: 1,
          },
        }
      : {}),
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

function profile(
  id: string,
  connectionId: string,
  verificationStatus?: "passed" | "failed",
): PublicModelCatalog["profiles"][number] {
  return {
    id,
    name: id,
    connectionId,
    modelId: id,
    purpose: "chat",
    generation: {
      temperature: 0.2,
      maxTokens: 8192,
      thinkingEnabled: false,
      thinkingBudgetTokens: 8192,
    },
    ...(verificationStatus
      ? {
          verification: {
            status: verificationStatus,
            checkedAt: "2026-07-31T00:00:00.000Z",
            message: verificationStatus,
            connectionRevision: 1,
            profileRevision: 1,
          },
        }
      : {}),
    custom: true,
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}
