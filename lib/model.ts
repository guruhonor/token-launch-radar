// Token Radar — value model, farm plans and board construction.
//
// This is the entry's own model ("radar-2"). It reads only the sealed
// DefiLlama snapshot and ranks pre-token protocols by an implied value
// computed from snapshot numbers: TVL, seven-day growth and the time the
// protocol has run without a token. No protocol is named anywhere in the
// scoring code: the ranking follows from the numbers, so a protocol that
// is not in the snapshot cannot appear, and a protocol whose numbers move
// moves in the ranking.
//
// The model is deliberately shared with the dashboard: dashboard/app.js
// carries the same functions so the page can recompute a row's value and
// farm plan from the same numbers and show the breakdown. Keep the two in
// sync; the validator checks that they agree on every row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SnapshotProtocol {
  name: string;
  slug: string;
  category: string | null;
  chains: string[] | null;
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export const MODEL_VERSION = 'radar-2';
export const SNAPSHOT_FLOOR_USD = 50_000_000;

export const CATEGORY_EXCLUDED = new Set([
  'bridge', 'canonical bridge', 'liquid staking', 'liquid restaking',
  'restaked btc', 'cex',
]);

export const EXCHANGE_PREFIXES = [
  'binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini',
];

export const VERSION_MARK = /(?:^|[\s-])(?:v\d+(?:\.\d+)*|v\d+)$/i;
export const WRAPPED_MARK = /\b(wrapped|staked|staking)\b/i;

export const LIVE_ROWS = 24;
export const SET_ASIDE_ROWS = 12;

// A fee-capturing protocol's token is worth a larger share of the value it
// secures than a wrapper's token is worth of the assets it wraps, so the
// multiple follows the protocol's role. The tiers are the only place a
// category enters the value; everything else is TVL, growth and age.
export const SECTOR_MULTIPLE: Record<string, number> = {
  // Exchange-like: the token would capture ongoing trading, lending or
  // liquidation fees, so it prices like an exchange.
  dexs: 0.5, lending: 0.5, cdp: 0.5, derivatives: 0.5, perpetuals: 0.5,
  // Allocator: vaults and curators take a performance fee on the capital
  // they allocate, so the token prices between an exchange and a wrapper.
  yield: 0.4, 'yield aggregator': 0.4, 'liquidity manager': 0.4,
  'risk curators': 0.4, 'onchain capital allocator': 0.4,
  'collateral markets': 0.4, 'uncollateralized lending': 0.4,
  'leveraged farming': 0.4, farm: 0.4,
  // Asset and utility: the token captures a thin spread on an underlying
  // asset, a service fee or a governance right, so it prices lower.
  'staking pool': 0.3, restaking: 0.3, insurance: 0.3,
  'prediction market': 0.3, 'options vault': 0.3,
  'interest rate derivatives': 0.3, rwa: 0.3, 'basis trading': 0.3,
  payments: 0.3, indexes: 0.3, chain: 0.3, privacy: 0.3,
  'otc marketplace': 0.3, 'governance incentives': 0.3,
  'crypto card issuer': 0.3, 'cross chain bridge': 0.3,
  'stablecoin wrapper': 0.3, 'dual-token stablecoin': 0.3,
  'anchor btc': 0.3, 'decentralized btc': 0.3, 'cdp manager': 0.3,
};
export const SECTOR_DEFAULT = 0.3;
export const GROWTH_WEIGHT = 0.6;
export const GROWTH_MIN = -60;
export const GROWTH_MAX = 120;
export const MATURITY_BASE = 0.7;
export const MATURITY_SPAN_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 365;

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('snapshot: invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('snapshot: not an object');
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.protocols)) throw new Error('snapshot: missing protocols');
  if (!Array.isArray(root.watchlist)) throw new Error('snapshot: missing watchlist');
  if (typeof root.as_of !== 'string' || !root.as_of) throw new Error('snapshot: missing as_of');
  if (typeof root.source !== 'string' || !root.source) throw new Error('snapshot: missing source');
  if (typeof root.floor_usd !== 'number' || !(root.floor_usd > 0)) {
    throw new Error('snapshot: missing floor_usd');
  }
  const protocols = root.protocols as Record<string, unknown>[];
  const seen = new Set<string>();
  const cleaned: SnapshotProtocol[] = protocols.map((p, i) => {
    const slug = typeof p.slug === 'string' && p.slug ? p.slug : null;
    if (!slug) throw new Error(`snapshot: protocol ${i} missing slug`);
    if (seen.has(slug)) throw new Error(`snapshot: duplicate slug ${slug}`);
    seen.add(slug);
    const tvl = p.tvl_usd === null || p.tvl_usd === undefined ? null : Number(p.tvl_usd);
    const change = p.change_7d === null || p.change_7d === undefined ? null : Number(p.change_7d);
    const mcap = p.mcap_usd === null || p.mcap_usd === undefined ? null : Number(p.mcap_usd);
    return {
      name: typeof p.name === 'string' && p.name ? p.name : slug,
      slug,
      category: typeof p.category === 'string' && p.category ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string' && !!c) : null,
      tvl_usd: Number.isFinite(tvl) ? tvl : null,
      change_7d: Number.isFinite(change) ? change : null,
      mcap_usd: Number.isFinite(mcap) ? mcap : null,
      listed_at: typeof p.listed_at === 'string' && p.listed_at ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' && p.gecko_id ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' && p.symbol ? p.symbol : null,
    };
  });
  const watchlist = (root.watchlist as unknown[]).filter((s): s is string => typeof s === 'string' && !!s);
  return {
    as_of: root.as_of as string,
    source: root.source as string,
    floor_usd: root.floor_usd as number,
    protocols: cleaned,
    watchlist,
  };
}

