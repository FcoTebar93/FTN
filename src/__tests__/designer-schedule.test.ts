import test from "node:test";
import assert from "node:assert/strict";
import type { Weekday } from "../app/designer-types";
import { shouldFireScheduledWorkflow } from "../app/designer-schedule";

test("daily: dispara cuando coincide hora y no hubo run hoy", () => {
  const schedule = { type: "daily" as const, hour: 10, minute: 30, timezone: "UTC" };
  const now = new Date(Date.UTC(2026, 2, 31, 10, 30, 0));
  assert.equal(shouldFireScheduledWorkflow(schedule, null, now), true);
  assert.equal(shouldFireScheduledWorkflow(schedule, now, now), false);
});

test("weekly: solo en días elegidos (UTC miércoles = weekday 2)", () => {
  const schedule = {
    type: "weekly" as const,
    weekdays: [2 as Weekday],
    hour: 8,
    minute: 0,
    timezone: "UTC",
  };
  const wed = new Date(Date.UTC(2026, 3, 1, 8, 0, 0));
  assert.equal(shouldFireScheduledWorkflow(schedule, null, wed), true);
  const thu = new Date(Date.UTC(2026, 3, 2, 8, 0, 0));
  assert.equal(shouldFireScheduledWorkflow(schedule, null, thu), false);
});

test("instant nunca dispara scheduler", () => {
  assert.equal(shouldFireScheduledWorkflow({ type: "instant" }, null, new Date()), false);
});
