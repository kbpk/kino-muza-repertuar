import assert from "node:assert/strict";
import test from "node:test";
import { expectedRepertoireUpdate } from "../public/lib.js";
import { updateScheduleDecision } from "../scripts/check-update-due.mjs";

test("opóźniony wieczorny run nadal nadrabia aktualizację", () => {
  const now = new Date("2026-09-04T18:53:00Z");
  const decision = updateScheduleDecision("schedule", "2026-09-04T11:17:00Z", now);
  assert.equal(decision.run, true);
  assert.equal(decision.target.key, "2026-09-04 18:00");
});

test("nie powtarza wykonanej aktualizacji", () => {
  const now = new Date("2026-09-04T18:53:00Z");
  assert.equal(updateScheduleDecision("schedule", "2026-09-04T16:10:00Z", now).run, false);
});

test("wtorek wybiera ostatnią należną aktualizację", () => {
  const now = new Date("2026-09-08T15:30:00Z");
  assert.equal(expectedRepertoireUpdate(now, 0).key, "2026-09-08 16:00");
  assert.equal(updateScheduleDecision("schedule", "2026-09-08T12:10:00Z", now).run, true);
  assert.equal(updateScheduleDecision("schedule", "2026-09-08T14:10:00Z", now).run, false);
});

test("przed południem odnosi się do poprzedniego wieczoru", () => {
  const now = new Date("2026-09-07T09:30:00Z");
  assert.equal(expectedRepertoireUpdate(now, 0).key, "2026-09-06 18:00");
  assert.equal(updateScheduleDecision("schedule", "2026-09-06T16:10:00Z", now).run, false);
});

test("ręczne uruchomienie zawsze pomija gate", () => {
  assert.deepEqual(updateScheduleDecision("workflow_dispatch", "", new Date("2026-09-04T00:00:00Z")), {
    run: true,
    target: null,
  });
});