export function readSnapshot(inputDir: string): Snapshot {
  return parseSnapshot(readFileSync(join(inputDir, 'snapshot.json'), 'utf8'));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRuleClean(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (typeof p.tvl_usd !== 'number' || !(p.tvl_usd > 0)) return false;
  if (p.category && CATEGORY_EXCLUDED.has(p.category.toLowerCase())) return false;
  const name = p.name.toLowerCase();
  if (WRAPPED_MARK.test(name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => name.startsWith(prefix + ' '))) return false;
  if (VERSION_MARK.test(p.name)) return false;
  return true;
}

// The reason a protocol is set aside, for the dashboard's third tab. The
// first reason that applies is the one shown.
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'already has a token';
  if (typeof p.tvl_usd !== 'number' || !(p.tvl_usd > 0)) return 'no TVL on record';
  if (p.category && CATEGORY_EXCLUDED.has(p.category.toLowerCase())) {
    return `category is ${p.category.toLowerCase()}`;
  }
  if (WRAPPED_MARK.test(p.name.toLowerCase())) return 'wrapped or staked product';
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.toLowerCase().startsWith(prefix + ' '))) {
    return 'exchange product';
  }
  if (VERSION_MARK.test(p.name)) return 'versioned duplicate';
  return null;
}

export function ageDays(p: SnapshotProtocol, asOfDate: Date): number | null {
  if (typeof p.listed_at !== 'string' || !p.listed_at) return null;
  const listed = new Date(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(listed.getTime())) return null;
  return Math.max(0, Math.floor((asOfDate.getTime() - listed.getTime()) / 86_400_000));
}

export function sectorMultiple(category: string | null): number {
  if (!category) return SECTOR_DEFAULT;
  const key = category.toLowerCase();
  return SECTOR_MULTIPLE[key] ?? SECTOR_DEFAULT;
}

export function growthMultiplier(change7d: number | null): number {
  if (typeof change7d !== 'number' || !Number.isFinite(change7d)) return 1;
  return 1 + (clamp(change7d, GROWTH_MIN, GROWTH_MAX) / 100) * GROWTH_WEIGHT;
}

export function maturityMultiplier(age: number | null): number {
  const days = typeof age === 'number' && Number.isFinite(age) ? age : UNKNOWN_AGE_DAYS;
  return MATURITY_BASE + (1 - MATURITY_BASE) * (Math.min(days, MATURITY_SPAN_DAYS) / MATURITY_SPAN_DAYS);
}

// implied value = TVL x sector multiple x growth multiplier x maturity multiplier.
export function impliedValue(p: SnapshotProtocol, asOfDate: Date): number {
  if (typeof p.tvl_usd !== 'number' || !(p.tvl_usd > 0)) return 1;
  const value =
    p.tvl_usd *
    sectorMultiple(p.category) *
    growthMultiplier(p.change_7d) *
    maturityMultiplier(ageDays(p, asOfDate));
  return Math.max(1, Math.round(value));
}

// Typical gas for one transaction on each chain, in USD. The chain list
// comes from the snapshot, so an unknown chain falls back to $2 rather
// than breaking the plan.
export function gasUsd(chain: string | null | undefined): number {
  const c = (chain ?? '').toLowerCase();
  if (c === 'solana') return 0.02;
  if (c === 'ethereum') return 8;
  if (c === 'polygon') return 0.1;
  if (c === 'bsc') return 0.3;
  if (c === 'arbitrum' || c === 'optimism' || c === 'base' || c === 'zksync era') return 0.5;
  if (c === 'linea' || c === 'scroll' || c === 'blast' || c === 'mantle' || c === 'ink') return 0.2;
  if (c === 'avalanche' || c === 'fantom' || c === 'gnosis') return 0.5;
  if (c === 'sui' || c === 'aptos' || c === 'near') return 0.05;
  if (c === 'ton') return 0.1;
  if (c === 'tron') return 1;
  if (c === 'bitcoin') return 2;
  if (c === 'bittensor') return 0.5;
  return 2;
}

