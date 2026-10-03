export const CONTEXT_SYMBOLS = ["DE2Y", "DE10Y", "UK10Y", "VIX"] as const;
export type ContextSymbol = (typeof CONTEXT_SYMBOLS)[number];

export type ContextMarketSpec = {
  epic: string;
  name: string;
  asset_class: "rates" | "volatility";
  region: "DE" | "UK" | "US";
  tenor: "2Y" | "10Y" | null;
  representation: "rate_future" | "volatility_index";
  inverse_to_yield: boolean;
  role: "context";
  contract: string | null;
};

export const CONTEXT_MARKETS: Record<ContextSymbol, ContextMarketSpec> = {
  DE2Y: {
    epic: "FGBSZ2026",
    name: "German Schatz Future - Dec 2026",
    asset_class: "rates",
    region: "DE",
    tenor: "2Y",
    representation: "rate_future",
    inverse_to_yield: true,
    role: "context",
    contract: "2026-12",
  },
  DE10Y: {
    epic: "FGBLZ2026",
    name: "German Bund Future - Dec 2026",
    asset_class: "rates",
    region: "DE",
    tenor: "10Y",
    representation: "rate_future",
    inverse_to_yield: true,
    role: "context",
    contract: "2026-12",
  },
  UK10Y: {
    epic: "FLGZ6",
    name: "UK Long Gilt Future - Dec 2026",
    asset_class: "rates",
    region: "UK",
    tenor: "10Y",
    representation: "rate_future",
    inverse_to_yield: true,
    role: "context",
    contract: "2026-12",
  },
  VIX: {
    epic: "VIX",
    name: "Volatility Index",
    asset_class: "volatility",
    region: "US",
    tenor: null,
    representation: "volatility_index",
    inverse_to_yield: false,
    role: "context",
    contract: null,
  },
};

export const TRADABLE_METADATA = {
  NAS100: { role: "tradable", asset_class: "index", region: "US" },
  US500: { role: "tradable", asset_class: "index", region: "US" },
  GER40: { role: "tradable", asset_class: "index", region: "DE" },
  EU50: { role: "tradable", asset_class: "index", region: "EU" },
  UK100: { role: "tradable", asset_class: "index", region: "UK" },
  JP225: { role: "tradable", asset_class: "index", region: "JP" },
  EURUSD: { role: "tradable", asset_class: "fx", region: "EU_US" },
  GBPUSD: { role: "tradable", asset_class: "fx", region: "UK_US" },
  USDJPY: { role: "tradable", asset_class: "fx", region: "US_JP" },
  XAUUSD: { role: "tradable", asset_class: "metal", region: "GLOBAL" },
  XAGUSD: { role: "tradable", asset_class: "metal", region: "GLOBAL" },
  BRENT: { role: "tradable", asset_class: "energy", region: "GLOBAL" },
  US10Y: {
    role: "context",
    asset_class: "rates",
    region: "US",
    tenor: "10Y",
    representation: "bond_price",
    inverse_to_yield: true,
  },
} as const;

export const RELATIONSHIPS = {
  US_TECH: ["NAS100", "US500", "US10Y", "VIX"],
  EUROPE: ["GER40", "EU50", "EURUSD", "DE2Y", "DE10Y", "BRENT"],
  UK: ["UK100", "GBPUSD", "UK10Y", "BRENT"],
  JAPAN: ["JP225", "USDJPY", "US10Y"],
  METALS: ["XAUUSD", "XAGUSD", "US10Y"],
  ENERGY: ["BRENT", "GER40", "EU50", "UK100"],
} as const;

export const UNAVAILABLE_CONTEXT_MARKETS = {
  US2Y: "No separate US 2-year instrument was confirmed in the Capital.com catalogue.",
  UK2Y: "No separate UK 2-year instrument was confirmed in the Capital.com catalogue.",
  JP2Y: "No Japanese 2-year instrument was confirmed in the Capital.com catalogue.",
  JP10Y: "No Japanese 10-year instrument was confirmed in the Capital.com catalogue.",
} as const;

export const DERIVED = {
  yield_spreads: {
    available: false,
    reason: "Capital.com provides bond prices or bond futures here, not sovereign yields.",
  },
} as const;
