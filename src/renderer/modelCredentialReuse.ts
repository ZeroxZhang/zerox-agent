import type {
  ProviderConnectionInput,
  ProviderDescriptor,
  PublicProviderConnection,
} from "../shared/modelSettings";
import { providerConnectionTargetIdentity } from "../shared/modelSettings";

export function canReuseDisplayedCredential(
  descriptor: ProviderDescriptor,
  connection: PublicProviderConnection | null,
  draft: ProviderConnectionInput,
): boolean {
  if (
    !connection?.hasCredential ||
    draft.id !== connection.id ||
    draft.providerKind !== connection.providerKind ||
    (draft.credentialSource ?? connection.credentialSource) !==
      connection.credentialSource
  ) {
    return false;
  }
  const withDefaults = (values: Record<string, string>) =>
    Object.fromEntries(
      descriptor.fields.map((field) => [
        field.key,
        values[field.key] || field.defaultValue || "",
      ]),
    );
  return (
    providerConnectionTargetIdentity(
      descriptor.kind,
      withDefaults(draft.values),
    ) ===
    providerConnectionTargetIdentity(
      descriptor.kind,
      withDefaults(connection.values),
    )
  );
}