export function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export function gasText(chain: string | null | undefined): string {
  const g = gasUsd(chain);
  return g < 1 ? `$${g.toFixed(2)}` : `$${g.toFixed(0)}`;
}

export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

export function holdDays(age: number | null): number {
  if (typeof age === 'number' && age >= 730) return 30;
  if (typeof age === 'number' && age >= 365) return 45;
  return 60;
}

function mainAction(category: string | null, name: string, chain: string, capital: number): string {
  const c = (category ?? '').toLowerCase();
  const cap = fmtUsd(capital);
  switch (c) {
    case 'lending':
    case 'cdp':
    case 'collateral markets':
      return `Supply ${cap} of USDC to ${name} on ${chain} and borrow a small amount against it, so the wallet has both a supply and a borrow position.`;
    case 'dexs':
      return `Provide ${cap} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range, so the wallet earns fees and counts as an active liquidity provider.`;
    case 'yield':
    case 'yield aggregator':
    case 'liquidity manager':
      return `Deposit ${cap} into ${name}'s highest-TVL vault on ${chain} and keep the shares, so the wallet is an active depositor rather than a passer-by.`;
    case 'risk curators':
    case 'onchain capital allocator':
      return `Deposit ${cap} into a ${name} vault on ${chain} and keep the shares, so the wallet is an active allocator in the vault the protocol runs.`;
    case 'derivatives':
    case 'perpetuals':
      return `Deposit ${cap} of USDC as margin on ${name} and open one small hedged position, so the wallet has a funded trading account and a real trade on record.`;
    case 'rwa':
      return `Mint ${cap} of ${name}'s yield-bearing asset on ${chain} and hold it, so the wallet owns the tokenised asset the protocol issues.`;
    case 'basis trading':
      return `Deposit ${cap} into ${name}'s basis vault on ${chain} and keep the position, so the wallet earns the funding-rate spread the protocol captures.`;
    case 'prediction market':
      return `Fund ${cap} and take one position in ${name}'s most active market, so the wallet has a funded account and a live prediction on record.`;
    case 'insurance':
      return `Buy ${cap} of cover from ${name} on ${chain} and keep the policy active, so the wallet is a real customer of the cover the protocol sells.`;
    case 'staking pool':
    case 'restaking':
      return `Stake ${cap} of the chain's staking asset through ${name} and keep the receipt token, so the wallet is a staker the protocol can count.`;
    case 'stablecoin wrapper':
    case 'dual-token stablecoin':
      return `Mint ${cap} of the stable asset through ${name} on ${chain} and hold it, so the wallet holds the stablecoin the protocol issues.`;
    case 'payments':
      return `Route ${cap} of payments through ${name} on ${chain} over the month, so the wallet is an active user of the payment rail.`;
    case 'chain':
      return `Use ${name}'s main app on ${chain}: one transaction a week, such as a swap or a stake, so the wallet is active on the chain itself.`;
    default:
      return `Deposit ${cap} of USDC into ${name} on ${chain} and keep the position open, so the wallet is an active user of the protocol's core product.`;
  }
}

export function farmSteps(p: SnapshotProtocol, asOfDate: Date): string[] {
  const chains = Array.isArray(p.chains) && p.chains.length > 0 ? p.chains : ['Ethereum'];
  const chain = chains[0];
  const gas = gasText(chain);
  const capital = capitalFor(typeof p.tvl_usd === 'number' ? p.tvl_usd : 0);
  const cap = fmtUsd(capital);
  const age = ageDays(p, asOfDate);
  const hold = holdDays(age);
  const secondChain = chains.length > 1 ? chains[1] : null;
  const steps: string[] = [
    `Set up a fresh wallet for this farm and write the seed phrase down on paper, offline. Fund it with ${cap} plus enough ${chain} gas for a week of activity. Cost: about ${gas} for the first transaction. Time: 10 minutes.`,
    `${mainAction(p.category, p.name, chain, capital)} Cost: ${cap} of capital plus about ${gas} in gas. Time: 15 minutes.`,
    secondChain
      ? `Repeat the same position on ${secondChain} so the wallet is active on two chains, which is how the protocol's own leaderboard usually counts a real user. Cost: about ${gasText(secondChain)} in gas. Time: 10 minutes.`
      : `Make a second qualifying action in the same app, such as a swap, a borrow or a vote, so the wallet is more than a one-off deposit. Cost: about ${gas} in gas. Time: 10 minutes.`,
    `Come back once a week and make one qualifying action, such as adding to the position, claiming rewards or voting, so the wallet shows a pattern of use rather than a single deposit. Cost: about ${gas} a week in gas. Time: 10 minutes a week.`,
    `Keep the position open for at least ${hold} days and do not withdraw early, because airdrops usually snapshot wallets that held through the whole period. Cost: ${cap} stays locked. Time: ${hold} days.`,
    `Check the protocol's points or rewards page once a week and never pay to claim anything until the token is actually live, because fake claim sites are the most common way farms lose money. Cost: nothing to check. Time: 5 minutes a week.`,
    `Keep a farm log with the wallet address, the deposit date and the amounts, and write down the exit plan before the token launches so the decision is made calmly, not in a rush. Cost: nothing. Time: 5 minutes.`,
  ];
  return steps.map((s) => s.trim());
}

