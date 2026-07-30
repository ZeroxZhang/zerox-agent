import { describe, expect, it } from "vitest";
import type {
  ProviderConnectionInput,
  PublicProviderConnection,
} from "../shared/modelSettings";
import { requireProviderDescriptor } from "../main/providers/providerRegistry";
import { canReuseDisplayedCredential } from "./modelCredentialReuse";

describe("model credential reuse presentation", () => {
  const connection: PublicProviderConnection = {
    id: "custom_1",
    name: "Gateway",
    providerKind: "custom",
    values: {
      protocol: "openai",
      baseUrl: "https://first.example/v1",
      modelId: "model-a",
    },
    credentialSource: "stored",
    hasCredential: true,
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };

  it("allows a stored key to remain hidden when only the model changes", () => {
    expect(
      canReuseDisplayedCredential(
        requireProviderDescriptor("custom"),
        connection,
        draft({ modelId: "model-b" }),
      ),
    ).toBe(true);
    expect(
      canReuseDisplayedCredential(
        requireProviderDescriptor("custom"),
        connection,
        draft({ baseUrl: "https://first.example/v1/chat/completions/" }),
      ),
    ).toBe(true);
  });

  it("requires a visible replacement when endpoint, protocol, or source changes", () => {
    expect(
      canReuseDisplayedCredential(
        requireProviderDescriptor("custom"),
        connection,
        draft({ baseUrl: "https://second.example/v1" }),
      ),
    ).toBe(false);
    expect(
      canReuseDisplayedCredential(
        requireProviderDescriptor("custom"),
        connection,
        draft({ protocol: "anthropic" }),
      ),
    ).toBe(false);
    expect(
      canReuseDisplayedCredential(requireProviderDescriptor("custom"), connection, {
        ...draft({}),
        credentialSource: "environment",
      }),
    ).toBe(false);
  });

  it("treats Bedrock regions and Vertex projects as credential targets", () => {
    const bedrock = providerConnection("bedrock", {
      region: "us-east-1",
      authMethod: "api_key",
    });
    expect(
      canReuseDisplayedCredential(requireProviderDescriptor("bedrock"), bedrock, {
        ...draftFor(bedrock),
        values: {
          ...bedrock.values,
          region: "us-west-2",
        },
      }),
    ).toBe(false);

    const vertex = providerConnection("vertex", {
      project: "project-a",
      location: "global",
      authMethod: "service_account",
    });
    expect(
      canReuseDisplayedCredential(requireProviderDescriptor("vertex"), vertex, {
        ...draftFor(vertex),
        values: {
          ...vertex.values,
          project: "project-b",
        },
      }),
    ).toBe(false);
  });

  function draft(
    values: Record<string, string>,
  ): ProviderConnectionInput {
    return {
      id: connection.id,
      expectedRevision: connection.revision,
      name: connection.name,
      providerKind: "custom",
      credentialSource: "stored",
      values: { ...connection.values, ...values },
    };
  }
});

function providerConnection(
  providerKind: "bedrock" | "vertex",
  values: Record<string, string>,
): PublicProviderConnection {
  return {
    id: `${providerKind}_1`,
    name: providerKind,
    providerKind,
    values,
    credentialSource: "stored",
    hasCredential: true,
    revision: 1,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

function draftFor(
  connection: PublicProviderConnection,
): ProviderConnectionInput {
  return {
    id: connection.id,
    expectedRevision: connection.revision,
    name: connection.name,
    providerKind: connection.providerKind,
    credentialSource: connection.credentialSource,
    values: { ...connection.values },
  };
}
