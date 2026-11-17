// Token Radar dashboard.
//
// Renders the board from window.RADAR (written by main.ts as data.js) and
// recomputes every row's implied value and farm plan from the same numbers
// the entry used, so the detail view can show the model's working and a
// reader can check that the page and the board agree. The model below is
// the entry's model ("radar-2"); it must stay identical to lib/model.ts.
//
// No network: the page reads only data.js, and every link on it is
// relative.

(function () {
  'use strict';

  // --- The model (identical to lib/model.ts) --------------------------------
  var SECTOR_MULTIPLE = {
    dexs: 0.5, lending: 0.5, cdp: 0.5, derivatives: 0.5, perpetuals: 0.5,
    yield: 0.4, 'yield aggregator': 0.4, 'liquidity manager': 0.4,
    'risk curators': 0.4, 'onchain capital allocator': 0.4,
    'collateral markets': 0.4, 'uncollateralized lending': 0.4,
    'leveraged farming': 0.4, farm: 0.4,
    'staking pool': 0.3, restaking: 0.3, insurance: 0.3,
    'prediction market': 0.3, 'options vault': 0.3,
    'interest rate derivatives': 0.3, rwa: 0.3, 'basis trading': 0.3,
    payments: 0.3, indexes: 0.3, chain: 0.3, privacy: 0.3,
    'otc marketplace': 0.3, 'governance incentives': 0.3,
    'crypto card issuer': 0.3, 'cross chain bridge': 0.3,
    'stablecoin wrapper': 0.3, 'dual-token stablecoin': 0.3,
    'anchor btc': 0.3, 'decentralized btc': 0.3, 'cdp manager': 0.3,
  };
  var SECTOR_DEFAULT = 0.3;
  var GROWTH_WEIGHT = 0.6;
  var GROWTH_MIN = -60;
  var GROWTH_MAX = 120;
  var MATURITY_BASE = 0.7;
  var MATURITY_SPAN_DAYS = 1460;
  var UNKNOWN_AGE_DAYS = 365;

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function sectorMultiple(category) {
    if (!category) return SECTOR_DEFAULT;
    var key = String(category).toLowerCase();
    return Object.prototype.hasOwnProperty.call(SECTOR_MULTIPLE, key) ? SECTOR_MULTIPLE[key] : SECTOR_DEFAULT;
  }

  function growthMultiplier(change7d) {
    if (typeof change7d !== 'number' || !isFinite(change7d)) return 1;
    return 1 + (clamp(change7d, GROWTH_MIN, GROWTH_MAX) / 100) * GROWTH_WEIGHT;
  }

  function maturityMultiplier(age) {
    var days = typeof age === 'number' && isFinite(age) ? age : UNKNOWN_AGE_DAYS;
    return MATURITY_BASE + (1 - MATURITY_BASE) * (Math.min(days, MATURITY_SPAN_DAYS) / MATURITY_SPAN_DAYS);
  }

  function impliedOf(row) {
    if (typeof row.tvl_usd !== 'number' || !(row.tvl_usd > 0)) return 1;
    var value =
      row.tvl_usd *
      sectorMultiple(row.category) *
      growthMultiplier(row.change_7d) *
      maturityMultiplier(row.age_days);
    return Math.max(1, Math.round(value));
  }

  function gasUsd(chain) {
    var c = String(chain || '').toLowerCase();
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

  function fmtUsd(n) {
    if (n >= 1000000000) return '$' + (n / 1000000000).toFixed(2) + 'B';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function gasText(chain) {
    var g = gasUsd(chain);
    return g < 1 ? '$' + g.toFixed(2) : '$' + g.toFixed(0);
  }

  function capitalFor(tvl) {
    if (tvl >= 5000000000) return 250;
    if (tvl >= 1000000000) return 150;
    if (tvl >= 100000000) return 100;
    return 50;
  }

  function holdDays(age) {
    if (typeof age === 'number' && age >= 730) return 30;
    if (typeof age === 'number' && age >= 365) return 45;
    return 60;
  }

  function mainAction(category, name, chain, capital) {
    var c = String(category || '').toLowerCase();
    var cap = fmtUsd(capital);
    switch (c) {
      case 'lending':
      case 'cdp':
      case 'collateral markets':
        return 'Supply ' + cap + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it, so the wallet has both a supply and a borrow position.';
      case 'dexs':
        return 'Provide ' + cap + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the position in range, so the wallet earns fees and counts as an active liquidity provider.';
      case 'yield':
      case 'yield aggregator':
      case 'liquidity manager':
        return 'Deposit ' + cap + ' into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares, so the wallet is an active depositor rather than a passer-by.';
      case 'risk curators':
      case 'onchain capital allocator':
        return 'Deposit ' + cap + ' into a ' + name + ' vault on ' + chain + ' and keep the shares, so the wallet is an active allocator in the vault the protocol runs.';
      case 'derivatives':
      case 'perpetuals':
        return 'Deposit ' + cap + ' of USDC as margin on ' + name + ' and open one small hedged position, so the wallet has a funded trading account and a real trade on record.';
      case 'rwa':
        return 'Mint ' + cap + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it, so the wallet owns the tokenised asset the protocol issues.';
      case 'basis trading':
        return 'Deposit ' + cap + ' into ' + name + "'s basis vault on " + chain + ' and keep the position, so the wallet earns the funding-rate spread the protocol captures.';
      case 'prediction market':
        return 'Fund ' + cap + ' and take one position in ' + name + "'s most active market, so the wallet has a funded account and a live prediction on record.";
      case 'insurance':
        return 'Buy ' + cap + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active, so the wallet is a real customer of the cover the protocol sells.';
      case 'staking pool':
      case 'restaking':
        return 'Stake ' + cap + " of the chain's staking asset through " + name + ' and keep the receipt token, so the wallet is a staker the protocol can count.';
      case 'stablecoin wrapper':
      case 'dual-token stablecoin':
        return 'Mint ' + cap + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it, so the wallet holds the stablecoin the protocol issues.';
      case 'payments':
        return 'Route ' + cap + ' of payments through ' + name + ' on ' + chain + ' over the month, so the wallet is an active user of the payment rail.';
      case 'chain':
        return 'Use ' + name + "'s main app on " + chain + ': one transaction a week, such as a swap or a stake, so the wallet is active on the chain itself.';
      default:
        return 'Deposit ' + cap + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open, so the wallet is an active user of the protocol\'s core product.';
    }
  }

  function farmSteps(row) {
    var chains = Array.isArray(row.chains) && row.chains.length > 0 ? row.chains : ['Ethereum'];
    var chain = chains[0];
    var gas = gasText(chain);
    var capital = capitalFor(typeof row.tvl_usd === 'number' ? row.tvl_usd : 0);
    var cap = fmtUsd(capital);
    var hold = holdDays(row.age_days);
    var secondChain = chains.length > 1 ? chains[1] : null;
    var steps = [
      'Set up a fresh wallet for this farm and write the seed phrase down on paper, offline. Fund it with ' + cap + ' plus enough ' + chain + ' gas for a week of activity. Cost: about ' + gas + ' for the first transaction. Time: 10 minutes.',
      mainAction(row.category, row.name, chain, capital) + ' Cost: ' + cap + ' of capital plus about ' + gas + ' in gas. Time: 15 minutes.',
      secondChain
        ? 'Repeat the same position on ' + secondChain + " so the wallet is active on two chains, which is how the protocol's own leaderboard usually counts a real user. Cost: about " + gasText(secondChain) + ' in gas. Time: 10 minutes.'
        : 'Make a second qualifying action in the same app, such as a swap, a borrow or a vote, so the wallet is more than a one-off deposit. Cost: about ' + gas + ' in gas. Time: 10 minutes.',
      'Come back once a week and make one qualifying action, such as adding to the position, claiming rewards or voting, so the wallet shows a pattern of use rather than a single deposit. Cost: about ' + gas + ' a week in gas. Time: 10 minutes a week.',
      'Keep the position open for at least ' + hold + ' days and do not withdraw early, because airdrops usually snapshot wallets that held through the whole period. Cost: ' + cap + ' stays locked. Time: ' + hold + ' days.',
      "Check the protocol's points or rewards page once a week and never pay to claim anything until the token is actually live, because fake claim sites are the most common way farms lose money. Cost: nothing to check. Time: 5 minutes a week.",
      'Keep a farm log with the wallet address, the deposit date and the amounts, and write down the exit plan before the token launches so the decision is made calmly, not in a rush. Cost: nothing. Time: 5 minutes.',
    ];
    return steps.map(function (s) { return s.trim(); });
  }

  // --- Formatting ------------------------------------------------------------
  function fmtPct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (typeof days !== 'number' || !isFinite(days)) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- State -----------------------------------------------------------------
  var data = window.RADAR;
  var state = {
    tab: 'pre',
    q: '',
    category: '',
    chain: '',
    sortKey: 'value',
    sortDir: 'desc',
    selected: null,
  };

  var els = {
    asof: document.getElementById('meta-asof'),
    ledeTitle: document.getElementById('lede-title'),
    factWatchlist: document.getElementById('fact-watchlist'),
    factRows: document.getElementById('fact-rows'),
    factEarly: document.getElementById('fact-early'),
    factSetaside: document.getElementById('fact-setaside'),
    q: document.getElementById('q'),
    category: document.getElementById('category'),
    chain: document.getElementById('chain'),
    tabPre: document.getElementById('tab-pre'),
    tabLive: document.getElementById('tab-live'),
    tabSetaside: document.getElementById('tab-setaside'),
    count: document.getElementById('count'),
    panelNote: document.getElementById('panel-note'),
    valueHeader: document.getElementById('value-header'),
    rows: document.getElementById('rows'),
    empty: document.getElementById('empty'),
    clearFilters: document.getElementById('clear-filters'),
    detail: document.getElementById('detail'),
    detailSub: document.getElementById('detail-sub'),
    detailTitle: document.getElementById('detail-title'),
    detailMeta: document.getElementById('detail-meta'),
    detailBody: document.getElementById('detail-body'),
    detailClose: document.getElementById('detail-close'),
  };

  var NOTES = {
    pre: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.',
    live: 'Protocols that already trade, largest market cap first. They are shown for contrast — a token that exists cannot launch.',
    setaside: 'Pre-token protocols the house rule sets aside, largest TVL first, with the reason each one was left out.',
  };

  var VALUE_LABELS = { pre: 'Implied value', live: 'Market cap', setaside: 'Why set aside' };

  function tabRows() {
    if (state.tab === 'live') {
      return data.live.map(function (r, i) {
        return { kind: 'live', rank: i + 1, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: null, value: r.mcap_usd, token: 'trading', raw: r };
      });
    }
    if (state.tab === 'setaside') {
      return data.set_aside.map(function (r, i) {
        return { kind: 'setaside', rank: i + 1, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: null, age_days: null, value: r.tvl_usd, token: 'no token', reason: r.reason, raw: r };
      });
    }
    return data.rows.map(function (r) {
      return { kind: 'pre', rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, value: r.implied_value_usd, token: 'no token', raw: r };
    });
  }

  function matches(row) {
    if (state.category && (row.category || '') !== state.category) return false;
    if (state.chain && (!Array.isArray(row.chains) || row.chains.indexOf(state.chain) === -1)) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = [row.name, row.category || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function sortValue(row, key) {
    switch (key) {
      case 'rank': return row.rank;
      case 'name': return row.name.toLowerCase();
      case 'tvl': return row.tvl_usd;
      case 'change': return typeof row.change_7d === 'number' ? row.change_7d : -Infinity;
      case 'age': return typeof row.age_days === 'number' ? row.age_days : -1;
      case 'value': return row.value;
      case 'token': return row.token;
      default: return row.rank;
    }
  }

  function sortedRows(rows) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      if (av === bv) return a.slug.localeCompare(b.slug) * dir;
      return (av < bv ? -1 : 1) * dir;
    });
  }

  function valueCell(row, maxValue) {
    if (row.kind === 'setaside') {
      return '<td>' + esc(row.reason) + '</td>';
    }
    var pct = maxValue > 0 ? Math.max(0.5, (row.value / maxValue) * 100) : 0;
    return '<td><span class="implied"><span class="bar" aria-hidden="true"><i style="width:' + pct.toFixed(1) + '%"></i></span><span class="num">' + esc(fmtUsd(row.value)) + '</span></span></td>';
  }

  function render() {
    var rows = tabRows().filter(matches);
    var sorted = sortedRows(rows);
    var maxValue = 0;
    tabRows().forEach(function (r) { if (r.value > maxValue) maxValue = r.value; });

    els.panelNote.textContent = NOTES[state.tab];
    els.valueHeader.childNodes[0].textContent = VALUE_LABELS[state.tab] + ' ';
    els.count.textContent = rows.length === tabRows().length
      ? rows.length + ' rows shown'
      : rows.length + ' of ' + tabRows().length + ' rows shown';
    els.empty.hidden = sorted.length > 0;

    var html = sorted.map(function (row) {
      var sub = [row.category || 'No category', (row.chains || []).slice(0, 2).join(', ')].filter(Boolean).join(' on ');
      var change = row.change_7d;
      var changeClass = typeof change === 'number' ? (change >= 0 ? 'pos' : 'neg') : '';
      var tokenClass = row.token === 'trading' ? 'status live' : 'status';
      return '<tr data-slug="' + esc(row.slug) + '" data-kind="' + row.kind + '" tabindex="0" data-selected="' + (state.selected === row.slug ? 'true' : 'false') + '">' +
        '<td class="num">' + row.rank + '</td>' +
        '<td><span class="name"><b>' + esc(row.name) + '</b><span class="sub">' + esc(sub) + '</span></span></td>' +
        '<td class="num">' + esc(fmtUsd(row.tvl_usd)) + '</td>' +
        '<td class="num ' + changeClass + '">' + esc(fmtPct(change)) + '</td>' +
        '<td class="num">' + esc(fmtAge(row.age_days)) + '</td>' +
        valueCell(row, maxValue) +
        '<td><span class="' + tokenClass + '">' + esc(row.token) + '</span></td>' +
        '</tr>';
    }).join('');
    els.rows.innerHTML = html;

    document.querySelectorAll('th button[data-sort]').forEach(function (btn) {
      btn.removeAttribute('aria-sort');
      if (btn.getAttribute('data-sort') === state.sortKey) {
        btn.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      }
    });
  }

  function openDetail(row) {
    state.selected = row.slug;
    render();
    var raw = row.raw;
    els.detailSub.textContent = 'Rank ' + row.rank + ' · ' + (row.category || 'No category');
    els.detailTitle.textContent = row.name;
    els.detailMeta.textContent = (row.chains || []).join(', ') + (raw.listed_at ? ' · listed ' + raw.listed_at : '');
    var body = '';
    if (row.kind === 'pre') {
      var sector = sectorMultiple(raw.category);
      var growth = growthMultiplier(raw.change_7d);
      var maturity = maturityMultiplier(raw.age_days);
      var recomputed = impliedOf(raw);
      var agrees = recomputed === raw.implied_value_usd;
      var steps = farmSteps(raw);
      body += '<div class="detail-section"><h3>Implied value — how it is built</h3><div class="equation">' +
        '<div><span>TVL</span><b>' + esc(fmtUsd(raw.tvl_usd)) + '</b></div>' +
        '<div><span>Sector multiple (' + esc(raw.category || 'no category') + ')</span><b>× ' + sector.toFixed(2) + '</b></div>' +
        '<div><span>Growth multiplier (' + esc(fmtPct(raw.change_7d)) + ' in 7 days)</span><b>× ' + growth.toFixed(3) + '</b></div>' +
        '<div><span>Maturity multiplier (' + esc(fmtAge(raw.age_days)) + ' without a token)</span><b>× ' + maturity.toFixed(3) + '</b></div>' +
        '<div class="total"><span>Implied value</span><b>' + esc(fmtUsd(recomputed)) + '</b></div>' +
        '</div><p style="margin-top:12px">' + (agrees ? 'Recomputed here from the same numbers — it matches the board value.' : 'Recomputed here from the same numbers — it differs from the board value, so treat this row with care.') + '</p></div>';
      body += '<div class="detail-section"><h3>Farm plan — 7 steps</h3><ol class="steps">' +
        steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ol></div>';
      body += '<div class="detail-section"><p>No token on record in the snapshot. The plan is a model of what a farm could look like, not a promise that a token is coming.</p></div>';
    } else if (row.kind === 'live') {
      body += '<div class="detail-section"><h3>Already trading</h3><p>This protocol has a token with a market cap of ' + esc(fmtUsd(raw.mcap_usd)) + ' on ' + esc(fmtUsd(raw.tvl_usd)) + ' of TVL. It is on the board for contrast only: a token that exists cannot launch, so there is no farm plan for it.</p></div>';
    } else {
      body += '<div class="detail-section"><h3>Why this protocol is set aside</h3><p>' + esc(raw.reason) + '. The rule leaves it out of the pre-token ranking, and the reason is shown so the exclusion can be checked rather than trusted.</p></div>';
    }
    els.detailBody.innerHTML = body;
    if (!els.detail.open) els.detail.showModal();
    writeHash();
  }

  function closeDetail() {
    if (els.detail.open) els.detail.close();
    state.selected = null;
    render();
    writeHash();
  }

  function setTab(tab) {
    state.tab = tab;
    els.tabPre.setAttribute('aria-pressed', String(tab === 'pre'));
    els.tabLive.setAttribute('aria-pressed', String(tab === 'live'));
    els.tabSetaside.setAttribute('aria-pressed', String(tab === 'setaside'));
    render();
    writeHash();
  }

  function fillSelects() {
    var cats = {};
    var chains = {};
    data.rows.concat(data.live, data.set_aside).forEach(function (r) {
      if (r.category) cats[r.category] = true;
      (r.chains || []).forEach(function (c) { chains[c] = true; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      els.category.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      els.chain.appendChild(o);
    });
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    var tab = params.get('tab');
    if (tab === 'live' || tab === 'setaside') state.tab = tab;
    els.q.value = state.q;
    els.category.value = state.category;
    els.chain.value = state.chain;
    els.tabPre.setAttribute('aria-pressed', String(state.tab === 'pre'));
    els.tabLive.setAttribute('aria-pressed', String(state.tab === 'live'));
    els.tabSetaside.setAttribute('aria-pressed', String(state.tab === 'setaside'));
    render();
    var slug = params.get('p');
    if (slug) {
      var found = tabRows().find(function (r) { return r.slug === slug; });
      if (found) openDetail(found);
    }
  }

  function init() {
    if (!data || !Array.isArray(data.rows)) {
      els.panelNote.textContent = 'No radar data loaded. Open this page from the entry output, where data.js sits beside the dashboard.';
      return;
    }
    els.asof.textContent = data.as_of;
    els.ledeTitle.textContent = data.counts.pre_token + ' pre-token protocols, ranked by implied value';
    els.factWatchlist.textContent = data.counts.watchlist + ' / ' + data.counts.watchlist;
    els.factRows.textContent = String(data.counts.pre_token);
    els.factEarly.textContent = String(data.counts.early);
    els.factSetaside.textContent = String(data.counts.set_aside_total);
    fillSelects();

    els.q.addEventListener('input', function () { state.q = els.q.value.trim(); render(); writeHash(); });
    els.category.addEventListener('change', function () { state.category = els.category.value; render(); writeHash(); });
    els.chain.addEventListener('change', function () { state.chain = els.chain.value; render(); writeHash(); });
    els.tabPre.addEventListener('click', function () { setTab('pre'); });
    els.tabLive.addEventListener('click', function () { setTab('live'); });
    els.tabSetaside.addEventListener('click', function () { setTab('setaside'); });
    els.clearFilters.addEventListener('click', function () {
      state.q = ''; state.category = ''; state.chain = '';
      els.q.value = ''; els.category.value = ''; els.chain.value = '';
      render(); writeHash();
    });
    document.querySelectorAll('th button[data-sort]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'name' || key === 'token' ? 'asc' : 'desc';
        }
        render();
      });
    });
    els.rows.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      var row = tabRows().find(function (r) { return r.slug === tr.getAttribute('data-slug'); });
      if (row) openDetail(row);
    });
    els.rows.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      e.preventDefault();
      var row = tabRows().find(function (r) { return r.slug === tr.getAttribute('data-slug'); });
      if (row) openDetail(row);
    });
    els.detailClose.addEventListener('click', closeDetail);
    els.detail.addEventListener('close', function () { state.selected = null; render(); writeHash(); });
    els.detail.addEventListener('click', function (e) {
      if (e.target === els.detail) closeDetail();
    });

    readHash();
  }

  init();
})();
