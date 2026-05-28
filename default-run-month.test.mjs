import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeDefaultMonth,
  defaultRunCodeForMonth,
  defaultWeekendRunDateRange,
  parseDefaultRunCode,
} from "./default-run-month.js";

function d(y, m, day) {
  return new Date(y, m, day);
}

describe("activeDefaultMonth", () => {
  it("mid-June stays on June", () => {
    const { year, month } = activeDefaultMonth(d(2026, 5, 15));
    assert.equal(year, 2026);
    assert.equal(month, 5);
  });

  it("late June rolls to July", () => {
    const { year, month } = activeDefaultMonth(d(2026, 5, 27));
    assert.equal(year, 2026);
    assert.equal(month, 6);
  });

  it("day before last week stays on current month", () => {
    const { year, month } = activeDefaultMonth(d(2026, 5, 23));
    assert.equal(year, 2026);
    assert.equal(month, 5);
  });
});

describe("default run codes", () => {
  it("formats and parses MONTHYEAR", () => {
    assert.equal(defaultRunCodeForMonth(2026, 5), "JUNE2026");
    assert.deepEqual(parseDefaultRunCode("june2026"), { year: 2026, month: 5 });
  });
});

describe("defaultWeekendRunDateRange carryover rules", () => {
  it("extends dateEnd to Sunday when month ends Friday", () => {
    // May 2026 ends on Fri (29). Should extend to Sun (31).
    assert.deepEqual(defaultWeekendRunDateRange(2026, 4), {
      dateStart: "2026-05-01",
      dateEnd: "2026-05-31",
    });
  });

  it("starts on Monday when month starts Sunday (carried weekend)", () => {
    // June 2026 starts on Mon already; July 2026 starts on Wed (no shift).
    // Use August 2026 which starts Sat (Aug 1, 2026 is Sat) -> shift to Mon Aug 3.
    assert.deepEqual(defaultWeekendRunDateRange(2026, 7), {
      dateStart: "2026-08-03",
      dateEnd: "2026-08-31",
    });
  });
});
