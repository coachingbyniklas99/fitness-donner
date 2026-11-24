/* Verwaltung – Infobox im Kundenprofil: Notizen je Kunde + KI-Auswertung (Recherche mit Websuche).
   Hängt sich selbstständig unter den Kopf des Kundenprofils (admin-kunden.js bleibt unverändert).
   Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN).
   Gesammelt, gespeichert und an die KI gesendet wird im Worker (/api/admin/infobox/…). */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('kundenApp');
  if (!box) return;

  var S = { draft: {}, einw: {}, bilder: {}, ans: {}, offen: {}, busy: false, timer: null };

  var css = document.createElement('style');
  css.textContent =
    '.ib{margin:0 0 22px}' +
    '.ib textarea{width:100%;box-sizing:border-box;min-height:140px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:var(--bone,#eee);font:inherit;line-height:1.5;resize:vertical}' +
    '.ib-check{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14px;line-height:1.4;color:var(--muted,#9AA0AB)}' +
    '.ib-check input{margin-top:3px;flex:none}' +
    '.ib-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 10px}' +
    '.ib-row .ib-ki{margin-left:auto;padding:10px 16px;font-size:15px}' +
    '.ib-file{cursor:pointer}' +
    '.ib-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}' +
    '.ib-th{position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.16)}' +
    '.ib-th img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.ib-th button{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(0,0,0,.7);color:#fff;font-size:13px;line-height:20px;padding:0;cursor:pointer}' +
    '.ib-res{margin-top:16px;display:grid;gap:12px}' +
    '.ib-sec{border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;background:rgba(255,255,255,.03)}' +
    '.ib-sec h4{margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9AA0AB);font-weight:600}' +
    '.ib-sec p{margin:0 0 8px;line-height:1.5}' +
    '.ib-sec p:last-child{margin-bottom:0}' +
    '.ib-sec ul{margin:0;padding-left:20px;line-height:1.5}' +
    '.ib-sec li{margin:0 0 4px}' +
    '.ib-top{border-color:rgba(127,210,138,.45)}' +
    '.ib-warn{border-color:rgba(255,196,87,.6);background:rgba(255,196,87,.07)}' +
    '.ib-ph{display:grid;grid-template-columns:minmax(90px,30%) 1fr;gap:4px 12px;margin:0 0 6px}' +
    '.ib-ph b{font-weight:600}' +
    '.ib-ev{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;border:1px solid rgba(255,255,255,.2);margin-left:6px;vertical-align:1px}' +
    '.ib-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '@media(max-width:560px){.ib-two{grid-template-columns:1fr}.ib-ph{grid-template-columns:1fr}.ib-row .ib-ki{margin-left:0;width:100%}}' +
    '.ib-src a{color:inherit;text-decoration:underline;word-break:break-word}' +
    '.ib-fine{font-size:13px;color:var(--muted,#9AA0AB);line-height:1.45;margin:10px 0 0}' +
    '.ib-q{margin:0 0 12px}' +
    '.ib-q p{margin:0 0 6px}' +
    '.ib-q textarea{min-height:64px;padding:9px 12px;font-size:15px}' +
    '.ib-prev{margin:0 0 10px;padding:8px 12px;border-left:3px solid rgba(127,210,138,.5);background:rgba(255,255,255,.03);border-radius:0 8px 8px 0}' +
    '.ib-prev b{display:block;font-weight:600;margin-bottom:2px}' +
    '.ib-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 0}' +
    '.ib-act .btn{padding:9px 14px;font-size:14px}' +
    '.ib-more{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:2px}' +
    '.ib-more .ib-hint{font-size:14px;color:rgba(255,196,87,.95)}';
  document.head.appendChild(css);

  function esc(x) { return A.esc(x); }
  function pad(n) { return ('0' + n).slice(-2); }
  function ts(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note((e && e.message) || 'Das hat nicht geklappt.', true); }
  function $(el, sel) { return el.querySelector(sel); }

  /* ---------- Einhängen unter den Kopf des Kundenprofils ---------- */
  function sync() {
    var head = box.querySelector('.pf-head');
    if (!head || box.querySelector('#ibBox')) return;
    var sub = head.querySelector('.pf-sub');
    var m = sub && /[^\s·]+@[^\s·]+/.exec(sub.textContent || '');
    if (!m) return;
    var nm = head.querySelector('.pf-name');
    var el = document.createElement('div');
    el.id = 'ibBox';
    var email = m[0].toLowerCase();
    var name = nm ? String(nm.textContent || '').trim() : '';
    el._ctx = { email: email, name: name.toLowerCase() === email ? '' : name, data: null, ki: true };
    head.insertAdjacentElement('afterend', el);
    laden(el);
  }
  new MutationObserver(sync).observe(box, { childList: true });
  sync();

  function laden(el) {
    var c = el._ctx;
    el.innerHTML = '<div class="pf-h">Infobox</div><div class="ad-hint">Lädt …</div>';
    A.api('infobox/get?email=' + encodeURIComponent(c.email)).then(function (d) {
      c.data = d.box || null; c.ki = d.ki !== false;
      zeichnen(el);
    }).catch(function (e) {
      el.innerHTML = '<div class="pf-h">Infobox</div><div class="ad-hint">Die Infobox lässt sich gerade nicht laden. Ist der Worker aktualisiert (siehe Anleitung)?</div>';
      fail(e);
    });
  }

  /* ---------- Darstellung ---------- */
  function zeichnen(el) {
    var c = el._ctx, d = c.data || {};
    var text = S.draft[c.email] != null ? S.draft[c.email] : (d.notiz || '');
    var einwSchon = !!d.einwilligung_am;
    var bilder = S.bilder[c.email] || [];
    var hatErg = !!d.auswertung;

    el.innerHTML =
      '<div class="pf-h">Infobox</div>' +
      '<div class="ib">' +
      '<p class="ad-hint">Hier steht alles, was für das Training wichtig ist: Operationen, Verletzungen, Aussagen von Ärzt:innen oder Physio, Ziele, Einschränkungen. ' +
      'Die KI recherchiert daraus die wichtigsten Punkte. <b>Schreib keine Namen von Personen ins Feld</b> &ndash; der Name des Kunden sowie E-Mail und Telefonnummern werden vor dem Senden ohnehin entfernt.</p>' +
      '<textarea id="ibText" placeholder="z. B. Frau, 34. Anfang Oktober Bauchspiegelung wegen Endometriose. Physio sagt: 6 Monate keine Bauchmuskeln. Ärztin sagt: darf langsam einsteigen. Ziel: wieder Kraft aufbauen." maxlength="8000">' + esc(text) + '</textarea>' +
      '<div class="ib-thumbs" id="ibThumbs"></div>' +
      '<label class="ib-check"><input type="checkbox" id="ibEinw"' + (einwSchon || S.einw[c.email] ? ' checked' : '') + (einwSchon ? ' disabled' : '') + '>' +
      '<span>Die Person ist damit einverstanden, dass ich diese Gesundheitsangaben speichere und mit KI-Recherche (Anthropic, USA) auswerte.' + (einwSchon ? ' <small>(bestätigt am ' + esc(ts(d.einwilligung_am)) + ')</small>' : '') + '</span></label>' +
      '<div class="ib-row">' +
      '<button type="button" class="ad-mini" id="ibSave">Speichern</button>' +
      '<label class="ad-mini ib-file">+ Screenshot<input type="file" id="ibFile" accept="image/*" multiple hidden></label>' +
      '<button type="button" class="btn btn-blitz ib-ki" id="ibKi"' + (c.ki ? '' : ' disabled') + '>' + (hatErg ? 'Neu auswerten' : 'KI-Auswertung') + '</button>' +
      '</div>' +
      '<div class="ad-meta" id="ibStatus">' + statusText(d, c) + '</div>' +
      (bilder.length ? '<p class="ib-fine">Screenshots werden nur für die Auswertung gesendet und nicht gespeichert. Auf Screenshots stehen oft Namen &ndash; schneide sie vorher zu.</p>' : '') +
      '<div id="ibErg">' + (hatErg ? ergebnis(d, c) : '') + '</div>' +
      (d.notiz || hatErg ? '<div class="ib-row" style="margin-top:14px">' +
        (hatErg ? '<button type="button" class="ad-mini" id="ibKopie">Auswertung kopieren</button><button type="button" class="ad-mini" id="ibNurErg">Auswertung löschen</button>' : '') +
        '<button type="button" class="ad-mini ak-red" id="ibAlles">Infobox leeren &hellip;</button></div>' : '') +
      '</div>';

    var ta = $(el, '#ibText');
    ta.oninput = function () { S.draft[c.email] = ta.value; };
    $(el, '#ibEinw').onchange = function (e) { S.einw[c.email] = e.target.checked; };
    thumbs(el);
    bindErgebnis(el);

    $(el, '#ibFile').onchange = function (e) {
      var files = Array.prototype.slice.call(e.target.files || [], 0, 4 - (S.bilder[c.email] || []).length);
      e.target.value = '';
      files.reduce(function (p, f) {
        return p.then(function () { return verkleinern(f).then(function (b) { (S.bilder[c.email] = S.bilder[c.email] || []).push(b); }); });
      }, Promise.resolve()).then(function () { S.draft[c.email] = ta.value; zeichnen(el); }).catch(function () { A.note('Das Bild ließ sich nicht lesen.', true); });
    };

    $(el, '#ibSave').onclick = function () {
      var btn = this; btn.disabled = true;
      A.api('infobox/speichern', { body: { email: c.email, notiz: ta.value, einwilligung: $(el, '#ibEinw').checked } })
        .then(function (r) { c.data = r.box; delete S.draft[c.email]; A.note('Gespeichert.'); zeichnen(el); })
        .catch(function (e) { btn.disabled = false; fail(e); });
    };

    var ki = $(el, '#ibKi');
    ki.onclick = function () {
      if (S.busy) return;
      if (!$(el, '#ibEinw').checked) { A.note('Bitte erst das Einverständnis der Person bestätigen.', true); return; }
      if (ta.value.trim().length < 10 && !(S.bilder[c.email] || []).length) { A.note('Bitte erst Notizen eintragen.', true); return; }
      if (!ki.getAttribute('data-sicher')) {
        ki.setAttribute('data-sicher', '1');
        var alt = ki.textContent; ki.textContent = 'Jetzt senden? Text geht an die KI';
        setTimeout(function () { if (ki.isConnected && ki.getAttribute('data-sicher')) { ki.removeAttribute('data-sicher'); ki.textContent = alt; } }, 6000);
        return;
      }
      auswerten(el, ta.value);
    };

    var k = $(el, '#ibKopie'); if (k) k.onclick = function () { kopieren(d.auswertung); };
    var ne = $(el, '#ibNurErg');
    if (ne) ne.onclick = function () {
      if (!ne.getAttribute('data-sicher')) { ne.setAttribute('data-sicher', '1'); ne.textContent = 'Wirklich löschen?'; return; }
      ne.disabled = true;
      A.api('infobox/loeschen', { body: { email: c.email, nur_auswertung: true } }).then(function (r) { c.data = r.box; zeichnen(el); }).catch(function (e) { ne.disabled = false; fail(e); });
    };
    var al = $(el, '#ibAlles');
    if (al) al.onclick = function () {
      if (!al.getAttribute('data-sicher')) { al.setAttribute('data-sicher', '1'); al.textContent = 'Notiz und Auswertung wirklich löschen?'; return; }
      al.disabled = true;
      A.api('infobox/loeschen', { body: { email: c.email } }).then(function () { c.data = null; delete S.draft[c.email]; S.bilder[c.email] = []; A.note('Infobox geleert.'); zeichnen(el); }).catch(function (e) { al.disabled = false; fail(e); });
    };
  }

  function statusText(d, c) {
    if (!c.ki) return '<span class="ak-warn">Der KI-Schlüssel ist im Worker noch nicht hinterlegt.</span>';
    var t = [];
    if (d.geaendert) t.push('Notiz gespeichert ' + esc(ts(d.geaendert)));
    if (d.ausgewertet_am) t.push('Ausgewertet ' + esc(ts(d.ausgewertet_am)));
    return t.join(' &middot; ');
  }

  function thumbs(el) {
    var c = el._ctx, wrap = $(el, '#ibThumbs'), l = S.bilder[c.email] || [];
    wrap.innerHTML = l.map(function (b, i) { return '<div class="ib-th"><img alt="Screenshot ' + (i + 1) + '" src="data:' + esc(b.typ) + ';base64,' + b.daten + '"><button type="button" data-i="' + i + '" aria-label="Entfernen">&times;</button></div>'; }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
      b.onclick = function () { S.draft[c.email] = $(el, '#ibText').value; l.splice(Number(b.getAttribute('data-i')), 1); zeichnen(el); };
    });
  }

  /* Screenshot auf max. 1400 px verkleinern, damit die Übertragung schnell bleibt */
  function verkleinern(file) {
    return new Promise(function (ok, no) {
      var fr = new FileReader();
      fr.onerror = no;
      fr.onload = function () {
        var im = new Image();
        im.onerror = no;
        im.onload = function () {
          var s = Math.min(1, 1400 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
          cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
          ok({ typ: 'image/jpeg', daten: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- Auswertung anstoßen ---------- */
  function auswerten(el, text) {
    var c = el._ctx, ki = $(el, '#ibKi'), st = $(el, '#ibStatus'), t0 = Date.now();
    S.busy = true; ki.disabled = true; ki.removeAttribute('data-sicher');
    $(el, '#ibSave').disabled = true;
    function tick() { var s = Math.round((Date.now() - t0) / 1000); ki.textContent = 'Recherchiert … ' + s + ' s'; Array.prototype.forEach.call(el.querySelectorAll('.ib-ansKi'), function (b) { b.disabled = true; b.textContent = 'Recherchiert … ' + s + ' s'; }); Array.prototype.forEach.call(el.querySelectorAll('.ib-ansSave'), function (b) { b.disabled = true; }); st.textContent = 'Die KI sucht Studien und Leitlinien. Das dauert meist ein bis zwei Minuten. Bitte diese Seite offen lassen.'; }
    tick(); S.timer = setInterval(tick, 1000);
    A.api('infobox/auswerten', {
      body: { email: c.email, name: c.name, notiz: text, einwilligung: $(el, '#ibEinw').checked, bilder: S.bilder[c.email] || [], antworten: antwortenSammeln(el) }
    }).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      c.data = r.box; delete S.draft[c.email]; delete S.ans[c.email]; S.bilder[c.email] = [];
    }).catch(function (e) {
      S.draft[c.email] = text; fail(e);
    }).then(function () {
      clearInterval(S.timer); S.busy = false;
      if (el.isConnected) zeichnen(el);
    });
  }

  /* ---------- Ergebnis ---------- */
  function ul(l) { return l && l.length ? '<ul>' + l.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
  function p(t) { return t ? '<p>' + esc(t) + '</p>' : ''; }
  function sec(titel, inner, cls) { return inner ? '<div class="ib-sec' + (cls ? ' ' + cls : '') + '"><h4>' + titel + '</h4>' + inner + '</div>' : ''; }
  function phasen(l, a, b) { return (l || []).map(function (x) { return '<div class="ib-ph"><b>' + esc(x[a]) + '</b><span>' + esc(x[b]) + '</span></div>'; }).join(''); }

  /* ----- Rückfragen mit Antwortfeld ----- */
  function gespeicherteAntwort(d, q) {
    var l = (d && d.antworten) || [];
    for (var i = 0; i < l.length; i++) if (l[i].frage === q) return l[i].antwort || '';
    return '';
  }
  function antwortWert(c, q) {
    var dr = S.ans[c.email];
    return dr && dr[q] != null ? dr[q] : gespeicherteAntwort(c.data, q);
  }
  function fragenHtml(list, c) {
    var h = '';
    (list || []).forEach(function (q) {
      if (!q || c.fragen.indexOf(q) >= 0) return;
      c.fragen.push(q);
      var i = c.fragen.length - 1;
      h += '<div class="ib-q"><p><b>' + esc(q) + '</b></p><textarea class="ib-ans" data-i="' + i + '" maxlength="1500" placeholder="Deine Antwort (ohne Namen) &hellip;">' + esc(antwortWert(c, q)) + '</textarea></div>';
    });
    return h;
  }
  function aktionen() {
    return '<div class="ib-act"><button type="button" class="ad-mini ib-ansSave">Antworten speichern</button>' +
      '<button type="button" class="btn btn-blitz ib-ansKi">Speichern &amp; Analyse aktualisieren</button></div>' +
      '<p class="ib-fine">Die Analyse wird mit deinen Antworten neu erstellt. Das dauert ein bis zwei Minuten.</p>';
  }
  function frueherHtml(d, c) {
    var l = ((d && d.antworten) || []).filter(function (a) { return c.fragen.indexOf(a.frage) < 0; });
    if (!l.length) return '';
    return '<p style="margin-top:12px"><b>Bereits beantwortet (fließt in die Analyse ein)</b></p>' +
      l.map(function (a) { return '<div class="ib-prev"><b>' + esc(a.frage) + '</b>' + esc(a.antwort) + '</div>'; }).join('');
  }
  function antwortenSammeln(el) {
    var c = el._ctx, out = [];
    if (!c.fragen) return out;
    Array.prototype.forEach.call(el.querySelectorAll('textarea.ib-ans'), function (t) {
      var q = c.fragen[Number(t.getAttribute('data-i'))];
      if (q) out.push({ frage: q, antwort: t.value });
    });
    return out;
  }
  function bindErgebnis(el) {
    var c = el._ctx;
    Array.prototype.forEach.call(el.querySelectorAll('textarea.ib-ans'), function (t) {
      t.oninput = function () {
        var q = c.fragen[Number(t.getAttribute('data-i'))];
        (S.ans[c.email] = S.ans[c.email] || {})[q] = t.value;
        var offen = c.fragen.filter(function (x) { return !String(antwortWert(c, x)).trim(); }).length;
        var h = $(el, '#ibOffen'); if (h) h.textContent = offen ? offen + (offen === 1 ? ' Rückfrage offen' : ' Rückfragen offen') : '';
      };
    });
    var tg = $(el, '#ibToggle');
    if (tg) tg.onclick = function () {
      var v = $(el, '#ibVoll'), auf = v.hasAttribute('hidden');
      if (auf) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
      S.offen[c.email] = auf;
      tg.innerHTML = auf ? 'Analyse einklappen &#9652;' : 'Komplette Analyse anzeigen &#9662;';
    };
    Array.prototype.forEach.call(el.querySelectorAll('.ib-ansSave'), function (b) {
      b.onclick = function () {
        if (S.busy) return;
        b.disabled = true;
        A.api('infobox/antworten', { body: { email: c.email, antworten: antwortenSammeln(el) } })
          .then(function (r) { c.data = r.box; delete S.ans[c.email]; A.note('Antworten gespeichert.'); zeichnen(el); })
          .catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    Array.prototype.forEach.call(el.querySelectorAll('.ib-ansKi'), function (b) {
      b.onclick = function () {
        if (S.busy || !c.ki) return;
        var ta = $(el, '#ibText');
        if (ta.value.trim().length < 10 && !(S.bilder[c.email] || []).length) { A.note('Bitte erst Notizen eintragen.', true); return; }
        S.offen[c.email] = true;
        auswerten(el, ta.value);
      };
    });
  }

  function ergebnis(d, c) {
    var r = d.auswertung;
    if (!r) return '';
    if (r.roh) {
      return '<div class="ib-res">' + sec('Auswertung (ohne feste Gliederung)', '<p style="white-space:pre-wrap">' + esc(r.roh) + '</p>') + hinweis(d) + '</div>';
    }
    c.fragen = [];
    var sa = r.sachverhalt || {}, he = r.heilung || {}, wi = r.widerspruch || {}, st = r.studienlage || {}, tr = r.training || {};
    var ev = st.evidenz ? '<span class="ib-ev">Studienlage: ' + esc(st.evidenz) + '</span>' : '';
    // alle Rückfragen vorab einsammeln, damit die Zahl offener Fragen schon im eingeklappten Zustand stimmt
    var alleFragen = [].concat(wi.rueckfragen || [], r.offene_fragen || []).filter(function (q, i, a) { return q && a.indexOf(q) === i; });
    var offen = alleFragen.filter(function (q) { return !String(antwortWert({ email: c.email, data: d }, q)).trim(); }).length;
    var auf = !!S.offen[c.email];

    var h = '<div class="ib-res">';
    h += sec('Das Wichtigste', p(r.kurzfassung), 'ib-top');
    h += '<div class="ib-more"><button type="button" class="ad-mini" id="ibToggle">' + (auf ? 'Analyse einklappen &#9652;' : 'Komplette Analyse anzeigen &#9662;') + '</button>' +
      '<span class="ib-hint" id="ibOffen">' + (offen ? offen + (offen === 1 ? ' Rückfrage offen' : ' Rückfragen offen') : '') + '</span></div>';
    h += '<div id="ibVoll" class="ib-res"' + (auf ? '' : ' hidden') + '>';
    if (wi.vorhanden || wi.beschreibung) {
      var wf = fragenHtml(wi.rueckfragen, c);
      h += sec('Widerspruch zwischen den Angaben', p(wi.beschreibung) + p(wi.einordnung) + (wf ? '<p><b>Rückfragen an die Ärztin / den Arzt:</b></p>' + wf + aktionen() : ''), 'ib-warn');
    }
    h += sec('Was ist das, was wurde gemacht?', p(sa.was_ist_das) + (sa.was_wurde_gemacht ? '<p><b>Konkret:</b> ' + esc(sa.was_wurde_gemacht) + '</p>' : '') + (sa.unklar ? '<p><b>Unklar:</b> ' + esc(sa.unklar) + '</p>' : ''));
    h += sec('Heilungsverlauf', (he.dauer ? '<p><b>Dauer:</b> ' + esc(he.dauer) + '</p>' : '') + (he.stand_heute ? '<p><b>Stand heute:</b> ' + esc(he.stand_heute) + '</p>' : '') + phasen(he.phasen, 'zeitraum', 'inhalt') + (he.einflussfaktoren ? '<p><b>Einfluss:</b> ' + esc(he.einflussfaktoren) + '</p>' : ''));
    h += sec('Studienlage' + ev, p(st.zusammenfassung) + ((st.punkte || []).length ? '<ul>' + st.punkte.map(function (x) { return '<li>' + esc(x.aussage) + (x.einstufung ? ' <small>(' + esc(x.einstufung) + ')</small>' : '') + '</li>'; }).join('') + '</ul>' : ''));
    var gehtMeiden = ((tr.geht_jetzt || []).length || (tr.vorerst_meiden || []).length)
      ? '<div class="ib-two"><div><p><b>Geht jetzt</b></p>' + ul(tr.geht_jetzt) + '</div><div><p><b>Vorerst meiden</b></p>' + ul(tr.vorerst_meiden) + '</div></div>' : '';
    h += sec('Training: Einstieg', p(tr.grundsatz) + gehtMeiden + ((tr.progression || []).length ? '<p style="margin-top:12px"><b>Schrittweise steigern</b></p>' + phasen(tr.progression, 'phase', 'inhalt') : '') + ((tr.warnzeichen || []).length ? '<p style="margin-top:12px"><b>Training stoppen und ärztlich abklären bei:</b></p>' + ul(tr.warnzeichen) : ''));
    var of = fragenHtml(r.offene_fragen, c);
    var frueher = frueherHtml(d, c);
    h += sec('Beim Kunden noch erfragen', of + frueher + (of ? aktionen() : ''));
    h += sec('Quellen', (r.quellen || []).length ? '<ul class="ib-src">' + r.quellen.filter(function (q) { return /^https?:\/\//.test(q.url); }).map(function (q) { return '<li><a href="' + esc(q.url) + '" target="_blank" rel="noopener noreferrer">' + esc(q.titel || q.url) + '</a></li>'; }).join('') + '</ul>' : '');
    h += '</div>';
    return h + hinweis(d) + '</div>';
  }
  function hinweis(d) {
    return '<p class="ib-fine">KI-Recherche' + (d.modell ? ' (' + esc(d.modell) + ')' : '') + ' vom ' + esc(ts(d.ausgewertet_am)) + '. Das ist eine Arbeitshilfe und keine ärztliche Beratung. Quellen bitte selbst gegenlesen; bei Widersprüchen gilt die Freigabe der behandelnden Ärztin bzw. des Arztes.</p>';
  }

  function kopieren(r) {
    if (!r) return;
    var z = [];
    function add(t, l) { if (l && (!Array.isArray(l) || l.length)) z.push(t + ':\n' + (Array.isArray(l) ? l.map(function (x) { return '- ' + x; }).join('\n') : l)); }
    if (r.roh) z.push(r.roh);
    else {
      var he = r.heilung || {}, tr = r.training || {}, wi = r.widerspruch || {}, st = r.studienlage || {};
      add('Das Wichtigste', r.kurzfassung);
      add('Widerspruch', [wi.beschreibung, wi.einordnung].filter(Boolean).join('\n'));
      add('Rückfragen an die Ärztin/den Arzt', wi.rueckfragen);
      add('Heilungsdauer', he.dauer); add('Stand heute', he.stand_heute);
      add('Studienlage', st.zusammenfassung);
      add('Training: Grundsatz', tr.grundsatz); add('Geht jetzt', tr.geht_jetzt); add('Vorerst meiden', tr.vorerst_meiden);
      add('Warnzeichen', tr.warnzeichen); add('Noch erfragen', r.offene_fragen);
      add('Quellen', (r.quellen || []).map(function (q) { return q.titel + ' ' + q.url; }));
    }
    var out = z.join('\n\n');
    (navigator.clipboard ? navigator.clipboard.writeText(out) : Promise.reject()).then(function () { A.note('Kopiert.'); }).catch(function () { A.note('Kopieren hat nicht geklappt.', true); });
  }
})();
