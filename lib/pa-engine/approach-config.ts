/**
 * Thresholds for the approach-character flags (THE EDGE: delivery to a KL by expansion without corrections,
 * or by compression / LRL). THE EDGE gives no numbers, so every threshold is null = NEEDS_SPECIFICATION and the
 * flag stays NOT_EVALUATED. The facts (counts, move in D1 ATR, body overlaps, range contraction) are always
 * reported. Set numbers here only after the user approves them.
 */
export const APPROACH_CONFIG = {
  /** Closed candles examined for body overlap and range contraction. A window, not a significance threshold. */
  window_bars: 6,
  /** EXPANSION_NO_CORRECTION: at least this many consecutive closes without a counter-close... */
  expansion_min_bars: null as number | null,
  /** ...and a move of at least this many D1 ATR. */
  expansion_min_move_atr_d1: null as number | null,
  /** COMPRESSION: at least this many consecutive bodies that strictly overlap (touching is not overlap) within the window... */
  compression_min_overlap_pairs: null as number | null,
  /** ...or at least this many consecutive narrowing ranges. */
  compression_min_contracting_bars: null as number | null,
};
