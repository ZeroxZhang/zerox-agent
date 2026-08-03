import { describe, expect, it } from "vitest";
import { extractLeadingCdWorkspace } from "./acceptanceCommand";

describe("extractLeadingCdWorkspace", () => {
  it("extracts a plain cd chain", () => {
    expect(
      extractLeadingCdWorkspace("cd /workspace/app && npm test"),
    ).toEqual({ dir: "/workspace/app", rest: "npm test" });
  });

  it("extracts quoted directories and env-prefixed commands", () => {
    expect(
      extractLeadingCdWorkspace(
        'cd "/workspace/my app" && PYTHONPATH=scripts python3 -m unittest discover -s tests -v',
      ),
    ).toEqual({
      dir: "/workspace/my app",
      rest: "PYTHONPATH=scripts python3 -m unittest discover -s tests -v",
    });
  });

  it("extracts relative directories", () => {
    expect(extractLeadingCdWorkspace("cd app && npm test")).toEqual({
      dir: "app",
      rest: "npm test",
    });
  });

  it("refuses chains whose remainder still uses shell control syntax", () => {
    expect(extractLeadingCdWorkspace("cd /w && npm test && npm run build")).toBeNull();
    expect(extractLeadingCdWorkspace("cd /w && npm test | tail -1")).toBeNull();
    expect(extractLeadingCdWorkspace("cd /w && npm test > out.log")).toBeNull();
  });

  it("refuses non-cd commands and empty remainders", () => {
    expect(extractLeadingCdWorkspace("npm test")).toBeNull();
    expect(extractLeadingCdWorkspace("cd /workspace/app")).toBeNull();
    expect(extractLeadingCdWorkspace("cd /workspace/app && ")).toBeNull();
  });
});
