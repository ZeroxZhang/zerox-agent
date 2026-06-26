import { describe, expect, it } from "vitest";
import { getMaterialNavigationIcon } from "./materialNavigation";
import { getNavigationSections } from "./navigation";

describe("material navigation icons", () => {
  it("has an icon for every navigation section", () => {
    for (const section of getNavigationSections()) {
      expect(getMaterialNavigationIcon(section.id)).toMatchObject({
        label: expect.any(String),
        glyph: expect.any(String),
      });
    }
  });

  it("keeps a compatibility icon for overview hashes", () => {
    expect(getMaterialNavigationIcon("overview")).toMatchObject({
      label: "总览",
      glyph: expect.any(String),
    });
  });
});
