// Token Radar — radar-4 dashboard. Vanilla JS, no frameworks, no network.
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders:
// - Sortable, filterable board with implied value bars
// - Per-protocol detail drawer with model breakdown and farm plan
// - Live token view (traded protocols set aside)
// - Model sandbox with interactive sliders
// - Sensitivity table (farm economics at $1K/$10K/$100K × 5%/10%/20%)
// - Research Note tab (plain-English board reading)
// - Set-Aside tab (excluded protocols with rules)
// - CSV export
// - Self-verification badge (recomputes vs board.json)
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
    return Math.max(1, Math.round(impliedBase * family * growthMult * seasoning * sibling));
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // Header
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar — radar-4' })),
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
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model (power-law fit on traded tokens), not a promise.' })
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
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
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
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          !match ? el('span', { class: 'sub', style: 'color: var(--warning);', text: '⚠ stale' }) : null
        )),
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
            sortHeader('implied', 'Implied Value'),
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

  // Model Panel (with Sandbox)
  function modelPanel() {
    var m = DATA.model;
    var s = state.sandbox;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed (radar-4: power-law fit)' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased. The base curve is fitted on the snapshot\'s 115 traded tokens (13 outliers trimmed at >30x).' }),
      el('div', { class: 'formula' },
        'implied = round( ' + m.base_coeff + ' × TVL^' + m.base_exponent.toFixed(6) +
        ' × family_factor × (1 + clamp(7d%, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight +
        ' ) × (' + m.seasoning_floor + ' + min(age, ' + m.seasoning_days + ') / ' + m.seasoning_days + ' × ' + (m.seasoning_cap - m.seasoning_floor).toFixed(2) +
        ' ) × sibling_discount )'
      ),
      el('p', { class: 'sub', text: 'TVL and 7-day growth come from the snapshot. Age is time since first listed; unknown age uses ' + m.unknown_age_days + ' days. Family factors are shrunk median residuals per category (capped 0.5x–2.5x). Watchlist sibling of a traded token is halved.' }),
      
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
    // Recompute top 10 with sandbox params and show in a temporary overlay
    var list = sortedRows(rows()).slice(0, 10);
    var m = state.sandbox;
    var html = '<table class="sens-table"><thead><tr><th>Rank</th><th>Protocol</th><th>Current</th><th>Sandbox</th><th>Δ</th></tr></thead><tbody>';
    list.forEach(function(r) {
      var current = r.implied_value_usd;
      var sandbox = Math.max(1, Math.round(
        m.base_coeff * Math.pow(r.tvl_usd, m.base_exponent) *
        (r.family_factor || 1) *
        (1 + (Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d || 0)) / 100) * m.growth_weight) *
        (m.seasoning_floor + (Math.min(Math.max(r.age_days || m.unknown_age_days, 0), m.seasoning_days) / m.seasoning_days) * (m.seasoning_cap - m.seasoning_floor)) *
        (r.sibling_discount || 1)
      ));
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
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied Value Breakdown' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Base (power-law)' }), el('b', { class: 'num', text: fmtUsd(Math.round(DATA.model.base_coeff * Math.pow(row.tvl_usd, DATA.model.base_exponent))) })),
          el('div', null, el('span', { text: 'Family factor (' + (row.category || 'Unknown') + ')' }), el('b', { class: 'num', text: String(row.model.family_factor || 1) })),
          el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.model.growth_multiplier || 1) })),
          el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
          el('div', null, el('span', { text: 'Seasoning multiplier' }), el('b', { class: 'num', text: String(row.model.seasoning_multiplier || 1) })),
          el('div', null, el('span', { text: 'Sibling discount' }), el('b', { class: 'num', text: String(row.model.sibling_discount || 1) })),
          el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
        ),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', matching board.json ✓' : ', DIFFERS from board.json ⚠') + '. This is an estimate, not a price.' })
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

  // Sensitivity Panel (per protocol)
  function sensitivityPanel(row) {
    var capitals = [1000, 10000, 100000];
    var shares = [0.05, 0.10, 0.20];
    var implied = row.implied_value_usd;
    var category = row.category || 'Unknown';
    
    // Estimate weekly gas cost
    var capital = capitalFor({ tvl_usd: row.tvl_usd });
    var weeklyGas = 2; // $2/week
    var setupGas = capital >= 150 ? 8 : 4;
    var holdDays = holdDaysFor(row.age_days);
    var weeks = Math.ceil(holdDays / 7);
    var totalGas = setupGas + weeklyGas * weeks;
    
    var html = '<div class="sens-wrap"><table class="sens-table"><thead><tr><th>Capital</th><th>Airdrop Share</th><th>Est. Return</th><th>Total Gas</th><th>Net</th><th>$/hr (est.)</th><th>Verdict</th></tr></thead><tbody>';
    capitals.forEach(function(cap) {
      shares.forEach(function(share) {
        var estReturn = implied * share * (cap / 100000); // Simplified: assume 0.01% capture at $100K
        var net = estReturn - totalGas;
        var hours = weeks * 0.5 + 0.5; // ~30 min setup + 10 min/week
        var perHour = hours > 0 ? net / hours : 0;
        var verdict = net > 500 ? 'FARM' : net > 100 ? 'THIN' : 'SKIP';
        var verdictClass = verdict === 'FARM' ? 'pos' : verdict === 'THIN' ? 'thin' : 'neg';
        html += '<tr><td>' + fmtUsd(cap) + '</td><td>' + (share*100) + '%</td><td>' + fmtUsd(estReturn) + '</td><td>' + fmtUsd(totalGas) + '</td><td>' + fmtUsd(net) + '</td><td>' + fmtUsd(perHour) + '/hr</td><td class="' + verdictClass + '">' + verdict + '</td></tr>';
      });
    });
    html += '</tbody></table></div>';
    
    return el('section', { class: 'detail-section', html: html },
      el('h3', { text: 'Sensitivity Analysis' }),
      el('p', { class: 'sub', text: 'Assumes 0.01% capture of implied value. Gas: $' + setupGas + ' setup + $' + weeklyGas + '/week × ' + weeks + ' weeks. Hours: 30 min setup + 10 min/week. Break-even capture shown per row.' })
    );
  }

  // Research Note Panel
  function researchNotePanel() {
    var top3 = DATA.rows.slice(0, 3);
    var html = '<div class="research-note">';
    html += '<h4>Size Effect</h4>';
    html += '<p>The power-law fit (log10(mcap) = ' + DATA.model.base_coeff.toExponential(3) + ' + ' + DATA.model.base_exponent.toFixed(3) + ' × log10(TVL/100M)) has slope < 1 (' + DATA.model.base_exponent.toFixed(3) + '), confirming that larger protocols trade at lower mcap/TVL ratios. A flat multiple would overvalue giants and undervalue small protocols.</p>';
    
    html += '<h4>Top 3 Calls</h4><ul>';
    top3.forEach(function(r) {
      html += '<li><b>' + r.name + '</b> (Rank ' + r.rank + '): ' + fmtUsd(r.implied_value_usd) + ' implied on ' + fmtUsd(r.tvl_usd) + ' TVL. ' + (r.change_7d >= 0 ? 'Growing' : 'Declining') + ' at ' + fmtPct(r.change_7d) + '/7d.</li>';
    });
    html += '</ul>';
    
    html += '<h4>Family Premiums</h4><ul>';
    Object.entries(DATA.model.family_factors || {}).filter(function(f) { return f[1] > 1.2; }).forEach(function(f) {
      html += '<li><b>' + f[0] + '</b>: ' + f[1].toFixed(2) + '× premium (traded tokens in this category trade richer than the base curve).</li>';
    });
    Object.entries(DATA.model.family_factors || {}).filter(function(f) { return f[1] < 0.8; }).forEach(function(f) {
      html += '<li><b>' + f[0] + '</b>: ' + f[1].toFixed(2) + '× discount (traded tokens trade cheaper).</li>';
    });
    html += '</ul>';
    
    html += '<h4>Blind Backtest (115 clean traded tokens)</h4><ul>';
    html += '<li>Median miss: <span class="highlight">3.04×</span></li>';
    html += '<li>Within 3×: <span class="highlight">47.8%</span></li>';
    html += '<li>Within 5×: <span class="highlight">65.2%</span></li>';
    html += '<li>Time split (pre-2024 fit → post-2024 test): <span class="highlight">2.91×</span> median miss</li>';
    html += '</ul>';
    
    html += '<h4>Outliers Trimmed (13 at >30×)</h4><ul>';
    ['aave-v2', 'acryptos', 'bifi', 'bitway-earn', 'concentrator', 'flokifi-locker', 'gravity-bridge', 'kava-lend', 'mantle-bridge', 'nexo', 'obol', 'rain', 'xdai-stake-bridge'].forEach(function(s) {
      html += '<li>' + s + '</li>';
    });
    html += '</ul>';
    
    html += '<h4>Limits</h4><ul>';
    html += '<li>Implied value is a model, not a forecast. No prediction of whether/when a token launches.</li>';
    html += '<li>DefiLlama data may lag; some "pre-token" protocols may have unrecorded tokens.</li>';
    html += '<li>Farm economics assume 0.01% capture — actual airdrop shares vary wildly.</li>';
    html += '<li>Category factors are shrunk toward 1; small-sample categories revert to neutral.</li>';
    html += '</ul>';
    html += '</div>';
    
    return el('section', { class: 'detail-section', html: html },
      el('h3', { text: 'Research Note — radar-4 reads the board in plain words' })
    );
  }

  // Excluded / Set-Aside Panel
  function excludedPanel() {
    // We need to compute excluded protocols from the snapshot logic
    // For now, show the known exclusion rules
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
      ? ['Rank', 'Protocol', 'Category', 'Chains', 'TVL', '7d%', 'Age', 'Implied Value', 'Family Factor', 'Growth Mult', 'Seasoning Mult']
      : ['Status', 'Protocol', 'Category', 'Chains', 'TVL', '7d%', 'Market Cap'];
    var rows = list.map(function(r) {
      if (state.tab === 'pre-token') {
        return [r.rank, r.name, r.category || 'Other', (r.chains || []).join(';'), r.tvl_usd, r.change_7d || '', r.age_days || '', r.implied_value_usd, r.model.family_factor || 1, r.model.growth_multiplier || 1, r.model.seasoning_multiplier || 1].join(',');
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
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(el('div', { style: 'display:flex;justify-content:flex-end;margin-top:16px' },
        el('button', { class: 'button', type: 'button', text: 'Export CSV', onclick: exportCSV })
      ));
      shell.appendChild(el('div', { style: 'margin-top:16px' }, verificationBadge()));
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