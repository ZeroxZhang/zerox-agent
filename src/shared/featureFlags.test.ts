import { describe, expect, it } from "vitest";
import { readFeatureFlags } from "./featureFlags";

describe("process sandbox feature flag", () => {
  it("defaults to required", () => {
    expect(readFeatureFlags({}).ZEROX_PROCESS_SANDBOX).toBe("required");
  });

  it("supports deny as the only rollback mode", () => {
    expect(
      readFeatureFlags({ ZEROX_PROCESS_SANDBOX: "deny" })
        .ZEROX_PROCESS_SANDBOX,
    ).toBe("deny");
  });

  it("rejects unrecognized values by restoring the required default", () => {
    expect(
      readFeatureFlags({ ZEROX_PROCESS_SANDBOX: "off" })
        .ZEROX_PROCESS_SANDBOX,
    ).toBe("required");
  });
});

describe("production Kernel and read Code Mode flags", () => {
  it("defaults all production execution to Kernel with read Code Mode enabled", () => {
    expect(readFeatureFlags({})).toMatchObject({
      ZEROX_PRODUCTION_KERNEL: "all",
      ZEROX_READ_CODE_MODE: "on",
    });
  });

  it("supports explicit data-preserving rollback values", () => {
    expect(
      readFeatureFlags({
        ZEROX_PRODUCTION_KERNEL: "off",
        ZEROX_READ_CODE_MODE: "off",
      }),
    ).toMatchObject({
      ZEROX_PRODUCTION_KERNEL: "off",
      ZEROX_READ_CODE_MODE: "off",
    });
    expect(
      readFeatureFlags({
        ZEROX_PRODUCTION_KERNEL: "scheduled",
      }).ZEROX_PRODUCTION_KERNEL,
    ).toBe("scheduled");
  });

  it("rejects unsafe or unknown modes", () => {
    expect(
      readFeatureFlags({
        ZEROX_PRODUCTION_KERNEL: "everything",
        ZEROX_READ_CODE_MODE: "write",
      }),
    ).toMatchObject({
      ZEROX_PRODUCTION_KERNEL: "all",
      ZEROX_READ_CODE_MODE: "on",
    });
  });
});
