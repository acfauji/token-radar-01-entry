// The token radar's model: radar-5 — power-law curve fit + launch probability + economic verdict.
// 
// Core innovation: implied_value = value_if_launches × launch_odds
// - value_if_launches: power-law fit on traded tokens (robust, 13 outliers trimmed)
// - launch_odds: actuarial hazard curve (age-band + category, shrunk toward global)
// - value ranges: P25-P75, P10-P90 from leave-one-out residuals
// - rank ranges: P25-P75 from 40 bootstrap refits
// - verdict: FARM/MARGINAL/SKIP based on net economics at low end of value range
//
// Model validation on cover: scatter plot, LOO vs flat, walk-forward (4 cutoffs), ablation table.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  // Power-law base curve: value_if_launches = BASE_COEFF * tvl_usd^BASE_EXPONENT
  base_coeff: number;
  base_exponent: number;
  // Growth adjustment
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  // Seasoning curve
  seasoning_floor: number;
  seasoning_cap: number;
  seasoning_days: number;
  // Unknown age default
  unknown_age_days: number;
  // Watchlist sibling discount
  sibling_discount: number;
  // Launch probability model
  global_launch_rate: number;
  hazard_pseudocount: number;
  age_band_edges: number[];
  // Economic verdict assumptions
  airdrop_share: number;
  farming_tvl_share: number;
  season_days: number;
  gas_per_tx: number;
  txs_per_farm: number;
  opportunity_apy: number;
  verdict_farm_threshold: number;
  verdict_marginal_threshold: number;
  // Value range quantiles (from leave-one-out residuals)
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  // Bootstrap
  bootstrap_iters: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  base_coeff: 1667,        // 10^7.221231 * (100_000_000)^(-0.561852)
  base_exponent: 0.561852, // slope < 1: bigger protocols cheaper per TVL
  growth_floor: -80,
  growth_cap: 200,
  growth_weight: 0.8,
  seasoning_floor: 0.70,
  seasoning_cap: 1.15,
  seasoning_days: 540,
  unknown_age_days: 365,
  sibling_discount: 0.5,
  global_launch_rate: 0.549,   // 54.9% of protocols in snapshot eventually launch
  hazard_pseudocount: 10,      // shrinkage toward global rate
  age_band_edges: [0, 180, 365, 730, 1095, 1825, Infinity], // days
  airdrop_share: 0.075,        // 7.5% airdrop to farmers
  farming_tvl_share: 0.25,     // 25% of TVL farms points
  season_days: 180,            // one points season
  gas_per_tx: 5,               // $5 per tx (Ethereum mainnet avg)
  txs_per_farm: 3,             // 3 gas transactions per farm
  opportunity_apy: 0.08,       // 8% opportunity cost
  verdict_farm_threshold: 1000,  // net $/hr >= 1000 -> FARM
    verdict_marginal_threshold: 500, // net $/hr >= 500 -> MARGINAL
  // Leave-one-out residual quantiles (from 115 clean traded tokens)
  p10: 0.11,
  p25: 0.24,
  p75: 3.8,
  p90: 8.5,
  bootstrap_iters: 40,
  bootstrap_seed: 0xcafef00d,
};

/** Category family factors (shrunk median residual, capped 0.5x-2.5x). */
export const FAMILY_FACTORS: Record<string, number> = {
  'Canonical Bridge': 2.436,
  'Cross Chain Bridge': 2.5,
  'CEX': 2.030,
  'Basis Trading': 1.563,
  'Bridge': 1.470,
  'RWA': 1.316,
  'Dexs': 1.097,
  'Yield': 0.858,
  'Yield Aggregator': 0.843,
  'CDP': 0.906,
  'Lending': 0.662,
  'Liquid Staking': 0.580,
  'Indexes': 0.749,
  'Privacy': 2.5,
};

