// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts from the same
// board board.json carries) and renders the ranked board, a sortable and filterable table, a live-
// token view set apart from the ranking, and a per-protocol detail drawer with the model's inputs,
// its arithmetic and the protocol's farm plan — the very strings board.json holds. No network:
// every byte it shows arrived in data.js.
//
// The page is one render function driven by a small state object (search text, category, tab,
// sort key/direction, selected slug). Every control mutates state and re-renders; the URL hash
// mirrors the state so a view can be linked and the detail drawer survives a reload.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // Number formatting: compact dollars for the table ($1.23B / $45.6M / $789K), signed percents,
  // ages as days or years, multiples as x0.214. Nulls render as 'n/a' or 'unknown', never NaN.
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
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
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }

  // The model in one function, the same arithmetic lib/model.ts runs: the page recomputes a row
  // from the snapshot figures and its peer multiple, and the detail view checks the answer against
  // the number board.json carries, so page and board are visibly one computation.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * growthMult * maturity));
  }

  // Where a row's peer multiple came from: its category's traded peers, or the global set.
  var catMult = {};
  DATA.category_multiples.forEach(function (c) { catMult[c.category] = c; });
  function multipleSource(row) {
    var own = row.category ? catMult[row.category] : null;
    if (own) return row.category + ' peer median, ' + own.peers + ' traded peers';
    return 'global peer median (category has fewer than ' + DATA.model.category_min_peers + ' traded peers)';
  }

  // A tiny element builder: el('div', { class: 'x', text: 'y', onclick: fn }, child, 'text', [...]).
  // Attribute keys starting with 'on' become listeners, 'text' becomes textContent, anything else
  // becomes a real attribute (null values are skipped). Children may be nodes, strings or arrays.
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  // The hash is the shareable form of the view state: q (search), category, p (open protocol).
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The board rows after the search/category filter (before sorting).
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // Sort by the active key; missing growth sorts last, missing age sorts as oldest, and slug is the
  // stable tie-break so the order never depends on the engine's sort implementation.
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.base_multiple; bv = b.base_multiple; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Launch ', el('b', { text: 'Radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('span', { class: 'num', text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index, sealed' }),
        el('span', null, 'Model ', el('span', { class: 'num', text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by what a launch could be worth' }),
        el('p', null,
          'Every protocol on the snapshot\u2019s watchlist is here, plus the early radar\u2019s finds below its $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. ',
          el('b', { text: 'Implied value is a model, not a promise: ' }),
          'TVL times the market-cap multiple the snapshot\u2019s own traded protocols carry, adjusted for seven-day growth and for how long the protocol has run with no token.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global peer multiple' }), el('b', { text: fmtMult(DATA.global_multiple) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The model, stated on the page itself: the formula with the live constants filled in, the
  // plain-language explanation, and a chip per category multiple so the inputs are inspectable.
  function modelPanel() {
    var m = DATA.model;
    var chips = [el('span', { class: 'mult-chip global' }, 'All traded protocols ', el('b', { text: fmtMult(DATA.global_multiple) }))];
    DATA.category_multiples.slice(0, 14).forEach(function (c) {
      chips.push(el('span', { class: 'mult-chip' }, c.category + ' ', el('b', { text: fmtMult(c.multiple) }), ' · ' + c.peers + ' peers'));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('div', { class: 'formula' },
        el('span', { class: 'k', text: 'implied' }),
        ' = round( tvl_usd x peer_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The peer multiple is the median market-cap / TVL of the snapshot\u2019s token-bearing protocols in the same category, derived from the snapshot at run time; a category with fewer than ' + m.category_min_peers + ' traded peers uses the global median, and every multiple is clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. Age is the days since DefiLlama first listed the protocol — how long it has run with no token; an unknown age counts as ' + m.unknown_age_days + ' days. No protocol name is special-cased: one function scores every row, and each row\u2019s detail view shows its own inputs.' }),
      el('div', { class: 'mult-grid' }, chips)
    );
  }

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
      el('div', { class: 'field' }, el('span', { class: 'sub-label', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  // A clickable column header: clicking the active key flips direction, a new key starts in its
  // natural direction (names ascending, everything else descending).
  function sortHeader(key, label, numeric) {
    return el('th', { scope: 'col', class: numeric ? 'num-head' : '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
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
        el('td', null, r.on_watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : el('span', { class: 'sub', text: 'early' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.base_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank', true),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Radar' }),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('multiple', 'Peer x', true),
            sortHeader('implied', 'Implied value', true),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // The live-token view: protocols that already trade, shown at the market's own market cap and
  // deliberately kept out of the ranking — they are the peer evidence, not the ranked.
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
          el('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap / TVL ratios are the peer evidence the model is built from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num-head', text: 'TVL' }), el('th', { scope: 'col', class: 'num-head', text: '7d' }), el('th', { scope: 'col', class: 'num-head', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The detail drawer is one persistent <dialog>, refilled per protocol. Closing it clears the
  // selection (and the hash) and re-renders so the table's selected-row highlight drops.
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank-line', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'On the snapshot' }),
      el('div', { class: 'figures' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7d TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'First listed' }), el('b', { text: row.listed_at || 'not recorded' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Token on record' }), el('b', { text: 'none' })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { text: String(row.chains ? row.chains.length : 0) }))
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { text: fmtMult(row.base_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: 'x' + Number(row.growth_multiplier).toFixed(3) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: 'x' + Number(row.maturity_multiplier).toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub check-line', text: 'Peer multiple: ' + multipleSource(row) + '. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' An estimate of what a launch could be worth if the record held, not a price and not a prediction that a token comes.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // One render pass rebuilds the whole shell from state; the dialog is re-attached if a previous
  // pass dropped it, and a selected slug (from the hash or a click) reopens its drawer.
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source }),
      el('span', { text: 'Implied values are this board\u2019s model claims, never make.fun\u2019s.' })
    ));
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


// ---------------------------------------------------------------------------
// Overview panel: an add-on drawn entirely from the data script's two globals.
// window.RADAR_DIGEST describes the whole snapshot; window.RADAR's rows give
// the board's own aggregates. The panel is optional by design — a data script
// without a digest (an older build) leaves the page exactly as it was.
(() => {
  'use strict';

  const digest = window.RADAR_DIGEST;
  const radar = window.RADAR;
  if (!digest || !radar || !Array.isArray(radar.rows)) return;

  // --- Formatting: compact money, shares as percents, signed 7-day moves. ---
  const money = (v) => {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${Math.round(v)}`;
  };
  const percent = (share) => `${(share * 100).toFixed(1)}%`;
  const signed = (v) => (v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

  // --- Board aggregates, computed here from the rows the page already has. ---
  const implied = radar.rows.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const totalImplied = implied.reduce((sum, v) => sum + v, 0);
  const mid = Math.floor(implied.length / 2);
  const medianImplied = implied.length === 0 ? 0 : implied.length % 2 === 1 ? implied[mid] : (implied[mid - 1] + implied[mid]) / 2;
  const watchlistRows = radar.rows.filter((r) => r.on_watchlist).length;

  // --- Small DOM helpers, so every figure lands as text, never as markup. ---
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const stat = (label, value, note) => {
    const box = el('div', 'ov-stat');
    box.append(el('span', 'ov-stat-label', label), el('span', 'ov-stat-value', value));
    if (note) box.append(el('span', 'ov-stat-note', note));
    return box;
  };
  const rankedList = (title, items) => {
    const wrap = el('div', 'ov-list');
    wrap.append(el('h3', 'ov-list-title', title));
    const list = el('ol', 'ov-list-items');
    for (const [name, detail] of items) {
      const item = el('li', 'ov-list-item');
      item.append(el('span', 'ov-list-name', name), el('span', 'ov-list-detail', detail));
      list.append(item);
    }
    wrap.append(list);
    return wrap;
  };

  // The plain-text twin of the panel: what the copy button puts on the clipboard.
  const summaryText = () =>
    [
      `Token Launch Radar — snapshot overview (${radar.as_of})`,
      `Protocols: ${digest.protocol_count} · pre-token: ${digest.pre_token_count} (${percent(digest.pre_token_share)}) · no token recorded: ${digest.tokenless_count}`,
      `TVL: ${money(digest.total_tvl_usd)} total · median ${money(digest.median_tvl_usd)} · top 10 hold ${percent(digest.top10_tvl_share)}`,
      `Median 7d change: ${signed(digest.median_change_7d)} across ${digest.change_7d_reported} reporting protocols`,
      `Top categories: ${digest.top_categories.map((c) => `${c.category} (${c.protocols}, ${money(c.tvl_usd)})`).join(' · ')}`,
      `Top chains: ${digest.top_chains.map((c) => `${c.chain} (${c.protocols})`).join(' · ')}`,
      `Board: ${radar.rows.length} rows · ${watchlistRows} watchlist · implied total ${money(totalImplied)} · median ${money(medianImplied)}`,
    ].join('\n');

  const render = () => {
    const panel = el('section', 'ov-panel');
    panel.setAttribute('aria-label', 'Snapshot overview');

    const head = el('div', 'ov-head');
    head.append(el('h2', 'ov-title', 'Snapshot overview'));
    const copy = el('button', 'ov-copy', 'Copy summary');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      // Clipboard API first; a throwaway textarea covers the contexts without it.
      try {
        await navigator.clipboard.writeText(summaryText());
      } catch {
        const area = document.createElement('textarea');
        area.value = summaryText();
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy summary'; }, 1600);
    });
    head.append(copy);
    panel.append(head);

    panel.append(el('p', 'ov-lede',
      `The board scores ${radar.rows.length} of the ${digest.protocol_count} protocols in the sealed snapshot. ` +
      `This panel describes the whole set the radar was drawn from, straight from the snapshot itself.`));

    const grid = el('div', 'ov-grid');
    grid.append(
      stat('Pre-token share', percent(digest.pre_token_share), `${digest.pre_token_count} of ${digest.protocol_count} protocols`),
      stat('No token recorded', String(digest.tokenless_count), 'gecko id and symbol both absent'),
      stat('Total TVL', money(digest.total_tvl_usd), `median protocol ${money(digest.median_tvl_usd)}`),
      stat('Top-10 TVL concentration', percent(digest.top10_tvl_share), 'share held by the ten largest'),
      stat('Median 7d change', signed(digest.median_change_7d), `${digest.change_7d_reported} protocols report one`),
      stat('Board implied value', money(totalImplied), `median row ${money(medianImplied)} · ${watchlistRows} watchlist rows`),
    );
    panel.append(grid);

    const lists = el('div', 'ov-lists');
    lists.append(
      rankedList('Largest categories', digest.top_categories.map((c) => [c.category, `${c.protocols} protocols · ${money(c.tvl_usd)} TVL`])),
      rankedList('Most common chains', digest.top_chains.map((c) => [c.chain, `${c.protocols} protocols`])),
    );
    panel.append(lists);

    // After the board in the page flow: the end of the board's own container,
    // or the end of the body when the board cannot be found.
    const board = document.getElementById('board');
    (board && board.parentElement ? board.parentElement : document.body).append(panel);
  };

  // Scripts at the end of the body can run before the DOM settles; wait if needed.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
