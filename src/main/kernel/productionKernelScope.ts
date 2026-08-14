import type { FeatureFlags } from "../../shared/featureFlags";
import type { KernelRunMode } from "../../shared/kernelContract";

export type ProductionKernelScope =
  FeatureFlags["ZEROX_PRODUCTION_KERNEL"];

export function productionKernelCovers(
  scope: ProductionKernelScope,
  mode: KernelRunMode,
): boolean {
  if (scope === "off") return false;
  if (scope === "scheduled") return mode === "scheduled_task";
  if (scope === "scheduled_chat") return mode !== "goal";
  return true;
}
