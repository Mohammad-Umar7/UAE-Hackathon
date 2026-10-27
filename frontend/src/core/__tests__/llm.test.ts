import { describe, expect, it } from "vitest";
import { acceptableBriefing, grounded } from "../agents/llm";

const facts = "3 stand reassignments\n125 landing-sequence targets\nProjected total delay 9750 min vs 9974 min with no coordinated action.\nAirborne holding 1215 min vs 1218 min; uncoordinated fuel diversions 5 vs 8.";

describe("local LLM briefing guard", () => {
  it("accepts a grounded third-person briefing", () => {
    expect(acceptableBriefing("The plan makes 3 stand reassignments and sets 125 landing-sequence targets. It projects 9750 min of total delay against 9974 min with no coordinated action, with uncoordinated fuel diversions down from 8 to 5.", facts)).toBe(true);
  });
  it("rejects invented numbers, spelled-out numbers, first person and wrong directions", () => {
    expect(acceptableBriefing("The plan sets 130 landing-sequence targets.", facts)).toBe(false);
    expect(acceptableBriefing("The plan sets twelve-five landing-sequence targets.", facts)).toBe(false);
    expect(acceptableBriefing("At our airport the plan makes 3 stand reassignments.", facts)).toBe(false);
    expect(acceptableBriefing("Fuel diversions go down from 5 to 8.", facts)).toBe(false);
  });
  it("reads thousands separators as the same number", () => {
    expect(grounded("Total delay 9,750 min.", facts)).toBe(true);
  });
});
