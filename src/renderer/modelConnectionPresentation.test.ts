import { describe, expect, it } from "vitest";
import type { PublicProviderConnection } from "../shared/modelSettings";
import { modelConnectionState } from "./modelConnectionPresentation";

describe("model connection presentation", () => {
  it("lets current reachability and credentials override a historical pass", () => {
    expect(
      modelConnectionState(connection({ availability: "unavailable" })),
    ).toBe("failed");
    expect(modelConnectionState(connection({ hasCredential: false }))).toBe(
      "failed",
    );
  });

  it("shows only a usable current pass as verified", () => {
    expect(modelConnectionState(connection({}))).toBe("verified");
    expect(
      modelConnectionState(
        connection({ availability: "available", verification: undefined }),
      ),
    ).toBe("unknown");
    expect(
      modelConnectionState(
        connection({
          verification: {
            status: "passed",
            checkedAt: "2026-07-31T00:00:00.000Z",
            message: "old pass",
            connectionRevision: 1,
          },
          revision: 2,
          availability: "unknown",
        }),
      ),
    ).toBe("unknown");
  });
});

function connection(
  overrides: Partial<PublicProviderConnection>,
): PublicProviderConnection {
  return {
    id: "connection_1",
    name: "OpenAI",
    providerKind: "openai",
    values: { baseUrl: "https://api.openai.com/v1" },
    credentialSource: "stored",
    hasCredential: true,
    availability: "available",
    verification: {
      status: "passed",
      checkedAt: "2026-07-31T00:00:00.000Z",
      message: "passed",
      connectionRevision: 1,
    },
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}
