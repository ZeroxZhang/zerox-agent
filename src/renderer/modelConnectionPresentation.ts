import type { PublicProviderConnection } from "../shared/modelSettings";

export type ModelConnectionState = "verified" | "failed" | "unknown";

export function modelConnectionState(
  connection: PublicProviderConnection,
): ModelConnectionState {
  if (
    !connection.hasCredential ||
    connection.availability === "unavailable" ||
    connection.verification?.status === "failed"
  ) {
    return "failed";
  }
  if (
    connection.verification?.status === "passed" &&
    connection.verification.connectionRevision === connection.revision
  ) {
    return "verified";
  }
  return "unknown";
}
