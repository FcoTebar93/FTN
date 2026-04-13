import { describe, expect, it } from "vitest";
import { formatHM, parseHM, scheduleSummary } from "./helpers";

describe("designer helpers", () => {
  it("formatHM y parseHM son coherentes", () => {
    expect(formatHM(9, 5)).toBe("09:05");
    expect(parseHM("14:30")).toEqual({ hour: 14, minute: 30 });
  });

  it("parseHM inválido devuelve default", () => {
    expect(parseHM("xx")).toEqual({ hour: 9, minute: 0 });
  });

  it("scheduleSummary", () => {
    expect(scheduleSummary(undefined)).toBe("Instantánea");
    expect(scheduleSummary({ type: "instant" })).toBe("Instantánea");
    expect(scheduleSummary({ type: "daily", hour: 8, minute: 0, timezone: "UTC" })).toContain("Diaria");
  });
});
