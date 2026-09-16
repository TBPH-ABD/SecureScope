import { describe, expect, it } from "vitest";
import { atLeast, computeScore, emptyCounts, gradeFor } from "../scanner/scoring.js";

const counts = (c: Partial<ReturnType<typeof emptyCounts>>) => ({ ...emptyCounts(), ...c });

describe("computeScore", () => {
  it("is 100 with no findings and ignores informational ones", () => {
    expect(computeScore(emptyCounts())).toBe(100);
    expect(computeScore(counts({ INFO: 50 }))).toBe(100);
  });
  it("penalises one critical more than many lows", () => {
    expect(computeScore(counts({ CRITICAL: 1 }))).toBeLessThan(computeScore(counts({ LOW: 100 })));
  });
  it("has diminishing returns and never goes below 0", () => {
    expect(computeScore(counts({ CRITICAL: 1000, HIGH: 1000, MEDIUM: 1000, LOW: 1000 }))).toBe(0);
    const one = 100 - computeScore(counts({ MEDIUM: 1 }));
    const four = 100 - computeScore(counts({ MEDIUM: 4 }));
    expect(four).toBeLessThan(one * 4);
  });
  it("grades", () => {
    expect(gradeFor(95)).toBe("A");
    expect(gradeFor(80)).toBe("B");
    expect(gradeFor(10)).toBe("F");
  });
  it("compares severities", () => {
    expect(atLeast("CRITICAL", "HIGH")).toBe(true);
    expect(atLeast("LOW", "MEDIUM")).toBe(false);
    expect(atLeast("HIGH", "HIGH")).toBe(true);
  });
});
