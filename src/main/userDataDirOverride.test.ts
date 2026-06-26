import { describe, expect, it } from "vitest";
import { applyUserDataDirOverride, resolveUserDataDirOverride } from "./userDataDirOverride";

describe("userDataDirOverride", () => {
  it("ignores missing or blank overrides", () => {
    expect(resolveUserDataDirOverride({}, (value) => `/abs/${value}`)).toBeNull();
    expect(
      resolveUserDataDirOverride({ BUILDING_AGENT_USER_DATA_DIR: "   " }, (value) => `/abs/${value}`),
    ).toBeNull();
  });

  it("resolves the explicit desktop userData override", () => {
    expect(
      resolveUserDataDirOverride({ BUILDING_AGENT_USER_DATA_DIR: "tmp/zerox" }, (value) => `/abs/${value}`),
    ).toBe("/abs/tmp/zerox");
  });

  it("prefers the ZEROX_AGENT_USER_DATA_DIR alias over the legacy BUILDING_AGENT name", () => {
    expect(
      resolveUserDataDirOverride(
        {
          BUILDING_AGENT_USER_DATA_DIR: "legacy",
          ZEROX_AGENT_USER_DATA_DIR: "zerox",
        },
        (value) => `/abs/${value}`,
      ),
    ).toBe("/abs/zerox");
  });

  it("applies the override to Electron userData only when present", () => {
    const calls: Array<[string, string]> = [];
    expect(
      applyUserDataDirOverride({
        env: { BUILDING_AGENT_USER_DATA_DIR: "acceptance" },
        resolvePath: (value) => `/abs/${value}`,
        setPath: (name, value) => calls.push([name, value]),
      }),
    ).toBe("/abs/acceptance");
    expect(calls).toEqual([["userData", "/abs/acceptance"]]);

    expect(
      applyUserDataDirOverride({
        env: {},
        setPath: (name, value) => calls.push([name, value]),
      }),
    ).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
