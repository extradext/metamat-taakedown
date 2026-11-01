/* bracket.js — shared visual-bracket renderer for screen, print, and packet.
   Rounds become columns, matches become boxes, slot refs become wires:
   winner-advance wires are solid, loser-drop wires are dashed.
   Round-robin always renders as a table, never a bracket.
   Data-driven: names, scores, results, and advancement all come from the
   match payload, so re-rendering after a refresh shows live results. */
window.Bracket = (() => {
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  var SIDE_ORDER = { WB: 0, CONS: 1, PLACE3: 2, FINAL: 3, RESET: 4, RR: 9 };
  function sideOf(m) { return (m && m.side) || 'WB'; }
  function roundNum(m) {
    var n = parseInt(String((m && m.round) || '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function formatLabel(f) {
    return f === 'single-elim' ? 'Single Elimination'
      : f === 'round-robin' ? 'Round Robin'
      : f === 'double-elim-single-final' ? 'Double Elim · Single Final'
      : 'Double Elimination';
  }
  function friendlyTitle(side, num, count, isLast, format) {
    if (side === 'WB') {
      if (count === 8) return 'Round of 16';
      if (count === 4) return 'Quarterfinals';
      if (count === 2) return 'Semifinals';
      if (count === 1 && isLast) return format === 'single-elim' ? 'Final' : 'Winners Final';
      return 'Winners Round ' + num;
    }
    if (side === 'CONS') return isLast ? 'Consolation Final' : 'Consolation Round ' + num;
    if (side === 'PLACE3') return '3rd Place';
    if (side === 'FINAL') return 'Championship Final';
    if (side === 'RESET') return 'Championship Reset';
    return side + ' ' + num;
  }

  function groupColumns(matches, format) {
    var groups = {}; var order = [];
    matches.forEach(function (m) {
      var key = sideOf(m) + ':' + roundNum(m);
      if (!groups[key]) { groups[key] = { side: sideOf(m), num: roundNum(m), matches: [] }; order.push(key); }
      groups[key].matches.push(m);
    });
    var cols = order.map(function (k) { return groups[k]; });
    cols.forEach(function (c) {
      c.matches = c.matches.map(function (m, i) { return { m: m, i: i }; }).sort(function (x, y) {
        var bx = x.m.bout == null ? 1e9 : x.m.bout;
        var by = y.m.bout == null ? 1e9 : y.m.bout;
        return (bx - by) || (x.i - y.i);
      }).map(function (x) { return x.m; });
    });
    cols.sort(function (a, b) {
      return ((SIDE_ORDER[a.side] ?? 9) - (SIDE_ORDER[b.side] ?? 9)) || (a.num - b.num);
    });
    var lastBySide = {};
    cols.forEach(function (c) { lastBySide[c.side] = Math.max(lastBySide[c.side] || 0, c.num); });
    cols.forEach(function (c) {
      c.title = friendlyTitle(c.side, c.num, c.matches.length, c.num === lastBySide[c.side], format);
    });
    return cols;
  }

  function slotName(m, which, titles) {
    var name = which === 'A' ? m.a : m.b;
    if (name && name !== 'TBD') return { name: name, tbd: false };
    var feed = which === 'A' ? m.feedA : m.feedB;
    if (feed && feed.from && titles[feed.from]) {
      return { name: (feed.via === 'l' ? 'Loser ' : 'Winner ') + titles[feed.from], tbd: true };
    }
    return { name: 'TBD', tbd: true };
  }

  function metaLine(m) {
    var parts = [];
    if (m.status === 'completed') parts.push('FINAL · ' + (m.outcome || 'result'));
    else if (m.live) parts.push('IN PROGRESS');
    if (m.bout != null) parts.push('Bout ' + m.bout);
    if (m.mat != null) parts.push('Mat ' + m.mat);
    if (!parts.length) parts.push(m.status === 'completed' ? 'FINAL' : 'Upcoming');
    return parts.join(' · ');
  }

  function scoreCell(m, which) {
    if (m.status === 'completed') {
      var s = which === 'A' ? m.scoreA : m.scoreB;
      return esc(s == null ? '–' : s);
    }
    return '<span class="blankscore" aria-hidden="true"></span>';
  }

  function matchHTML(m, titles, decideId) {
    var done = m.status === 'completed';
    var winA = !!(done && m.wid && m.aid && m.wid === m.aid);
    var winB = !!(done && m.wid && m.bid && m.wid === m.bid);
    var sA = slotName(m, 'A', titles); var sB = slotName(m, 'B', titles);
    var champA = winA && decideId && m.id === decideId;
    var champB = winB && decideId && m.id === decideId;
    var row = function (which, s, win, champ, wid) {
      return '<div class="brow' + (s.tbd ? ' tbd' : '') + (win ? ' win winnerglow' : '') + '"'
        + ' data-slot="' + which + '" data-wid="' + esc(s.tbd ? '' : (wid || '')) + '">'
        + '<span class="bname">' + esc(s.name) + (champ ? '<span class="ctag">CHAMPION</span>' : '') + '</span>'
        + '<span class="bscore">' + scoreCell(m, which) + '</span></div>';
    };
    return '<div class="brk-match" data-mid="' + esc(m.id) + '">'
      + row('A', sA, winA, champA, m.aid) + row('B', sB, winB, champB, m.bid)
      + '<div class="bmeta"><span class="mdot ' + (m.status === 'completed' ? 'done' : (m.live ? 'live' : 'todo')) + '" aria-hidden="true"></span>' + esc(metaLine(m)) + '</div></div>';
  }

  function decideIdFor(matches) {
    var doneReset = matches.filter(function (m) { return m.side === 'RESET' && m.status === 'completed'; });
    if (doneReset.length) return doneReset[doneReset.length - 1].id;
    var doneFinal = matches.filter(function (m) { return m.side === 'FINAL' && m.status === 'completed'; });
    if (doneFinal.length) return doneFinal[doneFinal.length - 1].id;
    return null;
  }

  function bracketHTML(o) {
    var cols = groupColumns(o.matches, o.format);
    var titles = {};
    cols.forEach(function (c) { c.matches.forEach(function (m) { titles[m.id] = c.title; }); });
    var decideId = decideIdFor(o.matches);
    var colHTML = cols.map(function (c) {
      return '<div class="brk-col"><div class="brk-coltitle">' + esc(c.title) + '</div><div class="brk-matches">'
        + c.matches.map(function (m) { return matchHTML(m, titles, decideId); }).join('') + '</div></div>';
    }).join('');
    return '<div class="brk-scroll"><div class="brk"><svg class="brk-wires" aria-hidden="true"></svg>'
      + colHTML + '</div></div>'
      + '<p class="pathhint">Tap a wrestler to follow their path through the bracket.</p>';
  }

  function tableHTML(o) {
    var rows = o.matches.map(function (m) {
      var res = m.status === 'completed'
        ? esc((m.outcome || 'FINAL') + (m.scoreA != null && m.scoreB != null ? ' ' + m.scoreA + '-' + m.scoreB : ''))
        : (m.live ? 'In progress' : 'Upcoming');
      return '<tr><td>' + esc(m.bout ?? '') + '</td><td>' + esc(m.mat ?? '') + '</td><td>' + esc(m.round || '') + '</td>'
        + '<td>' + esc(m.a || 'TBD') + '</td><td>' + esc(m.scoreA ?? '') + '</td>'
        + '<td>' + esc(m.scoreB ?? '') + '</td><td>' + esc(m.b || 'TBD') + '</td><td>' + res + '</td></tr>';
    }).join('');
    return '<div class="brk-scroll"><table class="scores rrtable"><tr><th>Bout</th><th>Mat</th><th>Round</th>'
      + '<th colspan="2">Red</th><th colspan="2">Green</th><th>Result</th></tr>' + rows + '</table></div>';
  }

  function sheetHTML(o) {
    var head = '<div class="sheethead"><div><h3>' + esc(o.title) + '</h3>'
      + (o.sub ? '<div class="sheetsub">' + esc(o.sub) + '</div>' : '') + '</div>'
      + '<span class="sheetfmt">' + esc(formatLabel(o.format)) + '</span></div>';
    var body = o.format === 'round-robin' ? tableHTML(o) : bracketHTML(o);
    return head + body;
  }

  function renderSheet(mount, o) {
    mount.innerHTML = sheetHTML(o);
    var brk = mount.querySelector('.brk');
    if (brk) { brk._matches = o.matches; drawWires(brk); }
    return mount;
  }

  function drawWires(scope) {
    var roots = scope && scope.classList && scope.classList.contains('brk')
      ? [scope] : Array.prototype.slice.call((scope || document).querySelectorAll('.brk'));
    roots.forEach(function (brk) {
      var data = brk._matches || [];
      var svg = brk.querySelector('svg.brk-wires');
      if (!svg || !data.length) return;
      var brkRect = brk.getBoundingClientRect();
      var W = Math.max(1, Math.round(brk.scrollWidth)); var H = Math.max(1, Math.round(brk.scrollHeight));
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      var out = [];
      data.forEach(function (m) {
        var tel = brk.querySelector('[data-mid="' + m.id + '"]');
        if (!tel) return;
        [['A', m.feedA], ['B', m.feedB]].forEach(function (pair) {
          var feed = pair[1];
          if (!feed || !feed.from) return;
          var sel = brk.querySelector('[data-mid="' + feed.from + '"]');
          if (!sel) return;
          var r1 = sel.getBoundingClientRect(); var r2 = tel.getBoundingClientRect();
          var row = tel.querySelector('[data-slot="' + pair[0] + '"]');
          var rr = row ? row.getBoundingClientRect() : r2;
          var x1 = r1.right - brkRect.left; var y1 = r1.top + r1.height / 2 - brkRect.top;
          var x2 = r2.left - brkRect.left; var y2 = rr.top + rr.height / 2 - brkRect.top;
          var mx = (x1 + x2) / 2;
          out.push('<path class="wire ' + (feed.via === 'l' ? 'drop' : 'adv') + '"'
            + ' data-from="' + feed.from + '" data-to="' + m.id + '"'
            + ' d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' H' + mx.toFixed(1)
            + ' V' + y2.toFixed(1) + ' H' + x2.toFixed(1) + '"/>');
        });
      });
      svg.innerHTML = out.join('');
    });
  }

  function clearPath(sheet) {
    sheet.querySelectorAll('.path-on').forEach(function (el) { el.classList.remove('path-on'); });
    sheet._pathWid = null;
  }

  function followPath(sheet, wid) {
    clearPath(sheet);
    if (!wid) return;
    sheet._pathWid = wid;
    sheet.querySelectorAll('.brow[data-wid="' + wid + '"]').forEach(function (el) { el.classList.add('path-on'); });
    var brk = sheet.querySelector('.brk');
    var byId = {};
    ((brk && brk._matches) || []).forEach(function (m) { byId[m.id] = m; });
    sheet.querySelectorAll('.wire').forEach(function (p) {
      var a = byId[p.getAttribute('data-from')]; var b = byId[p.getAttribute('data-to')];
      var inA = a && (a.aid === wid || a.bid === wid);
      var inB = b && (b.aid === wid || b.bid === wid);
      if (inA && inB) p.classList.add('path-on');
    });
  }

  function initPathClicks() {
    document.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('.bracket-sheet .brow[data-wid]') : null;
      var sheet = e.target && e.target.closest ? e.target.closest('.bracket-sheet') : null;
      if (!sheet) return;
      if (!row || !row.getAttribute('data-wid')) {
        if (!e.target.closest('.brow')) clearPath(sheet);
        return;
      }
      var wid = row.getAttribute('data-wid');
      if (sheet._pathWid === wid) clearPath(sheet);
      else followPath(sheet, wid);
    });
  }

  // Print layouts: "full" scales one bracket to fill the landscape page
  // (up to 1.5x so small brackets print bigger); "compact" caps at 0.6x so
  // small brackets pack several to a page. Read from the nearest
  // [data-print-layout] ancestor (or body), defaulting to full.
  function fitForPrint() {
    document.querySelectorAll('.bracket-sheet').forEach(function (sheet) {
      var brk = sheet.querySelector('.brk');
      if (!brk || ('zoom' in brk.dataset)) return;
      var host = sheet.closest('[data-print-layout]');
      var layout = host && host.dataset.printLayout === 'compact' ? 'compact' : 'full';
      var w = brk.scrollWidth || 1;
      var z = layout === 'compact' ? Math.min(0.6, 950 / w) : Math.min(1.5, 950 / w);
      brk.dataset.zoom = brk.style.zoom || '';
      brk.style.zoom = z.toFixed(3);
    });
  }
  function unfitForPrint() {
    document.querySelectorAll('.bracket-sheet .brk').forEach(function (brk) {
      if ('zoom' in brk.dataset) { brk.style.zoom = brk.dataset.zoom; delete brk.dataset.zoom; }
    });
  }

  var resizeT = null;
  function initAuto() {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { drawWires(document); }, 150);
    });
    window.addEventListener('beforeprint', function () { drawWires(document); fitForPrint(); });
    window.addEventListener('afterprint', function () {
      unfitForPrint();
      if (document.body) document.body.classList.remove('printing-bracket');
    });
  }

  initPathClicks();
  initAuto();
  return { renderSheet: renderSheet, drawWires: drawWires, fitForPrint: fitForPrint, unfitForPrint: unfitForPrint };
})();
