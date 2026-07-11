import type { ToolApprovalRequestPayload } from "../shared/toolApproval";

export function shouldShowToolApproval(
  request: ToolApprovalRequestPayload | null,
  autoApprovalEnabled: boolean,
): boolean {
  return Boolean(
    request && (!autoApprovalEnabled || request.risk.requiresConfirmation),
  );
}
