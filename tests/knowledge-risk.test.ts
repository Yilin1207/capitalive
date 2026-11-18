import test from "node:test";
import assert from "node:assert/strict";
import {
  assessRisk,
  positionLoss,
  type RiskPosition,
  type RiskPolicy,
} from "../lib/knowledge/risk";
const policy: RiskPolicy = {
  currency: "USD",
  position_limit: 100,
  idea_limit: 200,
  period_limit: 400,
  exposure_limit: 300,
  correlation_limit: 250,
  max_positions_per_idea: 3,
  period_start: "2026-01-01T00:00:00Z",
  period_end: "2026-02-01T00:00:00Z",
  timezone: "UTC",
  risk_mode: "ON",
  drawdown_halt: false,
};
const pos = (id: string, loss = 80): RiskPosition => ({
  position_id: id,
  idea_id: "idea1",
  state: "OPEN",
  currency: "USD",
  worst_loss: loss,
  realized_pnl: 0,
  correlation_group: "USD",
  structural_evidence_id: `proof-${id}`,
});
const now = "2026-01-15T00:00:00Z";
test("risk requires explicit limits; adding never resets idea budget or nets historical winners", () => {
  assert.equal(assessRisk([], pos("a"), null, now).allowed, false);
  const closed = {
    ...pos("old"),
    state: "CLOSED" as const,
    realized_pnl: -100,
    closed_at: "2026-01-02T00:00:00Z",
  };
  const result = assessRisk([closed, pos("a")], pos("b"), policy, now);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("IDEA_LIMIT_EXCEEDED"));
  assert.equal(
    assessRisk(
      [{ ...closed, realized_pnl: 1000 }, pos("a", 100)],
      pos("b", 100),
      policy,
      now,
    ).allowed,
    true,
  );
});
test("risk guards position, period, aggregate correlation, duplicates and Risk Off additions", () => {
  assert.ok(
    assessRisk([], pos("a", 101), policy, now).blockers.includes(
      "POSITION_LIMIT_EXCEEDED",
    ),
  );
  assert.ok(
    assessRisk(
      [pos("a")],
      pos("b"),
      { ...policy, risk_mode: "OFF" },
      now,
    ).blockers.includes("RISK_OFF_NO_ADDING"),
  );
  assert.ok(
    assessRisk(
      [pos("a")],
      { ...pos("b"), structural_evidence_id: "proof-a" },
      policy,
      now,
    ).blockers.includes("ADDING_REQUIRES_NEW_STRUCTURAL_EVIDENCE"),
  );
  assert.equal(assessRisk([pos("a")], pos("a"), policy, now).allowed, false);
  const others = [
    { ...pos("a", 200), idea_id: "other" },
    { ...pos("b", 200), idea_id: "other2" },
  ];
  const r = assessRisk(others, pos("c"), policy, now);
  for (const code of [
    "EXPOSURE_LIMIT_EXCEEDED",
    "PERIOD_LIMIT_EXCEEDED",
    "CORRELATION_LIMIT_EXCEEDED",
  ])
    assert.ok(r.blockers.includes(code));
  assert.equal(
    assessRisk([], pos("a"), { ...policy, position_limit: NaN }, now).allowed,
    false,
  );
});
test("contract/FX conversion and actual confirmed stop are mandatory; no automatic BE profit offset", () => {
  const input = {
    direction: "long" as const,
    entry: 100,
    stop: 95,
    quantity: 2,
    point_value: 10,
    conversion_to_account: 1,
    cost_buffer: 3,
    stop_confirmed: true,
  };
  assert.equal(positionLoss(input).loss, 103);
  assert.equal(positionLoss({ ...input, stop: 105 }).loss, 3);
  assert.equal(positionLoss({ ...input, stop_confirmed: false }).loss, null);
});