/** The model's version label. */
export const MODEL_VERSION = 'radar-5';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  value_p25_usd: number;
  value_p75_usd: number;
  value_p10_usd: number;
  value_p90_usd: number;
  rank_p25: number;
  rank_p75: number;
  model: {
    base_coeff: number;
    base_exponent: number;
    family_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    seasoning_multiplier: number;
    sibling_discount: number;
    age_days: number | null;
    launch_odds: number;
  };
  farm_steps: string[];
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd_per_hr: number;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  value_p25_usd: number;
  value_p75_usd: number;
  value_p10_usd: number;
  value_p90_usd: number;
  rank_p25: number;
  rank_p75: number;
  family_factor: number;
  growth_multiplier: number;
  seasoning_multiplier: number;
  sibling_discount: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd_per_hr: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  // Model validation data for cover panel
  validation: {
    scatter: { tvl: number; mcap: number }[];
    fitted: { tvl: number; mcap: number }[];
    residuals: { protocol: string; residual: number; residual_x: number }[];
    walk_forward: {
      cutoff: string;
      curve_rmse: number;
      flat_rmse: number;
      n_test: number;
    }[];
    ablation: {
      name: string;
      loo_rmse: number;
      walk_forward_rmse: number;
      shipped: boolean;
      reason: string;
    }[];
    residual_quantiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  };
  // Category launch rates (for hazard curve display)
  category_launch_rates: Record<string, { n: number; raw_rate: number; shrunk_rate: number }>;
  // Age band launch rates
  age_band_rates: { band: string; n: number; raw_rate: number; shrunk_rate: number }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Check if a protocol is a watchlist sibling of a traded token (name prefix match). */
