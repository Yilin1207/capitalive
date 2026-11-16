// Original schematic examples of textual definitions, not transcribed chart prices or historical trades.
export const EXAMPLES: Record<string, [string, string, string]> = {
  FRACTAL_3: [
    "Closed highs 10, 12, 11 confirm the middle high at the third close.",
    "10, 12, 12 or an unfinished right candle do not confirm.",
    "Later strict crossing consumes liquidity, without automatically cancelling KL.",
  ],
  FVG: [
    "Outer high 10 and outer low 12 leave a bullish interval; middle body 9 to 13 spans it.",
    "Touching outer wicks or a middle body that does not span the gap reject.",
    "A later close below bullish lower bound or above bearish upper bound invalidates its old role.",
  ],
  IFVG: [
    "A close below the lower edge of a bullish FVG records a breach candidate.",
    "A wick through the edge, or a body closing inside, does not confirm a closed breach.",
    "Opposite trading role is unconfirmed; source continuity loss prevents inference.",
  ],
  RAID: [
    "Known high 12: later high 12 is TOUCH, later high 14 is RAID even if close is 13.",
    "A pivot confirmed only after that bar is not an available liquidity reference.",
    "Liquidity is consumed; structural narrative invalidation is a different test.",
  ],
  RB: [
    "Sell then Buy, both closing outside known support after a strict fractal raid, form a contextual candidate.",
    "One rejection wick, equality-only touch, absent KL or KL formed later reject.",
    "Full candidate-envelope breach withdraws local premise; executable author boundary is unresolved.",
  ],
  SNR: [
    "Buy/Sell origin at body junction 12, wick high 13, KL delivery, then close 12.5 proposes resistance-to-support reversal (el02_04 geometry).",
    "No KL delivery, wick-only break, or an isolated FVG does not establish SNR.",
    "Counter-close through the junction band withdraws proposed role; unequal close/open band is a project convention.",
  ],
  IDM: [
    "A confirmed H4 pivot inside an already-known D1 POI is an inside-POI candidate.",
    "Merely near POI, a future POI, or MN1-to-H4 relation does not satisfy this subset.",
    "POI invalidation or consumed pivot withdraws current trigger; Strong-boundary stop remains required.",
  ],
  STRONG: [
    "A pivot extremum raids older liquidity and is linked to later contextual RB/SNR evidence.",
    "An ordinary geometric pivot with no raid or PA confirmation is not Strong.",
    "Invalidation of linked VC removes the candidate; exact author boundaries still need review.",
  ],
  BOS_CHOCH: [
    "Author machine criteria are not specified; no BOS/CHOCH findings or directional votes are emitted.",
    "A geometric pivot crossing alone does not establish author structure.",
    "Qualitative structure requires source specification and review.",
  ],
  DR: [
    "Selected confirmed high 12 and low 4 define explicit range [4,12].",
    "Missing IDs, mixed variants, reversed bounds or a continuity gap reject selection.",
    "Closed boundary breach requires reviewing the range; internal raid alone does not cancel it.",
  ],
  PREMIUM_DISCOUNT: [
    "For explicit [4,12], EQ=8; [4,8] is discount and [8,12] premium.",
    "EQ is not measured fair value or a probability of mean reversion.",
    "Changing the selected range recalculates the partition.",
  ],
  IRL: [
    "A confirmed pivot at 9 is internal to selected [4,12] after its origin.",
    "A boundary pivot at 12 or an unrelated earlier pivot is not this internal liquidity.",
    "Range invalidation or strict consumption removes current liquidity relevance.",
  ],
  COMPRESSION: [
    "Expose the available pivot sequence and known KL without declaring a pattern.",
    "Two arbitrary highs, missing KL or a chosen ATR threshold cannot prove author Compression.",
    "Classification remains blocked until count, speed and contraction criteria are specified.",
  ],
  DISPLACEMENT: [
    "Report closed candle body, range and body/range fraction as measurements.",
    "A large body is not automatically an author-qualified displacement.",
    "Classification remains blocked without an agreed impulse window and threshold.",
  ],
  SESSION_GAP: [
    "Verified session boundary: previous close 9 and next open 11 define a session gap.",
    "Three-candle FVG or an unexplained missing interval is not a session gap.",
    "Gap fill consumes the interval; calendar changes require recomputation.",
  ],
  WEEKLY_OPEN: [
    "Record open of a fully closed provider W1 period with its exact timestamp.",
    "A forming W1 candle is excluded by this implementation contract.",
    "Historical fact persists; a different provider boundary defines a different series.",
  ],
  MONTHLY_OPEN: [
    "Record open of a fully closed provider MN1 period with its exact timestamp.",
    "An unfinished month or a presumed universal exchange boundary is excluded.",
    "Historical fact persists; incomplete aggregation or calendar correction requires withdrawal.",
  ],
  TDA: [
    "MN1 resistance has priority over local H4 bullish structure; opposing W1 KL is an explicit conflict.",
    "Counting multiple H4 bullish findings cannot outvote monthly context.",
    "Source changes, missing HTF data or opposing HTF KL require renewed review.",
  ],
  NARRATIVE: [
    "Qualified HTF A, a closed D1+ B and a defined structural C allow a directional candidate.",
    "No target, no explicit invalidation, or conflicting HTF KL leaves Neutral.",
    "KL boundary breach withdraws local premise; narrative must be reviewed separately across A/B/C.",
  ],
  EXECUTION: [
    "Closed contextual FVG or selected H4 DR can expose a candidate execution path.",
    "Absence of VC is not an entry; IDM without a verified Strong stop remains blocked.",
    "Entry structure, KL and narrative have separate cancellation conditions.",
  ],
  RISK: [
    "Two attempts with one idea_id include prior realized losses and all open/pending risk.",
    "A new ticket or profitable prior trade does not reset or offset the idea loss budget.",
    "Any exceeded limit, changed ledger, unverified contract or missing policy blocks approval.",
  ],
  EVIDENCE: [
    "Report Macro-EDGE UNVALIDATED, trade prerequisites and evidence confidence independently.",
    "A score or author percentage cannot become probability_tp without independent validation.",
    "New data loss, source revision or counterevidence withdraws the conclusion.",
  ],
  JOURNAL: [
    "Record whether the decision and risk plan existed before the outcome.",
    "Fear, confidence or post-trade P&L cannot change a price detector.",
    "Journal assessment is process-only and never validates market direction.",
  ],
};
