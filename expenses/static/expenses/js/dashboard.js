(function () {
  'use strict';

  
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var fmtFull = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var fmtCompact = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1
  });
  var fmtInt = new Intl.NumberFormat('en-IN');

  function money(n) { return fmtFull.format(n || 0); }
  function moneyShort(n) {
    var v = n || 0;
    return v >= 100000 ? fmtCompact.format(v) : fmtFull.format(v);
  }
  function count(n) { return fmtInt.format(n || 0); }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.max(0, Math.min(100, (part / whole) * 100));
  }

  
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '#6366f1').replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var num = parseInt(h, 16);
    if (isNaN(num)) { return 'rgba(99,102,241,' + alpha + ')'; }
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
  }

  function titleCase(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[_\s]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0); }).join('').toUpperCase() || '?';
  }

  
  function hashColor(text) {
    var h = 0;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) % 360; }
    return 'hsl(' + h + ', 62%, 52%)';
  }

  function parseJson(id, fallback) {
    var node = document.getElementById(id);
    if (!node) return fallback;
    try {
      var parsed = JSON.parse(node.textContent || '[]');
      return parsed == null ? fallback : parsed;
    } catch (err) {
      if (window.console) console.warn('[dashboard] could not parse #' + id, err);
      return fallback;
    }
  }


  function parseDate(value) {
    if (!value) return null;
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /* ---------------------------------------------------------------------
     Data + lookup tables
     --------------------------------------------------------------------- */
  var META = parseJson('txMeta', { categories: [], paymentMethods: [], sources: [] });

  var categoryMap = {};
  (META.categories || []).forEach(function (c) { categoryMap[c.value] = c; });

  var methodMap = {};
  (META.paymentMethods || []).forEach(function (m) { methodMap[m.value] = m; });

  var sourceMap = {};
  (META.sources || []).forEach(function (s) { sourceMap[s.value] = s; });

  function categoryLabel(value) {
    return categoryMap[value] ? categoryMap[value].label : titleCase(value);
  }
  function categoryColor(value) {
    return categoryMap[value] ? categoryMap[value].color : '#94a3b8';
  }
  function methodLabel(value) {
    return methodMap[value] ? methodMap[value].label : titleCase(value);
  }
  function methodColor(value) {
    return methodMap[value] ? methodMap[value].color : '#94a3b8';
  }
  function sourceLabel(value) {
    return sourceMap[value] ? sourceMap[value].label : titleCase(value);
  }

  
  var csrfInput = $('#csrfToken input[name="csrfmiddlewaretoken"]');
  var csrfToken = csrfInput ? csrfInput.value : '';

  
  var ALL = (function () {
    var raw = parseJson('txData', []);
    if (!Array.isArray(raw)) return [];
    return raw.map(function (row, index) {
      var amount = parseFloat(row.amount);
      return {
        id: row.id != null ? row.id : index,
        date: parseDate(row.date),
        merchant: String(row.merchant || 'Unknown'),
        amount: isNaN(amount) ? 0 : amount,
        payment_method: row.payment_method || '',
        category: row.category || '',
        description: row.description || '',
        source: row.source || '',
        edit_url: row.edit_url || '',
        delete_url: row.delete_url || '',
        _haystack: [row.merchant, row.category, row.description, row.payment_method, row.source]
          .join(' ').toLowerCase()
      };
    }).filter(function (t) { return t.date instanceof Date && !isNaN(t.date.getTime()); });
  })();

  /* ---------------------------------------------------------------------
     State + filtering
     --------------------------------------------------------------------- */
  var state = {
    range: 'all',
    query: '',
    category: '',
    method: '',
    source: '',
    sortKey: 'date',
    sortDir: 'desc',
    page: 1,
    perPage: 8
  };

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  
  function rangeStart(range) {
    var today = startOfToday();
    if (range === 'month') return new Date(today.getFullYear(), today.getMonth(), 1);
    if (range === 'year') return new Date(today.getFullYear(), 0, 1);
    if (range === '90d') {
      var d = new Date(today.getTime());
      d.setDate(d.getDate() - 90);
      return d;
    }
    return null;
  }

  var RANGE_LABELS = {
    all: 'all time',
    month: 'this month',
    '90d': 'the last 90 days',
    year: 'this year'
  };

  function inRange(t, from) {
    return !from || t.date.getTime() >= from.getTime();
  }

 
  function ranged() {
    var from = rangeStart(state.range);
    return ALL.filter(function (t) { return inRange(t, from); });
  }

  function filtered() {
    var from = rangeStart(state.range);
    var q = state.query.trim().toLowerCase();
    return ALL.filter(function (t) {
      if (!inRange(t, from)) return false;
      if (state.category && t.category !== state.category) return false;
      if (state.method && t.payment_method !== state.method) return false;
      if (state.source && t.source !== state.source) return false;
      if (q && !(t._haystack || '').includes(q)) return false;
      return true;
    });
  }

  /* ---------------------------------------------------------------------
     Aggregation
     --------------------------------------------------------------------- */

  /** Roll a list of records up into every figure the UI needs. */
  function aggregate(list) {
    var total = 0;
    var max = null;
    var byCategory = {};
    var byMethod = {};
    var byMerchant = {};
    var byMonth = {};
    var byDay = {};

    list.forEach(function (t) {
      total += t.amount;
      if (!max || t.amount > max.amount) max = t;

      var c = byCategory[t.category] || (byCategory[t.category] = { key: t.category, total: 0, count: 0 });
      c.total += t.amount; c.count += 1;

      var m = byMethod[t.payment_method] || (byMethod[t.payment_method] = { key: t.payment_method, total: 0, count: 0 });
      m.total += t.amount; m.count += 1;

      var mkey = t.merchant.toLowerCase();
      var mer = byMerchant[mkey] || (byMerchant[mkey] = { key: mkey, name: t.merchant, total: 0, count: 0 });
      mer.total += t.amount; mer.count += 1;

      var mkeyMonth = t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0');
      byMonth[mkeyMonth] = (byMonth[mkeyMonth] || 0) + t.amount;

      byDay[t.date.getDay()] = (byDay[t.date.getDay()] || 0) + t.amount;
    });

    function sortedDesc(obj) {
      return Object.keys(obj)
        .map(function (k) { return obj[k]; })
        .sort(function (a, b) { return b.total - a.total; });
    }

    var cats = sortedDesc(byCategory);
    var months = Object.keys(byMonth).sort();

    return {
      count: list.length,
      total: total,
      avg: list.length ? total / list.length : 0,
      max: max,
      categories: cats,
      methods: sortedDesc(byMethod),
      merchants: sortedDesc(byMerchant),
      months: months,
      monthTotals: byMonth,
      dayTotals: byDay,
      topCategory: cats[0] || null
    };
  }

  /** Sort a copy of the given list according to state.sortKey / sortDir. */
  function sortList(list) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (key === 'date') { av = a.date.getTime(); bv = b.date.getTime(); }
      if (key === 'amount') { av = a.amount; bv = b.amount; }
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      }
      return (av - bv) * dir;
    });
  }

  /* ---------------------------------------------------------------------
     KPI cards
     --------------------------------------------------------------------- */
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderKpis(list, stats) {
    var today = startOfToday();
    var thisMonthCount = list.filter(function (t) {
      return t.date.getFullYear() === today.getFullYear() && t.date.getMonth() === today.getMonth();
    }).length;

    var lastMonthTotal = 0;
    var prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    var prevMonthKey = prevMonth.getFullYear() + '-' + String(prevMonth.getMonth() + 1).padStart(2, '0');
    if (stats.monthTotals[prevMonthKey]) lastMonthTotal = stats.monthTotals[prevMonthKey];

    var deltaText = '';
    var deltaClass = 'delta delta--flat';

    if (state.range === 'month') {
        var diff = ((stats.total - lastMonthTotal) / lastMonthTotal) * 100;
        var up = diff > 0.5;
        var down = diff < -0.5;
        deltaClass = up ? 'delta delta--up' : down ? 'delta delta--down' : 'delta delta--flat';
        deltaText = '<span class="' + deltaClass + '">' +
          (up ? '▲' : down ? '▼' : '■') + ' ' + Math.abs(diff).toFixed(1) + '% vs last month</span>';
      }
    }

    setText('kpiTotal', stats.total ? moneyShort(stats.total) : '₹0');
    setHtml('kpiTotalHint', deltaText ||
      esc(stats.count + (stats.count === 1 ? ' transaction' : ' transactions') + ' in ' + RANGE_LABELS[state.range]));

    setText('kpiCount', count(stats.count));
    setHtml('kpiCountHint', esc(thisMonthCount + ' so far this month'));

    setText('kpiAvg', stats.avg ? moneyShort(stats.avg) : '₹0');
    setHtml('kpiAvgHint', stats.max
      ? esc('Largest single expense ' + moneyShort(stats.max.amount))
      : esc('No transactions in this period'));

    if (stats.topCategory) {
      setText('kpiTopCategory', categoryLabel(stats.topCategory.key));
      setHtml('kpiTopCategoryHint', esc(
        money(stats.topCategory.total) + ' · ' +
        pct(stats.topCategory.total, stats.total).toFixed(1) + '% of spend'));
    } else {
      setText('kpiTopCategory', '—');
      setText('kpiTopCategoryHint', 'Nothing recorded yet');
    }

    $$('#kpiGrid .kpi').forEach(function (card) { card.classList.remove('is-booting'); });
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setHtml(id, html) {
    var node = document.getElementById(id);
    if (node) node.innerHTML = html;
  }

  /* ---------------------------------------------------------------------
      Donut chart (category split)
     --------------------------------------------------------------------- */
  var DONUT_R = 44;
  var DONUT_C = 2 * Math.PI * DONUT_R;

  function renderDonut(stats) {
    var group = $('#donutSegments');
    var legend = $('#catLegend');
    if (!group || !legend) return;

    
    group.textContent = '';
    legend.innerHTML = '';

    var slices = stats.categories.filter(function (c) { return c.total > 0; });

    if (!slices.length) {
      group.appendChild(makeSvg('circle', {
        cx: 60, cy: 60, r: DONUT_R, class: 'donut-track'
      }));
      legend.innerHTML = '<p class="panel__sub" style="padding:0.5rem 0.25rem">' +
        'No spending recorded in ' + esc(RANGE_LABELS[state.range]) + '.</p>';
      setText('donutValue', '₹0');
      setText('donutLabel', 'Total');
      return;
    }

    var offset = 0;
    slices.forEach(function (slice, index) {
      var fraction = stats.total ? slice.total / stats.total : 0;
      var length = fraction * DONUT_C;
      var color = categoryColor(slice.key);

      // Small gap between slices for a cleaner ring.
      var visible = Math.max(0, length - 1.6);

      var seg = makeSvg('circle', {
        cx: 60, cy: 60, r: DONUT_R,
        class: 'donut-seg',
        stroke: color,
        'stroke-dasharray': visible.toFixed(2) + ' ' + DONUT_C.toFixed(2),
        'stroke-dashoffset': (-offset).toFixed(2),
        transform: 'rotate(-90 60 60)',
        tabindex: '-1'
      });
      seg.style.setProperty('--i', index);
      seg.dataset.key = slice.key;

      group.appendChild(seg);
      offset += length;
    });

    // Legend rows double as interactive highlight targets.
    slices.slice(0, 8).forEach(function (slice) {
      var color = categoryColor(slice.key);
      var row = document.createElement('div');
      row.className = 'legend__row';
      row.setAttribute('role', 'listitem');
      row.dataset.key = slice.key;
      row.innerHTML =
        '<span class="legend__swatch" style="--sw:' + color + '"></span>' +
        '<span class="legend__label">' + esc(categoryLabel(slice.key)) +
        '<span class="legend__meta">' + count(slice.count) +
        (slice.count === 1 ? ' transaction' : ' transactions') + '</span></span>' +
        '<span class="legend__value">' + esc(money(slice.total)) + '</span>';
      legend.appendChild(row);
    });

    if (slices.length > 8) {
      var more = document.createElement('div');
      more.className = 'legend__row';
      more.innerHTML = '<span class="legend__swatch" style="--sw:transparent"></span>' +
        '<span class="legend__label">Other ' + (slices.length - 8) + ' categories</span>' +
        '<span class="legend__value"></span>';
      legend.appendChild(more);
    }

    setText('donutValue', moneyShort(stats.total));
    setText('donutLabel', stats.topCategory ? 'Top: ' + categoryLabel(stats.topCategory.key) : 'Total');

    wireDonutHover(group, legend);
  }

  function makeSvg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { el.setAttribute(key, attrs[key]); });
    return el;
  }

  function wireDonutHover(group, legend) {
    var segments = $$('.donut-seg', group);
    var rows = $$('.legend__row[data-key]', legend);

    function highlight(key) {
      segments.forEach(function (seg) {
        seg.classList.toggle('is-dim', !!key && seg.dataset.key !== key);
      });
      rows.forEach(function (row) {
        row.classList.toggle('is-dim', !!key && row.dataset.key !== key);
      });
    }

    segments.forEach(function (seg) {
      var key = seg.dataset.key;
      seg.addEventListener('mouseenter', function () { highlight(key); });
      seg.addEventListener('focus', function () { highlight(key); });
      seg.addEventListener('mouseleave', function () { highlight(null); });
      seg.addEventListener('blur', function () { highlight(null); });
      seg.addEventListener('click', function () { onCategoryClick(key); });
    });

    rows.forEach(function (row) {
      var key = row.dataset.key;
      row.addEventListener('mouseenter', function () { highlight(key); });
      row.addEventListener('mouseleave', function () { highlight(null); });
      row.addEventListener('click', function () { onCategoryClick(key); });
    });
  }

  /** Clicking a slice/legend cross-filters the table. */
  function onCategoryClick(key) {
    state.category = state.category === key ? '' : key;
    var select = $('#filterCategory');
    if (select) select.value = state.category;
    state.page = 1;
    renderTable();
  }

  /* ---------------------------------------------------------------------
     Monthly bar chart
     --------------------------------------------------------------------- */
  var BAR = { w: 640, h: 260, padTop: 22, padBottom: 34, padLeft: 8, padRight: 8 };
  var MAX_BUCKETS = 8;

  function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  
  function monthBuckets(stats) {
    var buckets = [];
    if (!stats.months.length) {
      var today = startOfToday();
      for (var i = MAX_BUCKETS - 1; i >= 0; i--) {
        var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        buckets.push({ key: monthKey(d), date: d, total: 0 });
      }
      return buckets;
    }

    var last = stats.months[stats.months.length - 1].split('-');
    var cursor = new Date(Number(last[0]), Number(last[1]) - 1, 1);
    var first = stats.months[0].split('-');
    var earliest = new Date(Number(first[0]), Number(first[1]) - 1, 1);

    var monthsAvailable = (cursor.getFullYear() - earliest.getFullYear()) * 12
      + (cursor.getMonth() - earliest.getMonth()) + 1;
    var span = Math.min(MAX_BUCKETS, Math.max(1, monthsAvailable));

    for (var j = span - 1; j >= 0; j--) {
      var date = new Date(cursor.getFullYear(), cursor.getMonth() - j, 1);
      var key = monthKey(date);
      buckets.push({
        key: key,
        date: date,
        total: stats.monthTotals[key] || 0
      });
    }
    return buckets;
  }

  function renderTrend(stats) {
    var barsGroup = $('#barsGroup');
    var gridGroup = $('#barsGrid');
    var axisGroup = $('#barsAxis');
    var tip = $('#trendTip');
    var wrap = $('#barsWrap');
    if (!barsGroup || !gridGroup || !axisGroup) return;

    barsGroup.textContent = '';
    gridGroup.textContent = '';
    axisGroup.textContent = '';

    var buckets = monthBuckets(stats);
    var plotH = BAR.h - BAR.padTop - BAR.padBottom;
    var plotW = BAR.w - BAR.padLeft - BAR.padRight;
    var maxTotal = buckets.reduce(function (m, b) { return Math.max(m, b.total); }, 0);

    
    var lines = 4;
    for (var g = 0; g <= lines; g++) {
      var y = BAR.padTop + (plotH / lines) * g;
      gridGroup.appendChild(makeSvg('line', {
        x1: BAR.padLeft, x2: BAR.w - BAR.padRight,
        y1: y.toFixed(1), y2: y.toFixed(1)
      }));
    }

    if (!maxTotal) {
      var emptyNote = makeSvg('text', {
        x: BAR.w / 2, y: BAR.h / 2, class: 'bars-axis'
      });
      emptyNote.textContent = 'No data for ' + RANGE_LABELS[state.range];
      axisGroup.appendChild(emptyNote);
      setText('trendPanelSub', 'Nothing recorded in ' + RANGE_LABELS[state.range]);
      return;
    }

    var slot = plotW / buckets.length;
    var barW = Math.min(46, slot * 0.56);

    buckets.forEach(function (bucket, index) {
      var ratio = maxTotal ? bucket.total / maxTotal : 0;
      
      var barH = Math.max(bucket.total > 0 ? 3 : 0, ratio * plotH);
      var x = BAR.padLeft + slot * index + (slot - barW) / 2;
      var y = BAR.padTop + plotH - barH;

      if (barH > 0) {
        var bar = makeSvg('rect', {
          x: x.toFixed(1), y: y.toFixed(1),
          width: barW.toFixed(1), height: barH.toFixed(1),
          class: 'bars-col'
        });
        bar.style.setProperty('--i', index);
        barsGroup.appendChild(bar);
      }

      var label = makeSvg('text', {
        x: (BAR.padLeft + slot * index + slot / 2).toFixed(1),
        y: BAR.h - BAR.padBottom + 18,
        class: 'bars-axis'
      });
      label.textContent = MONTH_NAMES[bucket.date.getMonth()];
      axisGroup.appendChild(label);

      if (buckets.length > 1 && (index === 0 || bucket.date.getMonth() === 0)) {
        var yearLabel = makeSvg('text', {
          x: (BAR.padLeft + slot * index + slot / 2).toFixed(1),
          y: BAR.h - BAR.padBottom + 31,
          class: 'bars-axis',
          opacity: '0.7'
        });
        yearLabel.textContent = String(bucket.date.getFullYear()).slice(2);
        axisGroup.appendChild(yearLabel);
      }

      // Invisible hit area makes hovering/tapping easy on small screens.
      var hit = makeSvg('rect', {
        x: (BAR.padLeft + slot * index).toFixed(1),
        y: BAR.padTop,
        width: slot.toFixed(1),
        height: plotH,
        class: 'bars-hit'
      });

      function showTip(evt) {
        if (!tip || !wrap) return;
        var rect = wrap.getBoundingClientRect();
        var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        tip.innerHTML = '<strong>' + esc(money(bucket.total)) + '</strong><span>' +
          esc(MONTH_NAMES[bucket.date.getMonth()] + ' ' + bucket.date.getFullYear()) + '</span>';
        tip.style.left = Math.max(70, Math.min(rect.width - 70, clientX - rect.left)) + 'px';
        tip.style.top = Math.max(46, clientY - rect.top) + 'px';
        tip.classList.add('is-visible');
      }

      hit.addEventListener('mouseenter', showTip);
      hit.addEventListener('mousemove', showTip);
      hit.addEventListener('mouseleave', function () { if (tip) tip.classList.remove('is-visible'); });
      barsGroup.appendChild(hit);
    });

    var busiest = buckets.reduce(function (a, b) { return b.total > a.total ? b : a; }, buckets[0]);
    setText('trendPanelSub', 'Peak ' + MONTH_NAMES[busiest.date.getMonth()] + ' ' + busiest.date.getFullYear()
      + ' · ' + money(busiest.total));
  }

  /* ---------------------------------------------------------------------
     Ranked bar lists
     --------------------------------------------------------------------- */
  function renderBarList(target, rows, options) {
    var node = $(target);
    if (!node) return;
    node.innerHTML = '';

    if (!rows.length) {
      node.innerHTML = '<p class="panel__sub" style="padding:0.5rem 0.25rem">' +
        esc(options.emptyText || 'No data for this period.') + '</p>';
      return;
    }

    var top = rows[0].total || 1;
    var limit = options.limit || 5;

    rows.slice(0, limit).forEach(function (row, index) {
      var share = pct(row.total, options.total || top);
      var item = document.createElement('div');
      item.className = 'bar-item';
      item.innerHTML =
        '<div class="bar-item__head">' +
        '<span class="bar-item__name">' + esc(row.label) + '</span>' +
        '<span class="bar-item__val">' + esc(money(row.total)) +
        ' <span class="legend__meta" style="display:inline">' + share.toFixed(0) + '%</span></span>' +
        '</div>' +
        '<div class="bar-item__track">' +
        '<div class="bar-item__fill" style="--fill:' + (options.colorOf ? options.colorOf(row) : 'var(--brand-grad)') + '"></div>' +
        '</div>';
      node.appendChild(item);

      var fill = $('.bar-item__fill', item);
      fill.style.setProperty('--i', index);
      var width = pct(row.total, top).toFixed(1) + '%';
      fill.style.setProperty('--target-width', width);
      requestAnimationFrame(function () { fill.style.inlineSize = width; });
    });
  }

  function renderMethods(stats) {
    renderBarList('#methodList', stats.methods.map(function (m) {
      return { label: methodLabel(m.key), total: m.total, key: m.key };
    }), {
      limit: 6,
      total: stats.total,
      colorOf: function (row) { return methodColor(row.key); },
      emptyText: 'No payments recorded in this period.'
    });
  }

  function renderMerchants(stats) {
    renderBarList('#merchantList', stats.merchants.map(function (m) {
      return { label: m.name, total: m.total, key: m.key };
    }), {
      limit: 5,
      total: stats.total,
      colorOf: function (row) { return hashColor(row.key); },
      emptyText: 'No merchants recorded in this period.'
    });
  }

  /* ---------------------------------------------------------------------
     Highlights
     --------------------------------------------------------------------- */
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function renderInsights(stats) {
    var node = $('#insightList');
    if (!node) return;
    node.innerHTML = '';

    if (!stats.count) {
      node.innerHTML = '<p class="panel__sub" style="padding:0.5rem 0.25rem">' +
        'Add transactions to unlock insights.</p>';
      return;
    }

    var cards = [];

    if (stats.max) {
      cards.push({
        icon: 'bolt',
        color: '#f59e0b',
        title: 'Largest expense ' + moneyShort(stats.max.amount),
        sub: stats.max.merchant + ' · ' + categoryLabel(stats.max.category)
      });
    }

    if (stats.topCategory) {
      cards.push({
        icon: 'tag',
        color: categoryColor(stats.topCategory.key),
        title: categoryLabel(stats.topCategory.key) + ' leads at ' + pct(stats.topCategory.total, stats.total).toFixed(0) + '%',
        sub: money(stats.topCategory.total) + ' across ' + stats.topCategory.count + ' transactions'
      });
    }

    if (stats.methods[0]) {
      cards.push({
        icon: 'wallet',
        color: methodColor(stats.methods[0].key),
        title: 'Most used: ' + methodLabel(stats.methods[0].key),
        sub: stats.methods[0].count + ' of ' + stats.count + ' transactions'
      });
    }

    if (stats.merchants[0]) {
      cards.push({
        icon: 'grid',
        color: hashColor(stats.merchants[0].key),
        title: 'Top merchant: ' + stats.merchants[0].name,
        sub: money(stats.merchants[0].total) + ' across ' + stats.merchants[0].count
          + (stats.merchants[0].count === 1 ? ' visit' : ' visits')
      });
    }

    var busiestDay = null;
    Object.keys(stats.dayTotals).forEach(function (key) {
      if (!busiestDay || stats.dayTotals[key] > stats.dayTotals[busiestDay]) busiestDay = key;
    });
    if (busiestDay !== null) {
      cards.push({
        icon: 'chart',
        color: '#22d3ee',
        title: DAY_NAMES[Number(busiestDay)] + ' is your heaviest day',
        sub: money(stats.dayTotals[busiestDay]) + ' spent in total'
      });
    }

    cards.slice(0, 5).forEach(function (card) {
      var el = document.createElement('div');
      el.className = 'insight';
      el.style.setProperty('--c', card.color);
      el.innerHTML =
        '<span class="insight__icon"><svg aria-hidden="true"><use href="#i-' + card.icon + '"></use></svg></span>' +
        '<span class="insight__text"><strong>' + esc(card.title) + '</strong>' +
        '<span>' + esc(card.sub) + '</span></span>';
      node.appendChild(el);
    });
  }

  /* ---------------------------------------------------------------------
    Transactions table
     --------------------------------------------------------------------- */
  var dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  function renderTable() {
    var body = $('#txBody');
    if (!body) return;

    var rows = sortList(filtered());
    var totalPages = Math.max(1, Math.ceil(rows.length / state.perPage));

    if (state.page > totalPages) state.page = totalPages;

    var start = (state.page - 1) * state.perPage;
    var pageRows = rows.slice(start, start + state.perPage);

    body.innerHTML = '';
    pageRows.forEach(function (t) { body.appendChild(buildRow(t)); });

    renderPagination(rows.length, start, pageRows.length, totalPages);
    updateFilterUI(rows.length);
  }

  function buildRow(t) {
    var tr = document.createElement('tr');
    var catColor = categoryColor(t.category);
    var methodCol = methodColor(t.payment_method);
    var subtitle = t.description || sourceLabel(t.source);

    tr.innerHTML =
      '<td data-label="Merchant">' +
      '<div class="cell-merchant">' +
      '<span class="avatar" style="--av:' + hashColor(t.merchant) + '" aria-hidden="true">' +
      esc(initials(t.merchant)) + '</span>' +
      '<span><span class="merchant-name">' + esc(t.merchant) + '</span>' +
      (subtitle ? '<span class="merchant-note">' + esc(subtitle) + '</span>' : '') +
      '</span></div></td>' +

      '<td data-label="Category"><span class="chip" style="--chip-fg:' + catColor +
      ';--chip-bg:' + hexToRgba(catColor, 0.14) +
      ';--chip-bd:' + hexToRgba(catColor, 0.32) +
      ';--chip-dot:' + catColor + '">' +
      '<span class="dot" aria-hidden="true"></span>' + esc(categoryLabel(t.category)) + '</span></td>' +

      '<td data-label="Payment"><span class="chip" style="--chip-fg:' + methodCol +
      ';--chip-bg:' + hexToRgba(methodCol, 0.12) +
      ';--chip-bd:' + hexToRgba(methodCol, 0.3) +
      ';--chip-dot:' + methodCol + '">' +
      '<span class="dot" aria-hidden="true"></span>' + esc(methodLabel(t.payment_method)) + '</span></td>' +

      '<td data-label="Date"><span class="cell-date">' + esc(dateFmt.format(t.date)) + '</span></td>' +

      '<td data-label="Amount"><span class="cell-amount">' + esc(money(t.amount)) + '</span></td>' +

      '<td class="table__actions" data-label="Actions"><div class="row-actions">' +
      '<a class="row-action row-action--edit" href="' + esc(t.edit_url) + '">Edit</a>' +
      '<form class="delete-transaction-form" method="post" action="' + esc(t.delete_url) + '">' +
      '<input type="hidden" name="csrfmiddlewaretoken" value="' + esc(csrfToken) + '">' +
      '<button class="row-action row-action--delete" type="submit">Delete</button>' +
      '</form></div></td>';

    var deleteForm = $('.delete-transaction-form', tr);
    if (deleteForm) {
      deleteForm.addEventListener('submit', function (event) {
        if (!window.confirm('Delete the transaction for ' + t.merchant + '?')) {
          event.preventDefault();
        }
      });
    }

    return tr;
  }

  function renderPagination(totalRows, offset, shown, totalPages) {
    var info = $('#pageInfo');
    var buttons = $('#pageButtons');
    if (!info || !buttons) return;

    if (!totalRows) {
      info.textContent = 'No results';
      buttons.innerHTML = '';
      return;
    }

    info.textContent = 'Showing ' + (offset + 1) + '–' + (offset + shown) + ' of ' + count(totalRows);

    if (totalPages <= 1) {
      buttons.innerHTML = '';
      return;
    }

    buttons.innerHTML = '';

    buttons.appendChild(pageButton('‹', 'Previous page', state.page === 1, function () {
      state.page -= 1; renderTable();
    }));

    pageNumbers(state.page, totalPages).forEach(function (entry) {
      if (entry === '…') {
        var gap = document.createElement('span');
        gap.className = 'page-ellipsis';
        gap.textContent = '…';
        buttons.appendChild(gap);
        return;
      }
      var btn = pageButton(String(entry), 'Go to page ' + entry, false, function () {
        state.page = entry; renderTable();
        scrollToTable();
      });
      if (entry === state.page) {
        btn.classList.add('is-active');
        btn.setAttribute('aria-current', 'page');
      }
      buttons.appendChild(btn);
    });

    buttons.appendChild(pageButton('›', 'Next page', state.page === totalPages, function () {
      state.page += 1; renderTable();
    }));
  }

  function pageButton(label, ariaLabel, disabled, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.disabled = !!disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  
  function pageNumbers(current, total) {
    if (total <= 7) {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var out = [1];
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    if (start > 2) out.push('…');
    for (var j = start; j <= end; j++) out.push(j);
    if (end < total - 1) out.push('…');
    out.push(total);
    return out;
  }

  function scrollToTable() {
    var panel = $('#transactions');
    if (!panel) return;
    var top = panel.getBoundingClientRect().top + window.pageYOffset - 90;
    if (window.pageYOffset > top) {
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }

  function updateFilterUI(shown) {
    var badge = $('#txFilterBadge');
    var counter = $('#txCount');
    var empty = $('#emptyState');
    var wrap = $('#tableWrap');

    var active = !!(state.query.trim() || state.category || state.method || state.source);

    if (badge) {
      badge.hidden = !active;
      if (active) {
        var parts = [];
        if (state.category) parts.push(categoryLabel(state.category));
        if (state.method) parts.push(methodLabel(state.method));
        if (state.source) parts.push(sourceLabel(state.source));
        if (state.query.trim()) parts.push('"' + state.query.trim() + '"');
        badge.textContent = 'Filtered: ' + parts.join(' · ');
      }
    }

    if (counter) {
      counter.textContent = active
        ? count(shown) + ' of ' + count(ALL.length) + ' transactions'
        : count(ALL.length) + ' transactions';
    }

    var isEmpty = shown === 0;
    if (empty) empty.classList.toggle('is-visible', isEmpty);
    if (wrap) wrap.style.display = isEmpty ? 'none' : '';
  }

  
  function populateFilters() {
    var catSelect = $('#filterCategory');
    var methodSelect = $('#filterMethod');
    var sourceSelect = $('#filterSource');

    var cats = {};
    var methods = {};
    var sources = {};
    ALL.forEach(function (t) {
      if (t.category) cats[t.category] = true;
      if (t.payment_method) methods[t.payment_method] = true;
      if (t.source) sources[t.source] = true;
    });

    if (catSelect) {
      Object.keys(cats).sort().forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = categoryLabel(key);
        catSelect.appendChild(opt);
      });
    }

    if (methodSelect) {
      Object.keys(methods).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = methodLabel(key);
        methodSelect.appendChild(opt);
      });
    }

    if (sourceSelect) {
      Object.keys(sources).sort().forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = sourceLabel(key);
        sourceSelect.appendChild(opt);
      });
    }
  }

  /* ---------------------------------------------------------------------
      CSV export
     --------------------------------------------------------------------- */
  function csvCell(value) {
    var text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCsv() {
    var rows = sortList(filtered());
    if (!rows.length) {
      toast('Nothing to export with the current filters.');
      return;
    }

    var header = ['Date', 'Merchant', 'Category', 'Payment Method', 'Source', 'Description', 'Amount'];
    var lines = [header.join(',')];

    rows.forEach(function (t) {
      lines.push([
        dateFmt.format(t.date),
        t.merchant,
        categoryLabel(t.category),
        methodLabel(t.payment_method),
        sourceLabel(t.source),
        t.description,
        t.amount.toFixed(2)
      ].map(csvCell).join(','));
    });

    
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    toast('Exported ' + rows.length + ' transaction' + (rows.length === 1 ? '' : 's') + '.');
  }

  var toastTimer = null;
  function toast(message) {
    var node = $('#toast');
    var msg = $('#toastMsg');
    if (!node) return;
    if (msg) msg.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-visible'); }, 3200);
  }

  /* ---------------------------------------------------------------------
      Theme
     --------------------------------------------------------------------- */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var toggle = $('#themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    try { localStorage.setItem('et-theme', theme); } catch (e) { /* ignore */ }
  }
  /* ---------------------------------------------------------------------
     Off-canvas navigation (mobile)
     --------------------------------------------------------------------- */
  function setDrawer(open) {
    var sidebar = $('#sidebar');
    var overlay = $('#navOverlay');
    var toggle = $('#navToggle');
    if (!sidebar) return;

    sidebar.classList.toggle('is-open', open);
    if (overlay) {
      overlay.hidden = false;
      requestAnimationFrame(function () { overlay.classList.toggle('is-open', open); });
    }
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function isDrawerOpen() {
    var sidebar = $('#sidebar');
    return !!(sidebar && sidebar.classList.contains('is-open'));
  }

  /* ---------------------------------------------------------------------
     Render orchestration
     --------------------------------------------------------------------- */
  function renderAll() {
    var list = ranged();
    var stats = aggregate(list);

    renderKpis(list, stats);
    renderDonut(stats);
    renderTrend(stats);
    renderMethods(stats);
    renderMerchants(stats);
    renderInsights(stats);
    renderTable();

    setText('navCount', count(ALL.length));
    setText('pageSubtitle', stats.count
      ? 'Tracking ' + count(stats.count) + ' transaction' + (stats.count === 1 ? '' : 's')
        + ' over ' + RANGE_LABELS[state.range] + '.'
      : 'No transactions recorded yet.');
    setText('catPanelSub', stats.count
      ? 'Share of ' + money(stats.total) + ' over ' + RANGE_LABELS[state.range]
      : 'Nothing to break down yet.');
  }

  function resetFilters() {
    state.query = '';
    state.category = '';
    state.method = '';
    state.source = '';
    state.page = 1;

    var search = $('#globalSearch');
    if (search) search.value = '';
    var clear = $('#searchClear');
    if (clear) clear.classList.remove('is-visible');

    ['#filterCategory', '#filterMethod', '#filterSource'].forEach(function (sel) {
      var node = $(sel);
      if (node) node.value = '';
    });
  }
  /* ---------------------------------------------------------------------
     Event wiring
     --------------------------------------------------------------------- */
  function wireEvents() {
    // Range tabs -> KPIs + charts
    $$('#rangeTabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#rangeTabs button').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        state.range = btn.dataset.range;
        state.page = 1;
        renderAll();
      });
    });

    
    var search = $('#globalSearch');
    if (search) {
      var clearBtn = $('#searchClear');
      var runSearch = debounce(function () {
        state.query = search.value;
        state.page = 1;
        if (clearBtn) clearBtn.classList.toggle('is-visible', !!search.value);
        renderTable();
      }, 180);

      search.addEventListener('input', runSearch);
      search.addEventListener('keydown', function (evt) {
        if (evt.key === 'Escape' && search.value) {
          evt.stopPropagation();
          search.value = '';
          runSearch();
        }
      });
    }

    var clearSearch = $('#searchClear');
    if (clearSearch) {
      clearSearch.addEventListener('click', function () {
        var input = $('#globalSearch');
        if (input) {
          input.value = '';
          input.focus();
        }
        state.query = '';
        state.page = 1;
        clearSearch.classList.remove('is-visible');
        renderTable();
      });
    }

    
    [['#filterCategory', 'category'], ['#filterMethod', 'method'], ['#filterSource', 'source']]
      .forEach(function (pair) {
        var node = $(pair[0]);
        if (!node) return;
        node.addEventListener('change', function () {
          state[pair[1]] = node.value;
          state.page = 1;
          renderTable();
        });
      });

    var reset = $('#resetFilters');
    if (reset) {
      reset.addEventListener('click', function () {
        resetFilters();
        renderTable();
        toast('Filters cleared.');
      });
    }

    
    $$('#txTable th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'date' || key === 'amount' ? 'desc' : 'asc';
        }
        state.page = 1;
        syncSortHeaders();
        renderTable();
      });
    });

    // Theme
    var themeToggle = $('#themeToggle');
    if (themeToggle) {
      applyTheme(currentTheme());
      themeToggle.addEventListener('click', function () {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    }

    var exportBtn = $('#exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCsv);

    // Drawer
    var navToggle = $('#navToggle');
    if (navToggle) navToggle.addEventListener('click', function () { setDrawer(!isDrawerOpen()); });

    var navClose = $('#navClose');
    if (navClose) navClose.addEventListener('click', function () { setDrawer(false); });

    var overlay = $('#navOverlay');
    if (overlay) overlay.addEventListener('click', function () { setDrawer(false); });

    // Sidebar links
    $$('[data-nav]').forEach(function (link) {
      link.addEventListener('click', function () {
        $$('[data-nav]').forEach(function (l) {
          l.classList.remove('is-active');
          l.removeAttribute('aria-current');
        });
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
        if (isDrawerOpen()) setDrawer(false);
      });
    });

    
    document.addEventListener('keydown', function (evt) {
      var tag = (evt.target && evt.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (evt.key === '/' && !typing) {
        evt.preventDefault();
        var input = $('#globalSearch');
        if (input) input.focus();
      }

      if (evt.key === 'Escape' && isDrawerOpen()) setDrawer(false);
    });


    window.addEventListener('resize', debounce(function () {
      if (window.innerWidth > 980 && isDrawerOpen()) setDrawer(false);
    }, 150));
  }

  function syncSortHeaders() {
    $$('#txTable th[data-sort]').forEach(function (th) {
      if (th.dataset.sort === state.sortKey) {
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
    });
  }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  function init() {
    populateFilters();
    wireEvents();
    syncSortHeaders();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();