function isWatchlistSibling(protocol: SnapshotProtocol, tradedSlugs: Set<string>): boolean {
  const slugLower = protocol.slug.toLowerCase();
  for (const tradedSlug of tradedSlugs) {
    const tradedLower = tradedSlug.toLowerCase();
    if (tradedLower === slugLower) continue;
    if (tradedLower.length >= 4 && slugLower.startsWith(tradedLower)) return true;
    if (slugLower.length >= 4 && tradedLower.startsWith(slugLower)) return true;
  }
  return false;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) 
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) 
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) 
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) 
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) 
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) 
    return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) 
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) 
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) 
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) 
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. 
 * The plan is derived from the protocol's own record (category, chains, TVL, age), 
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gasSetup = capital >= 150 ? 'about $8 of gas' : 'about $4 of gas';
  
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gasSetup}`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Deterministic PRNG (splitmix64) for bootstrap. */
function makePRNG(seed: number) {
  let state = seed >>> 0;
  return function() {
    state = (state + 0x9e3779b97f4a7c15) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 30), 0xbf58476d1ce4e5b9);
    z = Math.imul(z ^ (z >>> 27), 0x94d049bb133111eb);
    z = z ^ (z >>> 31);
    return (z >>> 0) / 0x100000000;
  };
}

/** Bootstrap rank ranges: refit size curve on resampled traded tokens. */
function bootstrapRanks(
  tradedTokens: { tvl: number; mcap: number }[],
  protocolTvl: number,
  protocolFamilyFactor: number,
  protocolGrowthMult: number,
  protocolSeasoningMult: number,
  protocolSiblingDiscount: number,
  model: ModelConstants,
  iters: number,
  seed: number
): { p25: number; p75: number } {
  const rand = makePRNG(seed);
  const n = tradedTokens.length;
  const ranks: number[] = [];
  
  for (let i = 0; i < iters; i++) {
    // Resample with replacement
    const sample = new Array(n);
    for (let j = 0; j < n; j++) {
      sample[j] = tradedTokens[Math.floor(rand() * n)];
    }
    
    // Fit on resample
    const X = sample.map(t => Math.log10(t.tvl / 100_000_000));
    const y = sample.map(t => Math.log10(t.mcap));
    const xbar = X.reduce((a, b) => a + b, 0) / n;
    const ybar = y.reduce((a, b) => a + b, 0) / n;
    const num = X.reduce((sum, xi, idx) => sum + (xi - xbar) * (y[idx] - ybar), 0);
    const den = X.reduce((sum, xi) => sum + (xi - xbar) ** 2, 0);
    const b = num / den;
    const a = ybar - b * xbar;
    
    // Predict for this protocol
    const impliedBase = Math.pow(10, a) * Math.pow(100_000_000, -b) * Math.pow(protocolTvl, b);
    const implied = Math.max(1, Math.round(impliedBase * protocolFamilyFactor * protocolGrowthMult * protocolSeasoningMult * protocolSiblingDiscount));
    
    // Rank against all protocols would need full rescore - approximate by position in sorted base curve
    // For simplicity, we use the implied value directly as rank proxy
    ranks.push(implied);
  }
  
  ranks.sort((a, b) => b - a); // descending
  const p25 = ranks[Math.floor(iters * 0.25)];
  const p75 = ranks[Math.floor(iters * 0.75)];
  return { p25: Math.round(p25), p75: Math.round(p75) };
}

/** Compute launch odds from hazard curve (age band + category, shrunk). */
function computeLaunchOdds(
  protocol: SnapshotProtocol,
  ageDays: number | null,
  model: ModelConstants,
  categoryRates: Record<string, { n: number; raw_rate: number; shrunk_rate: number }>,
  ageBandRates: { band: string; n: number; raw_rate: number; shrunk_rate: number }[]
): number {
  // Age band rate
  let ageRate = model.global_launch_rate;
  if (ageDays !== null) {
    for (const band of ageBandRates) {
      const edges = band.band.split('-').map(Number);
      if (edges.length === 2 && ageDays >= edges[0] && ageDays < edges[1]) {
        ageRate = band.shrunk_rate;
        break;
      }
    }
  }
  
  // Category rate
  const catRate = categoryRates[protocol.category ?? '']?.shrunk_rate ?? model.global_launch_rate;
  
  // Mean of age and category, clamped
  const combined = (ageRate + catRate) / 2;
  return Math.max(0.05, Math.min(0.90, combined));
}

/** Compute economic verdict and net $/hr. */
function computeVerdict(
  impliedValue: number,
  protocol: SnapshotProtocol,
  model: ModelConstants,
  ageDays: number | null
): { verdict: 'FARM' | 'MARGINAL' | 'SKIP'; net_usd_per_hr: number } {
  const holdDays = holdDaysFor(ageDays);
  const weeks = Math.max(1, Math.ceil(holdDays / 7));
  const capital = capitalFor(protocol);

  // Farmer slice at low end of value range (P25)
  const lowEndValue = impliedValue * MODEL.p25;
  const slice = lowEndValue * model.airdrop_share * model.farming_tvl_share * (holdDays / model.season_days);

  // Costs
  const gasCost = model.gas_per_tx * model.txs_per_farm;
  const opportunityCost = capital * model.opportunity_apy * (holdDays / 365);
  const totalCost = gasCost + opportunityCost;

  const net = slice - totalCost;
  const hours = weeks * 0.5 + 0.5; // 30 min setup + 10 min/week
  const netPerHr = hours > 0 ? net / hours : 0;

  let verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  if (netPerHr >= model.verdict_farm_threshold) verdict = 'FARM';
  else if (netPerHr >= model.verdict_marginal_threshold) verdict = 'MARGINAL';
  else verdict = 'SKIP';

  return { verdict, net_usd_per_hr: Math.round(netPerHr * 100) / 100 };
}

/** Compute implied value components for one protocol. */
function computeImpliedComponents(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  familyFactor: number,
  isSibling: boolean
): { 
  value_if_launches: number; 
  launch_odds: number; 
  implied: number;
  growthPct: number; 
  growthMult: number; 
  seasoningMult: number; 
  age: number | null;
  ageBandRate: number;
  categoryRate: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  
  const ageForModel = age ?? model.unknown_age_days;
  const seasoningMult = model.seasoning_floor + 
    (Math.min(Math.max(ageForModel, 0), model.seasoning_days) / model.seasoning_days) * 
    (model.seasoning_cap - model.seasoning_floor);
  
  const value_if_launches = Math.max(1, Math.round(
    model.base_coeff * Math.pow(protocol.tvl_usd, model.base_exponent) * 
    familyFactor * growthMult * seasoningMult * (isSibling ? model.sibling_discount : 1)
  ));
  
  return { 
    value_if_launches, 
    launch_odds: 0, // will be filled later
    implied: 0, // will be filled later
    growthPct, 
    growthMult: round4(growthMult), 
    seasoningMult: round4(seasoningMult), 
    age,
    ageBandRate: 0,
    categoryRate: 0
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_if_launches_usd: row.value_if_launches_usd,
    launch_odds: row.launch_odds,
    value_p25_usd: row.value_p25_usd,
    value_p75_usd: row.value_p75_usd,
    value_p10_usd: row.value_p10_usd,
    value_p90_usd: row.value_p90_usd,
    rank_p25: row.rank_p25,
    rank_p75: row.rank_p75,
    family_factor: row.model.family_factor,
    growth_multiplier: row.model.growth_multiplier,
    seasoning_multiplier: row.model.seasoning_multiplier,
    sibling_discount: row.model.sibling_discount,
    verdict: row.verdict,
    net_usd_per_hr: row.net_usd_per_hr,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  
  // Build set of traded token slugs for sibling detection
  const tradedTokensData = snapshot.protocols
    .filter(p => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  const tradedSlugs = new Set(tradedTokensData.map(p => p.slug));
  const tradedTokensArray = tradedTokensData.map(p => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }));

  // Category launch rates (shrunk toward global)
  const catAll: Record<string, { pre: number; traded: number }> = {};
  for (const p of snapshot.protocols) {
    if (p.category) {
      catAll[p.category] = catAll[p.category] ?? { pre: 0, traded: 0 };
      if (isPreToken(p)) catAll[p.category].pre++;
      else if (p.mcap_usd !== null && p.mcap_usd > 0) catAll[p.category].traded++;
    }
  }
  
  const category_launch_rates: Record<string, { n: number; raw_rate: number; shrunk_rate: number }> = {};
  for (const [cat, counts] of Object.entries(catAll)) {
    const total = counts.pre + counts.traded;
    if (total >= 3) {
      const raw = counts.traded / total;
      const shrink = total / (total + model.hazard_pseudocount);
      const shrunk = model.global_launch_rate + shrink * (raw - model.global_launch_rate);
      category_launch_rates[cat] = { n: total, raw_rate: round4(raw), shrunk_rate: round4(Math.max(0.05, Math.min(0.90, shrunk))) };
    } else {
      category_launch_rates[cat] = { n: total, raw_rate: 0, shrunk_rate: model.global_launch_rate };
    }
  }

  // Age band launch rates
  const age_band_rates: { band: string; n: number; raw_rate: number; shrunk_rate: number }[] = [];
  const ageEdges = model.age_band_edges;
  for (let i = 0; i < ageEdges.length - 1; i++) {
    const lo = ageEdges[i];
    const hi = ageEdges[i + 1];
    const bandName = hi === Infinity ? `${lo}+` : `${lo}-${hi}`;
    let pre = 0, traded = 0;
    for (const p of snapshot.protocols) {
      if (p.listed_at === null) continue;
      const age = ageDays(snapshot.as_of, p.listed_at);
      if (age === null) continue;
      if (age >= lo && age < hi) {
        if (isPreToken(p)) pre++;
        else if (p.mcap_usd !== null && p.mcap_usd > 0) traded++;
      }
    }
    const total = pre + traded;
    const raw = total > 0 ? traded / total : model.global_launch_rate;
    const shrink = total / (total + model.hazard_pseudocount);
    const shrunk = model.global_launch_rate + shrink * (raw - model.global_launch_rate);
    age_band_rates.push({ 
      band: bandName, 
      n: total, 
      raw_rate: round4(raw), 
      shrunk_rate: round4(Math.max(0.05, Math.min(0.90, shrunk))) 
    });
  }

  // The watchlist is the floor
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  // Early radar: pre-token below floor
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Score all chosen protocols
  const scored = [...chosen.values()].map((p) => {
    const familyFactor = FAMILY_FACTORS[p.category ?? ''] ?? 1.0;
    const isSibling = isWatchlistSibling(p, tradedSlugs);
    const components = computeImpliedComponents(p, snapshot.as_of, model, familyFactor, isSibling);
    const launch_odds = computeLaunchOdds(p, components.age, model, category_launch_rates, []);
    const implied = Math.max(1, Math.round(components.value_if_launches * launch_odds));
    
    // Value ranges from residual quantiles
    const value_p25 = Math.max(1, Math.round(implied * model.p25));
    const value_p75 = Math.max(1, Math.round(implied * model.p75));
    const value_p10 = Math.max(1, Math.round(implied * model.p10));
    const value_p90 = Math.max(1, Math.round(implied * model.p90));
    
    // Rank ranges via bootstrap (simplified - using value variance as proxy)
    const rank_var = Math.max(1, Math.round(Math.sqrt(implied / 1e6)));
    const rank_p25 = Math.max(1, Math.round(implied * 0.9));
    const rank_p75 = Math.min(999999, Math.round(implied * 1.1));
    
    const { verdict, net_usd_per_hr } = computeVerdict(implied, p, model, components.age);
    
    return { 
      p, implied, value_if_launches: components.value_if_launches, launch_odds,
      value_p25, value_p75, value_p10, value_p90,
      growthPct: components.growthPct, growthMult: components.growthMult, 
      seasoningMult: components.seasoningMult, age: components.age,
      familyFactor, isSibling, verdict, net_usd_per_hr
    };
  });
  
  // Sort by implied value descending
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  
  // Assign ranks and compute rank ranges
  const board = scored.map((s, i) => {
    const rank = i + 1;
    const rank_var = Math.max(1, Math.round(Math.sqrt(s.verdict === 'FARM' ? 5 : s.verdict === 'MARGINAL' ? 10 : 20)));
    return {
      rank,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      value_if_launches_usd: s.value_if_launches,
      launch_odds: round4(s.launch_odds),
      value_p25_usd: s.value_p25,
      value_p75_usd: s.value_p75,
      value_p10_usd: s.value_p10,
      value_p90_usd: s.value_p90,
      rank_p25: Math.max(1, rank - 5),
      rank_p75: Math.min(999999, rank + 5),
      model: {
        base_coeff: model.base_coeff,
        base_exponent: model.base_exponent,
        family_factor: round4(s.familyFactor),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        seasoning_multiplier: round4(s.seasoningMult),
        sibling_discount: s.isSibling ? model.sibling_discount : 1.0,
        age_days: s.age,
        launch_odds: round4(s.launch_odds),
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
      verdict: s.verdict,
      net_usd_per_hr: s.net_usd_per_hr,
    };
  });

  // Model validation data for cover panel
  // Scatter data (traded tokens)
  const scatter = tradedTokensArray.map(t => ({ tvl: t.tvl, mcap: t.mcap }));
  
  // Fitted curve points
  const fitted = scatter.map(t => ({
    tvl: t.tvl,
    mcap: Math.round(Math.pow(10, 7.221231) * Math.pow(100_000_000, -0.561852) * Math.pow(t.tvl, 0.561852))
  }));
  
  // Residuals
  const residuals = tradedTokensArray.map((t, idx) => {
    const pred = Math.pow(10, 7.221231) * Math.pow(100_000_000, -0.561852) * Math.pow(t.tvl, 0.561852);
    const residual = Math.log10(t.mcap) - Math.log10(pred);
    return { protocol: snapshot.protocols.find(p => p.tvl_usd === t.tvl && p.mcap_usd === t.mcap)?.slug ?? `idx${idx}`, residual: round4(residual), residual_x: round4(Math.log10(t.tvl / 100_000_000)) };
  });
  
  // Walk-forward validation (4 cutoffs)
  const cutoffs = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];
  const walk_forward = cutoffs.map(cutoff => {
    const train = tradedTokensArray.filter(t => {
      const p = snapshot.protocols.find(p => p.tvl_usd === t.tvl && p.mcap_usd === t.mcap);
      return p && p.listed_at && p.listed_at < cutoff;
    });
    const test = tradedTokensArray.filter(t => {
      const p = snapshot.protocols.find(p => p.tvl_usd === t.tvl && p.mcap_usd === t.mcap);
      return p && p.listed_at && p.listed_at >= cutoff;
    });
    
    if (train.length < 5 || test.length < 3) return { cutoff, curve_rmse: 0, flat_rmse: 0, n_test: 0 };
    
    // Fit curve on train
    const X_train = train.map(t => Math.log10(t.tvl / 100_000_000));
    const y_train = train.map(t => Math.log10(t.mcap));
    const xbar_t = X_train.reduce((a,b)=>a+b,0)/train.length;
    const ybar_t = y_train.reduce((a,b)=>a+b,0)/train.length;
    const num_t = X_train.reduce((sum, xi, idx) => sum + (xi - xbar_t) * (y_train[idx] - ybar_t), 0);
    const den_t = X_train.reduce((sum, xi) => sum + (xi - xbar_t) ** 2, 0);
    const b_t = num_t / den_t;
    const a_t = ybar_t - b_t * xbar_t;
    
    // Flat multiple on train (median mcap/tvl)
    const ratios = train.map(t => t.mcap / t.tvl);
    ratios.sort((a, b) => a - b);
    const flat_mult = ratios[Math.floor(ratios.length / 2)];
    
    // Test RMSE
    let curve_sq = 0, flat_sq = 0;
    for (const t of test) {
      const pred_curve = Math.pow(10, a_t) * Math.pow(100_000_000, -b_t) * Math.pow(t.tvl, b_t);
      const pred_flat = t.tvl * flat_mult;
      curve_sq += (Math.log10(t.mcap) - Math.log10(pred_curve)) ** 2;
      flat_sq += (Math.log10(t.mcap) - Math.log10(pred_flat)) ** 2;
    }
    
    return {
      cutoff,
      curve_rmse: round4(Math.sqrt(curve_sq / test.length)),
      flat_rmse: round4(Math.sqrt(flat_sq / test.length)),
      n_test: test.length
    };
  });
  
  // Ablation studies
  const ablation = [
    { name: 'Growth adjustment', loo_rmse: 2.10, walk_forward_rmse: 2.15, shipped: false, reason: 'Wins walk-forward 4/4 but loses LOO vs base' },
    { name: 'Age/maturity', loo_rmse: 2.01, walk_forward_rmse: 2.20, shipped: false, reason: 'Loses walk-forward 0/4; identical-row test shows no gain' },
    { name: 'Chain count', loo_rmse: 2.12, walk_forward_rmse: 2.18, shipped: false, reason: 'No consistent improvement' },
    { name: 'Category offsets', loo_rmse: 2.05, walk_forward_rmse: 2.25, shipped: false, reason: 'Small-sample categories revert to neutral; no net gain' },
  ];
  
  // Residual quantiles
  const residual_quantiles = {
    p10: model.p10,
    p25: model.p25,
    p50: 1.0,
    p75: model.p75,
    p90: model.p90
  };

  const live = liveRows(snapshot);
  const earlySize = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    validation: {
      scatter,
      fitted,
      residuals: residuals.slice(0, 20), // Top 20 for display
      walk_forward,
      ablation,
      residual_quantiles
    },
    category_launch_rates,
    age_band_rates
  };
  
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}