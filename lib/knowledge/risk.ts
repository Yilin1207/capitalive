import { provenance } from "./rules";
export type RiskPolicy = {
  currency: string;
  position_limit: number;
  idea_limit: number;
  period_limit: number;
  exposure_limit: number;
  correlation_limit: number;
  max_positions_per_idea: number;
  period_start: string;
  period_end: string;
  timezone: string;
  risk_mode: "ON" | "OFF";
  drawdown_halt: boolean;
};
export type RiskPosition = {
  position_id: string;
  idea_id: string;
  state: "OPEN" | "PENDING" | "CLOSED";
  currency: string;
  worst_loss: number;
  realized_pnl: number;
  closed_at?: string;
  correlation_group: string;
  structural_evidence_id: string;
};
export function positionLoss(input: {
  direction: "long" | "short";
  entry: number;
  stop: number;
  quantity: number;
  point_value: number;
  conversion_to_account: number;
  cost_buffer: number;
  stop_confirmed: boolean;
}) {
  const values = [
    input.entry,
    input.stop,
    input.quantity,
    input.point_value,
    input.conversion_to_account,
    input.cost_buffer,
  ];
  if (
    values.some((v) => !Number.isFinite(v)) ||
    values.slice(0, 5).some((v) => v <= 0) ||
    input.cost_buffer < 0 ||
    !input.stop_confirmed
  )
    return {
      status: "UNVERIFIED",
      loss: null,
      reason: "VERIFIED_CONTRACT_CONVERSION_AND_STOP_REQUIRED",
    };
  const distance =
    input.direction === "long"
      ? input.entry - input.stop
      : input.stop - input.entry;
  return {
    status: "PARTIAL",
    loss:
      Math.max(0, distance) *
        input.quantity *
        input.point_value *
        input.conversion_to_account +
      input.cost_buffer,
    reason: "EXCLUDES_UNBOUNDED_GAP_SLIPPAGE",
  };
}
export function assessRisk(
  positions: RiskPosition[],
  candidate: RiskPosition | null,
  policy: RiskPolicy | null,
  now = new Date().toISOString(),
) {
  const base = {
    ...provenance("EDGE.RISK.v1"),
    timeframes: [],
    candle_evidence: [],
    data_status: "USER_SUPPLIED_LEDGER_NOT_BROKER_VERIFIED",
    invalidation:
      "Changed ledger, risk limits, contract, conversion or actual broker stop require recalculation",
    automatic_risk_increase: false,
    orders_enabled: false,
    probability: null,
  };
  if (!policy || !candidate)
    return {
      ...base,
      status: "UNCONFIGURED",
      allowed: false,
      blockers: ["EXPLICIT_RISK_POLICY_AND_CANDIDATE_REQUIRED"],
    };
  const amounts = [
    policy.position_limit,
    policy.idea_limit,
    policy.period_limit,
    policy.exposure_limit,
    policy.correlation_limit,
  ];
  const start = Date.parse(policy.period_start),
    end = Date.parse(policy.period_end),
    at = Date.parse(now);
  let validZone = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: policy.timezone }).format(
      new Date(),
    );
  } catch {
    validZone = false;
  }
  if (
    amounts.some((n) => !Number.isFinite(n) || n <= 0) ||
    !policy.currency ||
    !validZone ||
    !Number.isInteger(policy.max_positions_per_idea) ||
    policy.max_positions_per_idea < 1 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(at) ||
    start >= end ||
    at < start ||
    at >= end ||
    !["ON", "OFF"].includes(policy.risk_mode)
  )
    return {
      ...base,
      status: "UNVERIFIED",
      allowed: false,
      blockers: ["INVALID_RISK_POLICY_OR_PERIOD"],
    };
  const all = [...positions, candidate],
    ids = new Set<string>();
  for (const p of all) {
    if (
      !p.position_id ||
      ids.has(p.position_id) ||
      !p.idea_id ||
      p.currency !== policy.currency ||
      !p.correlation_group ||
      !p.structural_evidence_id ||
      !Number.isFinite(p.worst_loss) ||
      p.worst_loss < 0 ||
      !Number.isFinite(p.realized_pnl) ||
      !["OPEN", "PENDING", "CLOSED"].includes(p.state) ||
      (p.state === "CLOSED" &&
        (!p.closed_at ||
          !Number.isFinite(Date.parse(p.closed_at)) ||
          Date.parse(p.closed_at) > at))
    )
      return {
        ...base,
        status: "UNVERIFIED",
        allowed: false,
        blockers: ["INVALID_OR_DUPLICATE_LEDGER_OR_CURRENCY"],
      };
    ids.add(p.position_id);
  }
  if (candidate.state === "CLOSED")
    return {
      ...base,
      status: "UNVERIFIED",
      allowed: false,
      blockers: ["CANDIDATE_MUST_BE_OPEN_OR_PENDING"],
    };
  const open = (p: RiskPosition) => (p.state !== "CLOSED" ? p.worst_loss : 0),
    loss = (p: RiskPosition) =>
      p.state === "CLOSED" ? Math.max(0, -p.realized_pnl) : 0;
  const idea = all.filter((p) => p.idea_id === candidate.idea_id),
    activeIdea = positions.filter(
      (p) => p.idea_id === candidate.idea_id && p.state !== "CLOSED",
    );
  const totals = {
    position: candidate.worst_loss,
    idea: idea.reduce((n, p) => n + open(p) + loss(p), 0),
    period: all.reduce(
      (n, p) =>
        n +
        open(p) +
        (p.closed_at &&
        Date.parse(p.closed_at) >= start &&
        Date.parse(p.closed_at) < end
          ? loss(p)
          : 0),
      0,
    ),
    exposure: all.reduce((n, p) => n + open(p), 0),
    correlation: all
      .filter((p) => p.correlation_group === candidate.correlation_group)
      .reduce((n, p) => n + open(p), 0),
  };
  const blockers: string[] = [];
  for (const key of [
    "position",
    "idea",
    "period",
    "exposure",
    "correlation",
  ] as const)
    if (totals[key] > policy[`${key}_limit`])
      blockers.push(`${key.toUpperCase()}_LIMIT_EXCEEDED`);
  if (policy.drawdown_halt) blockers.push("DRAWDOWN_HALT");
  if (activeIdea.length + 1 > policy.max_positions_per_idea)
    blockers.push("MAX_POSITIONS_PER_IDEA");
  if (activeIdea.length && policy.risk_mode === "OFF")
    blockers.push("RISK_OFF_NO_ADDING");
  if (
    activeIdea.length &&
    positions.some(
      (p) =>
        p.idea_id === candidate.idea_id &&
        p.structural_evidence_id === candidate.structural_evidence_id,
    )
  )
    blockers.push("ADDING_REQUIRES_NEW_STRUCTURAL_EVIDENCE");
  return {
    ...base,
    status: "ASSESSED",
    allowed: blockers.length === 0,
    blockers,
    totals,
    currency: policy.currency,
    idea_id: candidate.idea_id,
    caveat:
      "Budget arithmetic only; evidence IDs must be backed by reviewed findings. No broker stop/FX verification or trade execution.",
  };
}
