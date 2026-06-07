import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

type MinimalViteConfig = {
  base?: string;
};

describe("vite production config", () => {
  it("uses relative asset paths so packaged Electron can load the renderer from file URLs", () => {
    expect((viteConfig as MinimalViteConfig).base).toBe("./");
  });
});