export function buildBoard(snapshot: Snapshot): { rows: RadarRow[]; live: LiveRow[]; setAside: SetAsideRow[] } {
  const asOfDate = new Date(snapshot.as_of + 'T00:00:00Z');
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = snapshot.watchlist
    .map((slug) => bySlug.get(slug))
    .filter((p): p is SnapshotProtocol => p !== undefined);
  const watchlistSlugs = new Set(snapshot.watchlist);
  const early = snapshot.protocols
    .filter((p) => isRuleClean(p) && !watchlistSlugs.has(p.slug))
    .sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0));
  const chosen = [...watchlist, ...early];
  const scored = chosen.map((p) => ({
    protocol: p,
    implied: impliedValue(p, asOfDate),
    age: ageDays(p, asOfDate),
  }));
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.protocol.slug.localeCompare(b.protocol.slug);
  });
  const rows: RadarRow[] = scored.map(({ protocol, implied, age }, i) => ({
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: Array.isArray(protocol.chains) && protocol.chains.length > 0 ? protocol.chains : [],
    tvl_usd: protocol.tvl_usd ?? 0,
    change_7d: protocol.change_7d,
    age_days: age,
    listed_at: protocol.listed_at,
    rank: i + 1,
    implied_value_usd: implied,
    farm_steps: farmSteps(protocol, asOfDate),
  }));
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.category?.toLowerCase() !== 'cex')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: Array.isArray(p.chains) && p.chains.length > 0 ? p.chains : [],
      tvl_usd: p.tvl_usd ?? 0,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
    }));
  const setAside = snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .sort((a, b) => (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0))
    .slice(0, SET_ASIDE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: Array.isArray(p.chains) && p.chains.length > 0 ? p.chains : [],
      tvl_usd: p.tvl_usd ?? 0,
      reason: exclusionReason(p) ?? 'set aside',
    }));
  return { rows, live, setAside };
}

export function boardIssues(snapshot: Snapshot, rows: RadarRow[]): string[] {
  const issues: string[] = [];
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    if (!bySlug.has(slug)) {
      issues.push(`watchlist slug ${slug} is not in the snapshot`);
    } else if (!rows.some((r) => r.slug === slug)) {
      issues.push(`watchlist slug ${slug} is missing from the board`);
    }
  }
  for (const row of rows) {
    if (!bySlug.has(row.slug)) issues.push(`row ${row.slug} is not in the snapshot`);
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      issues.push(`ranks are not exactly 1..N (expected ${i + 1}, got ${ranks[i]})`);
      break;
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      issues.push(`implied value rises at rank ${rows[i].rank}`);
      break;
    }
  }
  return issues;
}

export function dataScript(
  snapshot: Snapshot,
  rows: RadarRow[],
  live: LiveRow[],
  setAside: SetAsideRow[],
): string {
  const payload = {
    model: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    counts: {
      watchlist: snapshot.watchlist.length,
      pre_token: rows.length,
      early: rows.length - snapshot.watchlist.length,
      set_aside_total: snapshot.protocols.filter((p) => isPreToken(p) && exclusionReason(p) !== null).length,
      live: live.length,
      snapshot_protocols: snapshot.protocols.length,
    },
    rows: rows.map(({ farm_steps: _farmSteps, ...rest }) => rest),
    live,
    set_aside: setAside,
  };
  return `window.RADAR = ${JSON.stringify(payload, null, 2)};\n`;
}

export function boardJson(rows: RadarRow[]): string {
  return `${JSON.stringify({ rows }, null, 2)}\n`;
}
