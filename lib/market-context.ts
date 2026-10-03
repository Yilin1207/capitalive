export const CONTEXT_SYMBOLS = ["VIX"] as const;
export type ContextSymbol = (typeof CONTEXT_SYMBOLS)[number];

export type ContextMarketSpec = {
  epic: string;
  name: string;
  asset_class: "rates" | "volatility";
  region: "US";
  tenor: null;
  representation: "volatility_index";
  inverse_to_yield: boolean;
  role: "context";
  contract: string | null;
};

export const CONTEXT_MARKETS: Record<ContextSymbol, ContextMarketSpec> = {
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
  EUROPE: ["GER40", "EU50", "EURUSD", "BRENT"],
  UK: ["UK100", "GBPUSD", "BRENT"],
  JAPAN: ["JP225", "USDJPY", "US10Y"],
  METALS: ["XAUUSD", "XAGUSD", "US10Y"],
  ENERGY: ["BRENT", "GER40", "EU50", "UK100"],
} as const;

export const UNAVAILABLE_CONTEXT_MARKETS = {
  US2Y: "No separate US 2-year instrument was confirmed in the Capital.com catalogue.",
  DE2Y:
    "German Schatz Dec-2026 (catalogue ticker FGBSZ2026) exists publicly but was unavailable through the configured authenticated Demo API.",
  DE10Y:
    "German Bund Dec-2026 (catalogue ticker FGBLZ2026) exists publicly but was unavailable through the configured authenticated Demo API.",
  UK2Y: "No separate UK 2-year instrument was confirmed in the Capital.com catalogue.",
  UK10Y:
    "UK Long Gilt Dec-2026 (catalogue ticker FLGZ6) exists publicly but was unavailable through the configured authenticated Demo API.",
  JP2Y: "No Japanese 2-year instrument was confirmed in the Capital.com catalogue.",
  JP10Y: "No Japanese 10-year instrument was confirmed in the Capital.com catalogue.",
} as const;

export const DERIVED = {
  yield_spreads: {
    available: false,
    reason: "Capital.com provides bond prices or bond futures here, not sovereign yields.",
  },
} as const;
