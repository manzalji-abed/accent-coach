import { describe, expect, it } from "vitest";
import { themeOf } from "@/lib/store";
import { applyTheme } from "@/lib/theme";

describe("theme setting", () => {
  it("defaults to system and ignores junk", () => {
    expect(themeOf(null)).toBe("system");
    expect(themeOf({})).toBe("system");
    expect(themeOf({ theme: "dark" })).toBe("dark");
    expect(themeOf({ theme: "purple" as never })).toBe("system");
  });

  it("applyTheme sets and clears data-theme", () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } as unknown as HTMLElement;
    applyTheme("dark", root);
    expect(attrs.get("data-theme")).toBe("dark");
    applyTheme("light", root);
    expect(attrs.get("data-theme")).toBe("light");
    applyTheme("system", root);
    expect(attrs.has("data-theme")).toBe(false);
  });
});
