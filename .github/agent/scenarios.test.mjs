import { describe, it } from "vitest";
import { SCENARIOS } from "./sim/scenarios.mjs";

describe("agent pipeline scenarios", () => {
  for (const s of SCENARIOS) it(s.name, async () => void (await s.run()));
});
