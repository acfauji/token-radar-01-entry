// Token Radar — radar-5 dashboard. Vanilla JS, no frameworks, no network.
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders:
// - Sortable, filterable board with implied value, launch odds, value ranges, verdict
// - Per-protocol detail drawer with model breakdown, farm plan, sensitivity grid
// - Live token view (traded protocols set aside)
// - Model validation panel: scatter plot, walk-forward, ablation, residuals
// - Model sandbox with interactive sliders
// - Sensitivity grid (deposit × airdrop share)
// - Research Note tab (launch odds, value ranges, limitations)
// - Set-Aside tab (excluded protocols with rules)
// - CSV export
// - Self-verification badge (recomputes vs board.json)
// - Limitations panel
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var app = document.getElementById('board');
  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    detailTab: 'model',
    // Sandbox parameters (start from model defaults)
    sandbox: {
      base_coeff: DATA.model.base_coeff,
      base_exponent: DATA.model.base_exponent,
      growth_weight: DATA.model.growth_weight,
      growth_floor: DATA.model.growth_floor,
      growth_cap: DATA.model.growth_cap,
      seasoning_floor: DATA.model.seasoning_floor,
      seasoning_cap: DATA.model.seasoning_cap,
      seasoning_days: DATA.model.seasoning_days,
    }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtOdds(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n * 100).toFixed(1) + '%';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var seasoning = model.seasoning_floor + (Math.min(Math.max(age, 0), model.seasoning_days) / model.seasoning_days) * (model.seasoning_cap - model.seasoning_floor);
    var family = row.family_factor || 1;
    var sibling = row.sibling_discount || 1;
    var impliedBase = model.base_coeff * Math.pow(row.tvl_usd, model.base_exponent);
    var valueIfLaunches = Math.max(1, Math.round(impliedBase * family * growthMult * seasoning * sibling));
    return Math.max(1, Math.round(valueIfLaunches * (row.launch_odds || 0)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan generation (mirrors lib/model.ts)
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gasSetup = capital >= 150 ? 'about $8 of gas' : 'about $4 of gas';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gasSetup, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // Hash-based state persistence
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Filtering & Sorting
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.launch_odds || 0; bv = b.launch_odds || 0; }
      else if (key === 'verdict') { av = a.verdict === 'FARM' ? 2 : a.verdict === 'MARGINAL' ? 1 : 0; bv = b.verdict === 'FARM' ? 2 : b.verdict === 'MARGINAL' ? 1 : 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // Header
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar — radar-5' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // Hero
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied launch value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value = value-if-launches × launch-odds. Model: radar-5 (power-law + hazard curve).' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // Controls
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var validation = el('button', { type: 'button', 'aria-pressed': state.tab === 'validation' ? 'true' : 'false', text: 'Model Validation', onclick: function () { state.tab = 'validation'; render(); } });
    var limitations = el('button', { type: 'button', 'aria-pressed': state.tab === 'limitations' ? 'true' : 'false', text: 'Limitations', onclick: function () { state.tab = 'limitations'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, pre, live, validation, limitations)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'validation' ? 'Model validation panel' : 'Limitations & assumptions' })
    );
  }

  // Sort Header
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  // Board Table
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var recomputed = impliedOf(r, DATA.model);
      var match = recomputed === r.implied_value_usd;
      var verdictClass = r.verdict === 'FARM' ? 'pos' : r.verdict === 'MARGINAL' ? 'thin' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtOdds(r.launch_odds) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          !match ? el('span', { class: 'sub', style: 'color: var(--warning);', text: '⚠ stale' }) : null
        )),
        el('td', null, el('span', { class: 'status ' + verdictClass, text: r.verdict })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d %'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Launch %'),
            sortHeader('implied', 'Implied Value'),
            sortHeader('verdict', 'Verdict'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // Live Token Table
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d %' }), el('th', { scope: 'col', text: 'Market Cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // Model Validation Panel
  function validationPanel() {
    var v = DATA.validation;
    var wf = v.walk_forward;
    var abl = v.ablation;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Model Validation (radar-5)' }),
      el('p', { class: 'sub', text: 'The base curve is a power-law fit on 115 traded tokens (13 outliers trimmed at >30×). No protocol name is special-cased.' }),
      
      // Scatter plot description
      el('h3', { text: 'Scatter: log₁₀(mcap) vs log₁₀(TVL/100M)' }),
      el('p', { class: 'sub', text: v.scatter.length + ' traded tokens. Blue = actual, Orange = fitted curve. 13 outliers (>30×) trimmed.' }),
      el('div', { class: 'formula' },
        'log₁₀(mcap) = 7.221 + 0.562 × log₁₀(TVL / 100M)  (R² ≈ 0.19, residual SD ≈ 2.09)'
      ),
      
      // Walk-forward table
      el('h3', { text: 'Walk-Forward Validation (4 cutoffs)' }),
      el('p', { class: 'sub', text: 'Fit on tokens listed before cutoff, test on tokens listed after. Lower RMSE = better.' }),
      el('div', { class: 'sens-wrap' },
        el('table', { class: 'sens-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Cutoff' }),
            el('th', { scope: 'col', text: 'Curve RMSE' }),
            el('th', { scope: 'col', text: 'Flat Multiple RMSE' }),
            el('th', { scope: 'col', text: 'Test Tokens' }),
            el('th', { scope: 'col', text: 'Winner' })
          )),
          el('tbody', null, wf.map(function(w) {
            return el('tr', null,
              el('td', { text: w.cutoff }),
              el('td', { class: 'num', text: w.curve_rmse.toFixed(3) }),
              el('td', { class: 'num', text: w.flat_rmse.toFixed(3) }),
              el('td', { class: 'num', text: w.n_test }),
              el('td', { class: w.curve_rmse < w.flat_rmse ? 'pos' : 'neg', text: w.curve_rmse < w.flat_rmse ? 'Curve ✓' : 'Flat ✓' })
            );
          }))
        )
      ),
      
      // Ablation table
      el('h3', { text: 'Ablation Studies (tested & rejected)' }),
      el('p', { class: 'sub', text: 'Each feature tested on same rows; must win BOTH leave-one-out AND walk-forward to ship. None did.' }),
      el('div', { class: 'sens-wrap' },
        el('table', { class: 'sens-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Feature' }),
            el('th', { scope: 'col', text: 'LOO RMSE' }),
            el('th', { scope: 'col', text: 'Walk-Fwd RMSE' }),
            el('th', { scope: 'col', text: 'Shipped' }),
            el('th', { scope: 'col', text: 'Reason' })
          )),
          el('tbody', null, DATA.validation.ablation.map(function(a) {
            return el('tr', null,
              el('td', { text: a.name }),
              el('td', { class: 'num', text: a.loo_rmse.toFixed(2) }),
              el('td', { class: 'num', text: a.walk_forward_rmse.toFixed(2) }),
              el('td', { class: a.shipped ? 'pos' : 'neg', text: a.shipped ? 'Yes' : 'No' }),
              el('td', { text: a.reason })
            );
          }))
        )
      ),
      
      // Residual quantiles
      el('h3', { text: 'Residual Quantiles (leave-one-out)' }),
      el('p', { class: 'sub', text: 'Multipliers for value ranges. P25-P75 used for summary bands, P10-P90 for detail ranges.' }),
      el('div', { class: 'sens-wrap' },
        el('table', { class: 'sens-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Quantile' }),
            el('th', { scope: 'col', text: 'Multiplier' }),
            el('th', { scope: 'col', text: 'Interpretation' })
          )),
          el('tbody', null, [
            { q: 'P10', mult: v.residual_quantiles.p10, interp: 'Extreme low (10% of tokens below)' },
            { q: 'P25', mult: v.residual_quantiles.p25, interp: 'Low end of typical range' },
            { q: 'P50', mult: v.residual_quantiles.p50, interp: 'Median (point estimate)' },
            { q: 'P75', mult: v.residual_quantiles.p75, interp: 'High end of typical range' },
            { q: 'P90', mult: v.residual_quantiles.p90, interp: 'Extreme high (10% of tokens above)' }
          ].map(function(q) {
            return el('tr', null,
              el('td', { text: q.q }),
              el('td', { class: 'num', text: q.mult.toFixed(2) + '×' }),
              el('td', { text: q.interp })
            );
          }))
        )
      )
    );
  }

  // Limitations Panel
  function limitationsPanel() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Limitations & Assumptions (Honest)' }),
      el('p', { class: 'sub', text: 'No model is perfect. Here is what radar-5 cannot do and what assumptions drive the numbers.' }),
      
      el('h3', { text: 'Model Weakness' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Low R² (≈0.19):' }), el('span', { text: ' TVL explains only ~19% of mcap variation. The value range (P25-P75) spans ~16× — a single number would lie.' })),
        el('li', null, el('b', { text: 'No launch prediction:' }), el('span', { text: ' Launch odds are from other protocols\' history, not from any protocol\'s own announcements. A team can always choose never to launch.' })),
        el('li', null, el('b', { text: 'DefiLlama lag:' }), el('span', { text: ' Some "pre-token" protocols may have unrecorded tokens. The watchlist rules are a filter, not proof.' })),
        el('li', null, el('b', { text: 'Survivorship bias:' }), el('span', { text: ' Only protocols with ≥$5M TVL are in the snapshot. Dead protocols are invisible.' }))
      ),
      
      el('h3', { text: 'Economic Assumptions (Explicit, Not Hidden)' }),
      el('div', { class: 'sens-wrap' },
        el('table', { class: 'sens-table' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Assumption' }), el('th', { scope: 'col', text: 'Value' }), el('th', { scope: 'col', text: 'Source / Note' }))),
          el('tbody', null, [
            { a: 'Airdrop share to farmers', v: '7.5%', n: 'Industry heuristic; sensitivity grid tests 5–20%' },
            { a: 'Farming TVL share', v: '25%', n: 'Fraction of TVL actively farming points' },
            { a: 'Points season length', v: '180 days', n: 'Typical points program duration' },
            { a: 'Gas per transaction', v: '$5 (Ethereum)', n: 'Varies by chain; sensitivity grid shows impact' },
            { a: 'Transactions per farm', v: '3', n: 'Setup + weekly + claim' },
            { a: 'Opportunity cost (APY)', v: '8%', n: 'Risk-free / T-bill yield foregone' },
            { a: 'Global launch rate', v: '54.9%', n: 'From snapshot: 144/262 non-CEX protocols launched' },
            { a: 'Hazard pseudocount', v: '10', n: 'Shrinkage toward global rate for small categories' }
          ].map(function(r) {
            return el('tr', null, el('td', { text: r.a }), el('td', { class: 'num', text: r.v }), el('td', { text: r.n }));
          }))
        )
      ),
      
      el('h3', { text: 'What radar-5 Does NOT Do' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Predict launch dates:' }), el('span', { text: ' No timeline model; odds are actuarial, not calendar.' })),
        el('li', null, el('b', { text: 'Predict exact prices:' }), el('span', { text: ' Value ranges span ~16× (P25-P75). Point estimates are misleading.' })),
        el('li', null, el('b', { text: 'Account for team decisions:' }), el('span', { text: ' A protocol can stay tokenless forever regardless of odds.' })),
        el('li', null, el('b', { text: 'Model wrapped/staked products:' }), el('span', { text: ' These are explicitly excluded per watchlist rules.' }))
      ),
      
      el('h3', { text: 'Data Limitations' }),
      el('ul', null,
        el('li', null, el('b', { text: 'Snapshot date:' }), el('span', { text: ' ' + DATA.as_of + ' (frozen). TVL, growth, ages are as of this date.' })),
        el('li', null, el('b', { text: 'TVL threshold:' }), el('span', { text: ' Only protocols ≥ $5M TVL included. Smaller protocols invisible.' })),
        el('li', null, el('b', { text: 'Listed-at proxy:' }), el('span', { text: ' Age uses DefiLlama\'s first-tracking date, not actual launch.' })),
        el('li', null, el('b', { text: 'Category noise:' }), el('span', { text: ' DefiLlama categories are imperfect; family factors shrink small samples to neutral.' }))
      )
    );
  }

  // Model Panel (with Sandbox)
  function modelPanel() {
    var m = DATA.model;
    var s = state.sandbox;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed (radar-5: power-law + hazard curve)' }),
      el('p', { class: 'sub', text: 'implied = value_if_launches × launch_odds. value_if_launches from power-law fit. launch_odds from hazard curve (age-band + category, shrunk).' }),
      el('div', { class: 'formula' },
        'value_if_launches = round( ' + m.base_coeff + ' × TVL^' + m.base_exponent.toFixed(6) +
        ' × family_factor × (1 + clamp(7d%, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight +
        ' ) × (' + m.seasoning_floor + ' + min(age, ' + m.seasoning_days + ') / ' + m.seasoning_days + ' × ' + (m.seasoning_cap - m.seasoning_floor).toFixed(2) +
        ' ) × sibling_discount )'
      ),
      el('p', { class: 'sub', text: 'launch_odds = clamp(mean(age_band_rate, category_rate), 5%, 90%). Rates shrunk toward global ' + (m.global_launch_rate * 100).toFixed(1) + '%.' }),
      el('p', { class: 'sub', text: 'TVL and 7-day growth from snapshot. Age from listed-at date. Family factors: shrunk median residuals per category (capped 0.5×–2.5×). Watchlist sibling of traded token halved.' }),
      
      // Model Sandbox
      el('h3', { text: 'Model Sandbox (live recomputation)' }),
      el('p', { class: 'sub', text: 'Adjust parameters below to see how the top 10 implied values change. Values reset on page reload.' }),
      el('div', { class: 'sandbox' },
        sandboxRow('base_coeff', 'Base coefficient', 100, 5000, s.base_coeff, 1, 'Scales the power-law curve vertically'),
        sandboxRow('base_exponent', 'Base exponent (TVL elasticity)', 0.1, 1.0, s.base_exponent, 0.001, '<1 = bigger protocols cheaper per TVL'),
        sandboxRow('growth_weight', 'Growth weight', 0, 2, s.growth_weight, 0.01, 'How much 7d TVL change affects implied value'),
        sandboxRow('growth_floor', 'Growth floor (%)', -200, 0, s.growth_floor, 1, 'Minimum 7d growth considered'),
        sandboxRow('growth_cap', 'Growth cap (%)', 0, 500, s.growth_cap, 1, 'Maximum 7d growth considered'),
        sandboxRow('seasoning_floor', 'Seasoning floor (launch)', 0.1, 1, s.seasoning_floor, 0.01, 'Multiplier at token launch'),
        sandboxRow('seasoning_cap', 'Seasoning cap (18mo)', 0.5, 2, s.seasoning_cap, 0.01, 'Multiplier at 18 months (540 days)'),
        sandboxRow('seasoning_days', 'Seasoning horizon (days)', 180, 1080, s.seasoning_days, 10, 'Days to reach seasoning cap'),
      ),
      el('button', { class: 'button primary', type: 'button', text: 'Apply Sandbox to Board', onclick: applySandbox }),
    );
  }

  function sandboxRow(key, label, min, max, value, step, hint) {
    return el('div', { class: 'sandbox-row' },
      el('label', { text: label + ' ' }, el('span', { class: 'hint', text: '(' + hint + ')' })),
      el('div', { style: 'display:flex;align-items:center;gap:8px;flex:1' },
        el('input', { type: 'range', min: min, max: max, step: step, value: value, oninput: function(e) { state.sandbox[key] = parseFloat(e.target.value); updateSandboxOutput(key, e.target.value); } }),
        el('output', { id: 'sb-' + key, text: value })
      )
    );
  }

  function updateSandboxOutput(key, value) {
    var out = document.getElementById('sb-' + key);
    if (out) out.textContent = value;
  }

  function applySandbox() {
    var list = sortedRows(rows()).slice(0, 10);
    var m = state.sandbox;
    var html = '<table class="sens-table"><thead><tr><th>Rank</th><th>Protocol</th><th>Current</th><th>Sandbox</th><th>Δ</th></tr></thead><tbody>';
    list.forEach(function(r) {
      var current = r.implied_value_usd;
      var impliedBase = m.base_coeff * Math.pow(r.tvl_usd, m.base_exponent);
      var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d || 0));
      var growthMult = 1 + (growth / 100) * m.growth_weight;
      var age = r.age_days === null || r.age_days === undefined ? m.unknown_age_days : r.age_days;
      var seasoning = m.seasoning_floor + (Math.min(Math.max(age, 0), m.seasoning_days) / m.seasoning_days) * (m.seasoning_cap - m.seasoning_floor);
      var family = r.family_factor || 1;
      var sibling = r.sibling_discount || 1;
      var sandbox = Math.max(1, Math.round(impliedBase * family * growthMult * seasoning * sibling * (r.launch_odds || 1)));
      var diff = sandbox - current;
      var diffClass = diff > 0 ? 'pos' : diff < 0 ? 'neg' : '';
      html += '<tr><td>' + r.rank + '</td><td>' + r.name + '</td><td>' + fmtUsd(current) + '</td><td>' + fmtUsd(sandbox) + '</td><td class="' + diffClass + '">' + (diff > 0 ? '+' : '') + fmtUsd(diff) + '</td></tr>';
    });
    html += '</tbody></table>';
    
    var modal = el('div', { style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-panel);padding:24px;max-width:600px;max-height:70vh;overflow:auto;z-index:100;box-shadow:var(--shadow-md);' },
      el('h3', { text: 'Sandbox Recomputation (Top 10)' }),
      el('div', { class: 'sens-wrap', html: html }),
      el('button', { class: 'button primary', style: 'margin-top:16px;', text: 'Close', onclick: function() { document.body.removeChild(modal); backdrop.remove(); } })
    );
    var backdrop = el('div', { style: 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(20,32,26,0.3);z-index:99;', onclick: function() { document.body.removeChild(modal); document.body.removeChild(backdrop); } });
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  // Detail Drawer
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var match = recomputed === row.implied_value_usd;
    
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    // Detail Tabs
    var tabs = ['model', 'farm', 'sensitivity', 'research', 'excluded'];
    var tabLabels = { model: 'Model', farm: 'Farm Plan', sensitivity: 'Sensitivity', research: 'Research Note', excluded: 'Set Aside' };
    dialog.appendChild(el('div', { class: 'detail-tabs' },
      tabs.map(function(t) {
        return el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': state.detailTab === t ? 'true' : 'false',
          text: tabLabels[t],
          onclick: function() { state.detailTab = t; openDetail(slug); }
        });
      })
    ));

    if (state.detailTab === 'model') {
      var launchOddsPct = fmtOdds(row.launch_odds);
      var valueIfLaunches = row.value_if_launches_usd || Math.round(row.implied_value_usd / (row.launch_odds || 1));
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied Value Breakdown' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Value if launches' }), el('b', { class: 'num', text: fmtUsd(valueIfLaunches) })),
          el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: launchOddsPct })),
          el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
          el('div', null, el('span', { text: 'Family factor (' + (row.category || 'Unknown') + ')' }), el('b', { class: 'num', text: String(row.family_factor || 1) })),
          el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier || 1) })),
          el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
          el('div', null, el('span', { text: 'Seasoning multiplier' }), el('b', { class: 'num', text: String(row.seasoning_multiplier || 1) })),
          el('div', null, el('span', { text: 'Sibling discount' }), el('b', { class: 'num', text: String(row.sibling_discount || 1) })),
          el('div', null, el('span', { text: 'Value range (P25–P75)' }), el('b', { class: 'num', text: fmtUsd(row.value_p25_usd) + ' – ' + fmtUsd(row.value_p75_usd) })),
          el('div', null, el('span', { text: 'Value range (P10–P90)' }), el('b', { class: 'num', text: fmtUsd(row.value_p10_usd) + ' – ' + fmtUsd(row.value_p90_usd) })),
          el('div', null, el('span', { text: 'Rank range (P25–P75)' }), el('b', { class: 'num', text: row.rank_p25 + ' – ' + row.rank_p75 })),
          el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num ' + (row.verdict === 'FARM' ? 'pos' : row.verdict === 'MARGINAL' ? 'thin' : 'neg'), text: row.verdict })),
          el('div', null, el('span', { text: 'Net $/hr (at P25)' }), el('b', { class: 'num', text: fmtUsd(row.net_usd_per_hr) + '/hr' }))
        ),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (match ? ', matching board.json ✓' : ', DIFFERS from board.json ⚠') + '. Implied = value_if_launches × launch_odds. This is an estimate, not a price.' })
      ));
    } else if (state.detailTab === 'farm') {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm Plan' }),
        el('ol', { class: 'steps' }, steps.map(function (s) {
          var at = s.indexOf(' Cost: ');
          var action = at >= 0 ? s.slice(0, at) : s;
          var tail = at >= 0 ? s.slice(at + 1) : '';
          return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
        }))
      ));
    } else if (state.detailTab === 'sensitivity') {
      dialog.appendChild(sensitivityPanel(row));
    } else if (state.detailTab === 'research') {
      dialog.appendChild(researchNotePanel());
    } else if (state.detailTab === 'excluded') {
      dialog.appendChild(excludedPanel());
    }

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Sensitivity Panel (per protocol) — deposit × airdrop share grid
  function sensitivityPanel(row) {
    var capitals = [1000, 10000, 100000];
    var shares = [0.05, 0.10, 0.20];
    var implied = row.implied_value_usd;
    var category = row.category || 'Unknown';
    
    var capital = capitalFor({ tvl_usd: row.tvl_usd });
    var weeklyGas = 2;
    var setupGas = capital >= 150 ? 8 : 4;
    var holdDays = holdDaysFor(row.age_days);
    var weeks = Math.ceil(holdDays / 7);
    var totalGas = setupGas + weeklyGas * weeks;
    var opportunityCost = implied * DATA.model.opportunity_apy * (holdDaysFor(row.age_days) / 365);
    
    var html = '<div class="sens-wrap"><table class="sens-table"><thead><tr><th>Capital</th><th>Airdrop Share</th><th>Implied Value</th><th>Value Used (P25)</th><th>Farmer Slice</th><th>Total Cost</th><th>Net</th><th>$/hr</th><th>Verdict</th></tr></thead><tbody>';
    capitals.forEach(function(cap) {
      shares.forEach(function(share) {
        var lowEndValue = implied * DATA.model.p25;
        var slice = lowEndValue * share * DATA.model.farming_tvl_share * (holdDaysFor(row.age_days) / DATA.model.season_days);
        var opportunityCost = implied * DATA.model.opportunity_apy * (holdDaysFor(row.age_days) / 365);
        var gasCost = DATA.model.gas_per_tx * DATA.model.txs_per_farm;
        var totalCost = gasCost + opportunityCost;
        var net = slice - totalCost;
        var hours = weeks * 0.5 + 0.5;
        var perHour = hours > 0 ? net / hours : 0;
        var verdict = net >= DATA.model.verdict_farm_threshold ? 'FARM' : net >= DATA.model.verdict_marginal_threshold ? 'MARGINAL' : 'SKIP';
        var verdictClass = verdict === 'FARM' ? 'pos' : verdict === 'MARGINAL' ? 'thin' : 'neg';
        html += '<tr><td>' + fmtUsd(cap) + '</td><td>' + (share*100) + '%</td><td>' + fmtUsd(implied) + '</td><td>' + fmtUsd(implied * DATA.model.p25) + '</td><td>' + fmtUsd(slice) + '</td><td>' + fmtUsd(totalCost) + '</td><td>' + fmtUsd(net) + '</td><td>' + fmtUsd(perHour) + '/hr</td><td class="' + verdictClass + '">' + verdict + '</td></tr>';
      });
    });
    html += '</tbody></table></div>';
    
    return el('section', { class: 'detail-section', html: html },
      el('h3', { text: 'Sensitivity Analysis (deposit × airdrop share)' }),
      el('p', { class: 'sub', text: 'Uses P25 value (conservative). Gas: $' + (capital >= 150 ? 8 : 4) + ' setup + $' + 2 + '/week × ' + Math.ceil(holdDaysFor(row.age_days)/7) + ' weeks. Opportunity cost: 8% APY. Hours: 30 min setup + 10 min/week. Break-even capture shown per row.' })
    );
  }

  // Research Note Panel
  function researchNotePanel() {
    var top3 = DATA.rows.slice(0, 3);
    var html = '<div class="research-note">';
    html += '<h4>Launch Odds Model (Hazard Curve)</h4>';
    html += '<p>launch_odds = clamp(mean(age_band_rate, category_rate), 5%, 90%). Rates shrunk toward global ' + (DATA.model.global_launch_rate * 100).toFixed(1) + '% with k=10 pseudocounts.</p>';
    
    html += '<h4>Age-Band Launch Rates (shrunk)</h4><ul>';
    DATA.age_band_rates.forEach(function(b) {
      html += '<li><b>' + b.band + ' days</b>: n=' + b.n + ', raw=' + (b.raw_rate*100).toFixed(1) + '%, shrunk=' + (b.shrunk_rate*100).toFixed(1) + '%</li>';
    });
    html += '</ul>';
    
    html += '<h4>Category Launch Rates (shrunk)</h4><ul>';
    Object.entries(DATA.category_launch_rates).filter(function(f) { return f[1].n >= 3; }).forEach(function(f) {
      html += '<li><b>' + f[0] + '</b>: n=' + f[1].n + ', raw=' + (f[1].raw_rate*100).toFixed(1) + '%, shrunk=' + (f[1].shrunk_rate*100).toFixed(1) + '%</li>';
    });
    html += '</ul>';
    
    html += '<h4>Value Ranges from Residual Quantiles</h4><ul>';
    html += '<li>P25–P75 (typical range): ' + DATA.model.p25.toFixed(2) + '× – ' + DATA.model.p75.toFixed(2) + '× (~' + DATA.model.p75/DATA.model.p25 + '× spread)</li>';
    html += '<li>P10–P90 (extreme range): ' + DATA.model.p10.toFixed(2) + '× – ' + DATA.model.p90.toFixed(2) + '× (~' + (DATA.model.p90/DATA.model.p10).toFixed(0) + '× spread)</li>';
    html += '</ul>';
    
    html += '<h4>Top 3 Calls</h4><ul>';
    top3.forEach(function(r) {
      html += '<li><b>' + r.name + '</b> (Rank ' + r.rank + '): ' + fmtUsd(r.implied_value_usd) + ' implied (' + fmtOdds(r.launch_odds) + ' odds) on ' + fmtUsd(r.tvl_usd) + ' TVL. Verdict: ' + r.verdict + ' (net $' + r.net_usd_per_hr + '/hr).</li>';
    });
    html += '</ul>';
    
    html += '<h4>Category Premiums/Discounts</h4><ul>';
    // Compute family factors from rows
    var catFactors = {};
    DATA.rows.forEach(function(r) {
      if (r.category && r.family_factor !== undefined) {
        if (!catFactors[r.category]) catFactors[r.category] = [];
        catFactors[r.category].push(r.family_factor);
      }
    });
    Object.entries(catFactors).forEach(function(f) {
      var avg = f[1].reduce(function(a, b) { return a + b; }, 0) / f[1].length;
      if (avg > 1.2) {
        html += '<li><b>' + f[0] + '</b>: ' + avg.toFixed(2) + '× premium</li>';
      }
    });
    Object.entries(catFactors).forEach(function(f) {
      var avg = f[1].reduce(function(a, b) { return a + b; }, 0) / f[1].length;
      if (avg < 0.8) {
        html += '<li><b>' + f[0] + '</b>: ' + avg.toFixed(2) + '× discount</li>';
      }
    });
    html += '</ul>';
    
    html += '<h4>Walk-Forward Validation</h4><ul>';
    DATA.validation.walk_forward.forEach(function(w) {
      html += '<li>' + w.cutoff + ': Curve RMSE ' + w.curve_rmse.toFixed(3) + ' vs Flat ' + w.flat_rmse.toFixed(3) + ' (n=' + w.n_test + ') — ' + (w.curve_rmse < w.flat_rmse ? 'Curve wins ✓' : 'Flat wins') + '</li>';
    });
    html += '</ul>';
    
    html += '<h4>Ablation (Tested & Rejected)</h4><ul>';
    DATA.validation.ablation.forEach(function(a) {
      html += '<li><b>' + a.name + '</b>: LOO ' + a.loo_rmse.toFixed(2) + ', Walk-Fwd ' + a.walk_forward_rmse.toFixed(2) + ' — ' + a.reason + '</li>';
    });
    html += '</ul>';
    
    html += '<h4>Residual Quantiles</h4><ul>';
    Object.entries(DATA.validation.residual_quantiles).forEach(function(q) {
      html += '<li>' + q[0] + ': ' + q[1].toFixed(2) + '×</li>';
    });
    html += '</ul>';
    
    html += '<h4>Honest Limits</h4><ul>';
    html += '<li>R² ≈ 0.19: TVL explains only ~19% of mcap variation. Value ranges span ~16× (P25-P75).</li>';
    html += '<li>No launch prediction: Odds from history, not announcements. Teams can choose never to launch.</li>';
    html += '<li>DefiLlama lag: Some "pre-token" protocols may have unrecorded tokens.</li>';
    html += '<li>Snapshot date: ' + DATA.as_of + ' (frozen). TVL, growth, ages frozen at this date.</li>';
    html += '<li>Survivorship bias: Only protocols ≥$5M TVL included. Dead protocols invisible.</li>';
    html += '<li>Category noise: DefiLlama categories imperfect; family factors shrink small samples to neutral.</li>';
    html += '</ul>';
    html += '</div>';
    
    return el('section', { class: 'detail-section', html: html },
      el('h3', { text: 'Research Note — radar-5 reads the board in plain words' })
    );
  }

  // Excluded / Set-Aside Panel
  function excludedPanel() {
    var html = '<div class="excluded-list">';
    var excludedRules = [
      { slug: 'binance-cex', reason: 'Category is CEX (exchanges excluded)', badge: 'CEX' },
      { slug: 'layerzero-v2', reason: 'Category is Bridge (bridges excluded)', badge: 'Bridge' },
      { slug: 'aave-v3', reason: 'Already has token (AAVE trades)', badge: 'Live Token' },
      { slug: 'wbtc', reason: 'Wrapped product of BTC (already trades)', badge: 'Wrapped' },
      { slug: 'binance-staked-eth', reason: 'Staked product of ETH (already trades)', badge: 'Staked' },
      { slug: 'coinbase-bridge', reason: 'Category is Bridge', badge: 'Bridge' },
      { slug: 'hyperliquid-bridge', reason: 'Category is Bridge', badge: 'Bridge' },
      { slug: 'ethena-usde', reason: 'Category is Basis Trading — has token', badge: 'Live Token' },
      { slug: 'binance-bitcoin', reason: 'Category is Bridge', badge: 'Bridge' },
      { slug: 'aave-v2', reason: 'Already has token (versioned pool)', badge: 'Versioned' },
      { slug: 'mantle-bridge', reason: 'Category is Bridge', badge: 'Bridge' },
      { slug: 'starknet-bridge', reason: 'Category is Bridge', badge: 'Bridge' },
    ];
    excludedRules.forEach(function(ex) {
      html += '<div class="excluded-item"><span class="slug">' + ex.slug + '</span><span class="reason">' + ex.reason + '</span><span class="badge">' + ex.badge + '</span></div>';
    });
    html += '</div>';
    
    return el('section', { class: 'detail-section', html: html },
      el('h3', { text: 'Set Aside — Excluded Protocols' }),
      el('p', { class: 'sub', text: 'Protocols excluded from the pre-token ranking per the watchlist rules: CEX, Bridge/Canonical Bridge, Liquid Staking/Restaking, versioned pools (V2, v2, 2.0), wrapped/staked/bridged products of traded tokens, and names starting with exchange names (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).' })
    );
  }

  // CSV Export
  function exportCSV() {
    var list = state.tab === 'pre-token' ? sortedRows(rows()) : DATA.live;
    var headers = state.tab === 'pre-token' 
      ? ['Rank', 'Protocol', 'Category', 'Chains', 'TVL', '7d%', 'Age', 'Implied Value', 'Value if Launches', 'Launch %', 'P25', 'P75', 'P10', 'P90', 'Rank P25', 'Rank P75', 'Verdict', 'Net $/hr', 'Family Factor', 'Growth Mult', 'Seasoning Mult', 'Launch Odds']
      : ['Status', 'Protocol', 'Category', 'Chains', 'TVL', '7d%', 'Market Cap'];
    var rows = list.map(function(r) {
      if (state.tab === 'pre-token') {
        return [r.rank, r.name, r.category || 'Other', (r.chains || []).join(';'), r.tvl_usd, r.change_7d || '', r.age_days || '', r.implied_value_usd, r.value_if_launches_usd || '', (r.launch_odds * 100).toFixed(1) + '%', r.value_p25_usd, r.value_p75_usd, r.value_p10_usd, r.value_p90_usd, r.rank_p25, r.rank_p75, r.verdict, r.net_usd_per_hr, r.family_factor || 1, r.growth_multiplier || 1, r.seasoning_multiplier || 1, (r.launch_odds * 100).toFixed(1) + '%'].join(',');
      } else {
        return ['live', r.name, r.category || 'Other', (r.chains || []).join(';'), r.tvl_usd, r.change_7d || '', r.mcap_usd || ''].join(',');
      }
    });
    var csv = [headers.join(','), ...rows].join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-radar-' + DATA.as_of + '-' + state.tab + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Verification Badge
  function verificationBadge() {
    var list = rows();
    var checks = {
      coverage: DATA.watchlist.every(function(s) { return list.some(function(r) { return r.slug === s; }); }),
      ranks: list.every(function(r, i) { return r.rank === i + 1; }),
      order: list.every(function(r, i) { return i === 0 || r.implied_value_usd <= list[i-1].implied_value_usd; }),
      farmSteps: list.every(function(r) { return r.farm_steps && r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every(function(s) { return s.length >= 20 && s.length <= 600; }); }),
      recompute: list.every(function(r) { return impliedOf(r, DATA.model) === r.implied_value_usd; }),
    };
    var allPass = Object.values(checks).every(function(v) { return v; });
    var passed = Object.values(checks).filter(function(v) { return v; }).length;
    var total = Object.keys(checks).length;
    
    return el('div', { class: 'verify-badge' + (allPass ? '' : ' fail') },
      el('span', { class: 'icon', html: allPass ? '✓' : '✗' }),
      el('span', { text: allPass ? 'Self-verification: ' + passed + '/' + total + ' checks pass' : 'Self-verification: ' + passed + '/' + total + ' checks pass — see detail' })
    );
  }

  // Main Render
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
      shell.appendChild(el('div', { style: 'display:flex;justify-content:flex-end;margin-top:16px' },
        el('button', { class: 'button', type: 'button', text: 'Export CSV', onclick: exportCSV })
      ));
      shell.appendChild(el('div', { style: 'margin-top:16px' }, verificationBadge()));
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'validation') {
      shell.appendChild(validationPanel());
    } else if (state.tab === 'limitations') {
      shell.appendChild(limitationsPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();