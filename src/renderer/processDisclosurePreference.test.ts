import { describe, expect, it } from "vitest";
import {
  PROCESS_DISCLOSURE_PREFERENCE_STORAGE_KEY,
  isProcessDisclosurePreference,
  loadProcessDisclosurePreference,
  saveProcessDisclosurePreference,
} from "./processDisclosurePreference";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("process disclosure preference storage", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(loadProcessDisclosurePreference(createStorage())).toBe("auto");
    expect(loadProcessDisclosurePreference(undefined)).toBe("auto");
  });

  it("round-trips every supported preference", () => {
    const storage = createStorage();
    for (const preference of ["auto", "compact", "open", "pinned"] as const) {
      saveProcessDisclosurePreference(storage, preference);
      expect(loadProcessDisclosurePreference(storage)).toBe(preference);
    }
  });

  it("falls back to auto for an unknown or corrupt stored value", () => {
    expect(loadProcessDisclosurePreference(
      createStorage({ [PROCESS_DISCLOSURE_PREFERENCE_STORAGE_KEY]: "wide" }),
    )).toBe("auto");
    expect(loadProcessDisclosurePreference({
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {},
    })).toBe("auto");
  });

  it("never throws when the storage rejects a write", () => {
    expect(() => saveProcessDisclosurePreference({
      getItem: () => null,
      setItem() {
        throw new Error("quota exceeded");
      },
    }, "open")).not.toThrow();
  });

  it("recognises only the four declared preferences", () => {
    expect(isProcessDisclosurePreference("auto")).toBe(true);
    expect(isProcessDisclosurePreference("compact")).toBe(true);
    expect(isProcessDisclosurePreference("open")).toBe(true);
    expect(isProcessDisclosurePreference("pinned")).toBe(true);
    expect(isProcessDisclosurePreference("closed")).toBe(false);
    expect(isProcessDisclosurePreference(null)).toBe(false);
  });
});
