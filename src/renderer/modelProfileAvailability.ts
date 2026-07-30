import type {
  ModelProfile,
  PublicModelCatalog,
} from "../shared/modelSettings";

export function availableChatProfiles(
  catalog: PublicModelCatalog | null,
): ModelProfile[] {
  if (!catalog) {
    return [];
  }
  const connectionsById = new Map(
    catalog.connections.map((connection) => [connection.id, connection]),
  );
  return catalog.profiles.filter(
    (profile) => {
      const connection = connectionsById.get(profile.connectionId);
      return !(
        profile.purpose !== "chat" ||
        !connection?.hasCredential ||
        connection.availability === "unavailable" ||
        connection.verification?.status !== "passed" ||
        profile.verification?.status !== "passed"
      );
    },
  );
}
