/* ================================================================== */
/* Kurskarte ohne feste Termine (5er/10er) + Mitgliederbereich          */
/* (neu in worker-code-25)                                              */
/* ================================================================== */
/*
 * Eine 5er- oder 10er-Karte hat keinen festen Termin mehr. Sie gilt für alle Kurse der
 * Anbieterin. Der Kunde bekommt einen Code (KK-XXXX-XXXX) und bucht seine Kurse einzeln
 * im Mitgliederbereich (mitglied.html) mit Code + E-Mail.
 *
 * KV: kurs:<p>:kurskarte:<XXXXXXXX>  →  { code, art, label, anzahl, korrektur, bis, kunde, order, created, genutzt: [] }
 *   genutzt[]: { bestellung, kurs, kurs_titel, datum, start, ende, at, status, ende_at }
 *   status: gebucht | freigegeben (Einheit zurück) | verfallen (zu spät abgesagt) | gutgeschrieben (Ausnahme)
 * Eine Einheit ist verbraucht bei "gebucht" und "verfallen".
 *
 * Absage: mehr als 24 Stunden vor Beginn → Einheit zurück. Später → Einheit verfällt.
 * In beiden Fällen wird der Platz frei (Warteliste rückt nach). Ausnahmen trägt der Admin ein.
 */

const KARTE_ABSAGE_H = 24;
const KARTE_FEHLER = 'Code und E-Mail-Adresse passen nicht zusammen. Bitte prüfe beides noch einmal.';

function kursKarteNorm(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^KK/, '').slice(0, 8);
}
function kursKarteAnzeige(norm) { return 'KK-' + norm.slice(0, 4) + '-' + norm.slice(4, 8); }

function kursKarteStand(card) {
  const genutzt = (card.genutzt || []).filter((g) => g.status === 'gebucht' || g.status === 'verfallen').length;
  const gesamt = Number(card.anzahl || 0) + Number(card.korrektur || 0);
  return { gesamt, genutzt, frei: Math.max(0, gesamt - genutzt) };
}

async function kursKarteLesen(env, p, norm) {
  if (!norm || norm.length !== 8) return null;
  const raw = await env.VOUCHERS.get(K.kurskarte(p.id, norm));
  return raw ? JSON.parse(raw) : null;
}
async function kursKarteSpeichern(env, p, card) {
  await kursPut(env, K.kurskarte(p.id, card.norm), JSON.stringify(card));
}

/** Zu viele falsche Versuche von einer Adresse? (Schutz gegen Raten) */
async function kursKarteBremse(env, request, p, falsch) {
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'x';
  const key = `kurs:${p.id}:kkfehl:${ip}`;
  let n = 0;
  try { n = Number(await env.VOUCHERS.get(key)) || 0; } catch (e) { /* egal */ }
  if (!falsch) return n >= 15;
  try { await kursPut(env, key, String(n + 1), { expirationTtl: 900 }); } catch (e) { /* egal */ }
  return n + 1 >= 15;
}

/** Karte per Code + E-Mail öffnen. */
async function kursKarteOeffnen(env, request, p, body) {
  if (await kursKarteBremse(env, request, p, false)) return { error: 'Zu viele Versuche. Bitte warte ein paar Minuten.', status: 429 };
  const norm = kursKarteNorm(body.code);
  const email = String(body.email || '').trim().toLowerCase();
  const card = await kursKarteLesen(env, p, norm);
  if (!card || !email || String(card.kunde.email).toLowerCase() !== email) {
    await kursKarteBremse(env, request, p, true);
    return { error: KARTE_FEHLER, status: 401 };
  }
  return { card };
}

async function kursKarteSicht(env, p, card) {
  const now = Date.now();
  const st = kursKarteStand(card);
  const buchungen = [];
  for (const g of (card.genutzt || []).slice().sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start))) {
    const startMs = berlinToUtc(g.datum, g.start || '00:00').getTime();
    const aktiv = g.status === 'gebucht';
    const o = await kursGetBestellung(env, p.id, g.bestellung);
    buchungen.push({
      bestellung: g.bestellung, token: o ? o.token : '', kurs: g.kurs, kurs_titel: g.kurs_titel, datum: g.datum, start: g.start, ende: g.ende,
      status: g.status, vorbei: startMs <= now,
      absagen: aktiv && startMs > now,
      mit_gutschrift: aktiv && startMs - now >= KARTE_ABSAGE_H * 3600e3,
    });
  }
  return {
    ok: true, code: card.code, art: card.art, label: card.label, anzahl: st.gesamt, genutzt: st.genutzt, frei: st.frei,
    bis: card.bis, name: card.kunde.name, abgelaufen: card.bis < kursHeute(now),
    absage_stunden: KARTE_ABSAGE_H, buchungen,
  };
}

/* ---------------- Kauf ---------------- */

async function kursKarteCheckout(env, p, body) {
  const art = String(body.art || '');
  const person = kursPerson(body);
  if (person.error) return kursFehler(person.error);
  if (body.vorzeitig !== true) return kursFehler('Bitte bestätige, dass die Leistung schon vor Ablauf der Widerrufsfrist beginnen darf.');
  const s = await kursSettings(env, p.id);
  const c = s.karten[art];
  if (!c) return kursFehler('Diese Karte gibt es nicht.');
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const preis = c.cents;

  let gutschein = null;
  if (body.gutschein) {
    const g = await kursGutscheinPruefen(env, p, body.gutschein, preis);
    if (g.error) return kursFehler(g.error);
    if (g.cents > 0) gutschein = { code: g.code, cents: g.cents };
  }
  const offen = preis - (gutschein ? gutschein.cents : 0);
  const o = {
    id: randomToken(16), token: randomToken(24), provider: p.id, art, label: c.label, flex: true, anzahl: c.termine,
    kurs: '', kurs_titel: 'Alle Kurse', termine: [],
    preis_cents: preis, gutschein, offen_cents: offen,
    status: offen > 0 ? 'reserviert' : 'bestaetigt',
    kunde: person, created: stamp,
    gueltig_bis: addMonths(kursHeute(now), s.gueltig_monate),
    widerruf_ausgeschlossen: false, vorzeitig_at: stamp, texte_version: KURS_TEXTE.version, hold: '', erstattungen: [],
  };

  if (offen <= 0) {
    await kursPutBestellung(env, p.id, o);
    await kursKarteBezahlt(env, p, o, null);
    return json({ status: 'confirmed', o: o.id, t: o.token });
  }
  await kursPutBestellung(env, p.id, o);
  const session = await kursCheckout(env, p, kursStripeParamsKarte(p, o, s), PAY_TYPES);
  if (!session || !session.url) {
    o.status = 'abgebrochen';
    await kursPutBestellung(env, p.id, o);
    return kursFehler('Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.', 502);
  }
  o.stripe_session = session.id;
  await kursPutBestellung(env, p.id, o);
  return json({ status: 'payment', url: session.url });
}

function kursStripeParamsKarte(p, o, s) {
  const q = new URLSearchParams();
  q.set('mode', 'payment');
  q.set('locale', 'de');
  q.set('submit_type', 'book');
  q.set('customer_email', o.kunde.email);
  q.set('success_url', `${p.site}/kurs-buchung.html?p=${p.id}&session_id={CHECKOUT_SESSION_ID}`);
  q.set('cancel_url', `${p.site}/kurs-buchen.html?p=${p.id}&abgebrochen=1`);
  q.set('line_items[0][quantity]', '1');
  q.set('line_items[0][price_data][currency]', 'eur');
  q.set('line_items[0][price_data][unit_amount]', String(o.offen_cents));
  q.set('line_items[0][price_data][product_data][name]', `${o.label} für Kurse · ${p.name}`);
  q.set('line_items[0][price_data][product_data][description]',
    (`${o.anzahl} Kurstermine nach freier Wahl, ${s.gueltig_monate} Monate gültig` +
      (o.gutschein ? ` · Gutschein ${o.gutschein.code} über ${fmtEur(o.gutschein.cents)} angerechnet` : '')).slice(0, 900));
  q.set('payment_intent_data[description]', `Kurskarte ${o.label} (${p.name})`);
  if (p.kontoauszug) q.set('payment_intent_data[statement_descriptor_suffix]', p.kontoauszug.slice(0, 22));
  q.set('payment_intent_data[metadata][kind]', 'kurs');
  q.set('payment_intent_data[metadata][anbieterin]', p.id);
  q.set('invoice_creation[enabled]', 'true');
  q.set('customer_creation', 'always');
  q.set('billing_address_collection', 'required');
  q.set('invoice_creation[invoice_data][description]',
    `${o.label} – ${o.anzahl} Kurstermine nach freier Wahl. Anbieterin: ${p.name}.`.slice(0, 1500));
  if (p.rechnung_fuss) q.set('invoice_creation[invoice_data][footer]', p.rechnung_fuss);
  q.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Anbieterin');
  q.set('invoice_creation[invoice_data][custom_fields][0][value]', `${p.name}${p.marke ? ' – ' + p.marke : ''}`.slice(0, 140));
  q.set('invoice_creation[invoice_data][custom_fields][1][name]', 'Karte gültig bis');
  q.set('invoice_creation[invoice_data][custom_fields][1][value]', fmtDate(o.gueltig_bis));
  q.set('metadata[kind]', 'kurs');
  q.set('metadata[provider]', p.id);
  q.set('metadata[order]', o.id);
  q.set('metadata[kurs]', '');
  q.set('metadata[buyer_name]', o.kunde.name);
  q.set('expires_at', String(Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60));
  return q;
}

/** Nach Zahlung (Webhook) oder Vollzahlung mit Gutschein: Karte anlegen, Mails. */
async function kursKarteBezahlt(env, p, o, session) {
  if (o.karte_code && o.status === 'bestaetigt') return;
  let norm = '';
  for (let i = 0; i < 5 && !norm; i++) {
    const cand = randomChars(8);
    if (!(await kursKarteLesen(env, p, cand))) norm = cand;
  }
  if (!norm) throw new Error('Kartencode konnte nicht erzeugt werden');
  const card = {
    norm, code: kursKarteAnzeige(norm), art: o.art, label: o.label, anzahl: o.anzahl, korrektur: 0,
    bis: o.gueltig_bis, kunde: o.kunde, order: o.id, created: new Date().toISOString(), genutzt: [],
  };
  await kursKarteSpeichern(env, p, card);
  o.status = 'bestaetigt';
  o.bezahlt_at = new Date().toISOString();
  o.karte_code = card.code;
  if (session) {
    o.stripe_session = session.id;
    o.payment_intent = session.payment_intent || '';
    o.pay_status = session.payment_status || 'paid';
  }
  await kursPutBestellung(env, p.id, o);
  if (session) await kursPut(env, K.session(p.id, session.id), o.id, { expirationTtl: 60 * 60 * 24 * 90 });
  try {
    const g = await kursGutscheinBelasten(env, o);
    if (!g.ok) { o.gutschein_problem = `Auf dem Gutschein waren nur noch ${fmtEur(g.cents)} statt ${fmtEur(o.gutschein.cents)}.`; await kursPutBestellung(env, p.id, o); }
  } catch (err) { console.error('Gutschein belasten', err); }
  try { await kursKundeMerken(env, p.id, o.kunde, o.id); } catch (err) { console.error('Kundenprofil', err); }
  try { await kursMailKarte(env, p, o, card); } catch (err) { console.error('Karten-Mail', err); }
  try { await kursMailKarteInhaber(env, p, o, card); } catch (err) { console.error('Karten-Inhabermail', err); }
}

function kursPortalLink(p, card) {
  return `${p.site}/mitglied.html?p=${p.id}&code=${encodeURIComponent(card.code)}`;
}

async function kursMailKarte(env, p, o, card) {
  const rows =
    row('Karte', esc(o.label)) +
    row('Einheiten', String(card.anzahl)) +
    row('Gültig bis', fmtDate(card.bis)) +
    (o.gutschein && o.gutschein.cents ? row('Gutschein', `${esc(o.gutschein.code)} &middot; ${fmtEur(o.gutschein.cents)} angerechnet`) : '') +
    row('Bezahlt', o.offen_cents > 0 ? fmtEur(o.offen_cents) : 'bereits beglichen');
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(o.kunde.name))},</p>
    <p style="margin:0 0 20px">deine ${esc(o.label)} ist da. Du hast keine festen Termine: Du suchst dir die Kurse aus, wann es dir passt.</p>
    <div style="border:1px solid #EFB92E;background:#1B1D24;padding:18px;text-align:center;margin:0 0 22px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9AA0AB;margin-bottom:6px">Dein Kartencode</div>
      <div style="font-size:28px;font-weight:700;letter-spacing:.08em;color:#EFB92E">${esc(card.code)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px">${rows}</table>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(kursPortalLink(p, card))}" style="${KM_BTN}">Jetzt Kurse buchen</a></p>
    <p style="${KM_KLEIN}"><b style="color:#ECE9E2">So geht es:</b> Im Mitgliederbereich meldest du dich mit deinem Code und dieser E-Mail-Adresse an und buchst die Kurse, die du magst. Karten haben Vorrang vor Einzeltickets: Du kannst jeden Kurs buchen, solange Plätze frei sind, auch bevor Einzeltickets freigeschaltet werden.</p>
    <p style="${KM_KLEIN}"><b style="color:#ECE9E2">Absagen:</b> Sagst du bis ${KARTE_ABSAGE_H} Stunden vor Kursbeginn ab, wird die Einheit wieder auf deine Karte gutgeschrieben. Bei späterer Absage oder wenn du nicht kommst, verfällt sie. Ausnahmen sind nach Absprache möglich.</p>
    <p style="${KM_KLEIN}">Bewahre diese Mail auf, sie enthält deinen Code.</p>
    ${kursWiderrufHtml(env, p, o)}`;
  await kursSendMail(env, p, {
    to: o.kunde.email,
    subject: `Deine ${o.label} – Code ${card.code}`,
    html: kursShell(env, p, 'Deine Kurskarte', inner, `${o.label} · Code ${card.code}`),
  });
}

async function kursMailKarteInhaber(env, p, o, card) {
  const rows =
    row('Karte', esc(o.label)) + row('Code', esc(card.code)) + row('Name', esc(o.kunde.name)) + row('E-Mail', esc(o.kunde.email)) +
    (o.kunde.phone ? row('Telefon', esc(o.kunde.phone)) : '') +
    row('Bezahlt', o.offen_cents > 0 ? fmtEur(o.offen_cents) + (o.pay_status === 'unpaid' ? ' · Lastschrift läuft' : '') : '0 €') +
    (o.gutschein && o.gutschein.cents ? row('Gutschein', `${esc(o.gutschein.code)} · ${fmtEur(o.gutschein.cents)}`) : '') +
    row('Gültig bis', fmtDate(card.bis));
  await kursSendMail(env, p, {
    to: p.email || config(env).ownerEmail,
    subject: `Kurskarte verkauft: ${o.label} – ${o.kunde.name}`,
    html: kursShell(env, p, 'Kurskarte verkauft', `<table style="width:100%;border-collapse:collapse">${rows}</table>`),
  });
}

/* ---------------- Buchen mit Karte ---------------- */

async function kursKarteStatusRoute(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const r = await kursKarteOeffnen(env, request, p, body);
  if (r.error) return kursFehler(r.error, r.status);
  return json(await kursKarteSicht(env, p, r.card));
}

async function kursKarteBuchen(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const r = await kursKarteOeffnen(env, request, p, body);
  if (r.error) return kursFehler(r.error, r.status);
  const norm = r.card.norm;
  const s = await kursSettings(env, p.id);
  const kurs = await kursFind(env, p.id, clean(body.kurs, 40));
  if (!kurs || !kurs.aktiv) return kursFehler('Diesen Kurs gibt es nicht (mehr).', 404);
  const eff = kursEffektiv(kurs, s);
  const datum = String(body.datum || '').slice(0, 10);
  const t = kursTerminAm(kurs, datum);
  if (!t || t.ausfall || !kursBuchbar(t, s.buchungsschluss_min)) return kursFehler('Diesen Termin kann man nicht (mehr) buchen.');

  let ergebnis;
  try {
    ergebnis = await kursMitSperre(env, p.id, 'kk-' + norm, async () => {
      const card = await kursKarteLesen(env, p, norm);
      const st = kursKarteStand(card);
      if (card.bis < kursHeute()) return { fehler: `Deine ${card.label} ist am ${fmtDate(card.bis)} abgelaufen.` };
      if (datum > card.bis) return { fehler: `Deine ${card.label} gilt bis ${fmtDate(card.bis)}. Dieser Termin liegt danach.` };
      if (st.frei < 1) return { fehler: `Alle Einheiten deiner ${card.label} sind verbraucht.` };
      if ((card.genutzt || []).some((g) => g.kurs === kurs.id && g.datum === datum && g.status === 'gebucht')) {
        return { fehler: 'Für diesen Termin hast du schon einen Platz.' };
      }
      const person = card.kunde;
      const now = new Date().toISOString();
      const o = {
        id: randomToken(16), token: randomToken(24), provider: p.id, art: 'kartebuchung', label: `Karte ${card.code}`,
        kurs: kurs.id, kurs_titel: kurs.titel, termine: [datum], preis_cents: 0, gutschein: null, offen_cents: 0,
        status: 'bestaetigt', kunde: person, created: now, bezahlt_at: now, gueltig_bis: card.bis,
        karte_code: card.code, widerruf_ausgeschlossen: false, erstattungen: [],
      };
      let res;
      try {
        res = await kursPlaetzeReservieren(env, p, kurs, eff, [t], [{
          order: o.id, quelle: 'karte', status: 'gebucht', bis: 0, name: person.name, email: person.email, phone: person.phone,
          wert_cents: 0, wert_gutschein_cents: 0, karte_code: card.code,
        }], {});
      } catch (err) { return { fehler: err.message, status: err.status || 500 }; }
      if (res.error) return { fehler: res.voll ? 'Dieser Termin ist leider ausgebucht. Du kannst dich auf die Warteliste setzen.' : res.error, status: 409, voll: !!res.voll };
      card.genutzt = card.genutzt || [];
      card.genutzt.push({ bestellung: o.id, kurs: kurs.id, kurs_titel: kurs.titel, datum, start: t.start, ende: t.ende, at: now, status: 'gebucht' });
      await kursKarteSpeichern(env, p, card);
      await kursPutBestellung(env, p.id, o);
      return { o, card };
    });
  } catch (err) { return kursFehler(err.message, err.status || 500); }
  if (ergebnis.fehler) return kursFehler(ergebnis.fehler, ergebnis.status || 400);
  ctx.waitUntil(kursNachKauf(env, p, kurs, ergebnis.o).catch((e) => console.error('Karten-Nachkauf', e)));
  return json(await kursKarteSicht(env, p, ergebnis.card));
}

/* ---------------- Absagen mit Karte ---------------- */

/**
 * Platz einer Kartenbuchung freigeben. Mehr als 24 h vor Beginn: Einheit zurück. Sonst: verfällt.
 * Der Platz selbst wird in beiden Fällen frei.
 */
async function kursKarteAbsagenIntern(env, p, norm, bestellId, ctx) {
  const kurs0 = await (async () => {
    const o = await kursGetBestellung(env, p.id, bestellId);
    return o ? kursFind(env, p.id, o.kurs) : null;
  })();
  if (!kurs0) return { fehler: 'Diesen Kurs gibt es nicht mehr.', status: 404 };
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs0, s);
  let datum = '';
  let ausgang;
  try {
    ausgang = await kursMitSperre(env, p.id, 'kk-' + norm, async () => {
      const card = await kursKarteLesen(env, p, norm);
      const g = (card.genutzt || []).find((x) => x.bestellung === bestellId);
      if (!g || g.status !== 'gebucht') return { fehler: 'Dieser Platz ist nicht (mehr) gebucht.', status: 409 };
      const t = kursTerminAm(kurs0, g.datum) || { datum: g.datum, start: g.start, ende: g.ende };
      const startMs = kursStartMs(t);
      const now = Date.now();
      if (startMs <= now) return { fehler: 'Der Kurs hat schon begonnen.', status: 409 };
      const mitGutschrift = startMs - now >= KARTE_ABSAGE_H * 3600e3;
      datum = g.datum;
      await kursMitSperre(env, p.id, kurs0.id, async () => {
        const doc = await kursGetTermin(env, p.id, kurs0.id, g.datum);
        const seat = kursSitzDerBestellung(doc, bestellId, false);
        if (seat && seat.status === 'gebucht') {
          seat.status = 'freigegeben';
          seat.freigegeben_at = new Date(now).toISOString();
          await kursPutTermin(env, p.id, doc);
        }
      });
      g.status = mitGutschrift ? 'freigegeben' : 'verfallen';
      g.ende_at = new Date(now).toISOString();
      await kursKarteSpeichern(env, p, card);
      return { card, g, mitGutschrift };
    });
  } catch (err) { return { fehler: err.message, status: err.status || 500 }; }
  if (ausgang.fehler) return ausgang;
  if (ctx) ctx.waitUntil(kursNachruecken(env, p, kurs0, eff, s, datum).catch((e) => console.error(e)));
  try { await kursMailKarteAbsage(env, p, ausgang.card, ausgang.g, ausgang.mitGutschrift); } catch (err) { console.error('Absage-Mail', err); }
  return ausgang;
}

async function kursKarteAbsagenRoute(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const r = await kursKarteOeffnen(env, request, p, body);
  if (r.error) return kursFehler(r.error, r.status);
  const a = await kursKarteAbsagenIntern(env, p, r.card.norm, clean(body.bestellung, 40), ctx);
  if (a.fehler) return kursFehler(a.fehler, a.status || 400);
  return json({ ...(await kursKarteSicht(env, p, a.card)), einheit_zurueck: a.mitGutschrift });
}

async function kursMailKarteAbsage(env, p, card, g, mitGutschrift) {
  const st = kursKarteStand(card);
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(card.kunde.name))},</p>
    <p style="margin:0 0 20px">dein Platz bei <b>${esc(g.kurs_titel)}</b> am ${esc(kursDatumLang(g.datum))}, ${esc(g.start)} Uhr, ist freigegeben.</p>
    <p style="margin:0 0 20px">${mitGutschrift
      ? `Du hast rechtzeitig abgesagt, die Einheit steht wieder auf deiner Karte. Es sind jetzt <b>${st.frei}</b> von ${st.gesamt} Einheiten frei.`
      : `Die Absage kam weniger als ${KARTE_ABSAGE_H} Stunden vor Kursbeginn, deshalb verfällt die Einheit. Es sind noch <b>${st.frei}</b> von ${st.gesamt} Einheiten frei. Wenn es einen besonderen Grund gibt, schreib mir kurz, dann finden wir eine Lösung.`}</p>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(kursPortalLink(p, card))}" style="${KM_BTN}">Neuen Kurs buchen</a></p>`;
  await kursSendMail(env, p, {
    to: card.kunde.email,
    subject: mitGutschrift ? 'Platz freigegeben – Einheit gutgeschrieben' : 'Platz freigegeben – Einheit verfallen',
    html: kursShell(env, p, 'Platz freigegeben', inner, `${g.kurs_titel} · ${g.datum}`),
  });
}

/* ---------------- Ansicht nach dem Kauf ---------------- */

function kursKarteBestellSicht(p, o) {
  return {
    status: 'confirmed', flex: true, o: o.id, t: o.token, code: o.karte_code, art: o.art, label: o.label, anzahl: o.anzahl,
    name: o.kunde.name, preis_cents: o.preis_cents, offen_cents: o.offen_cents,
    gutschein: o.gutschein ? { code: o.gutschein.code, cents: o.gutschein.cents } : null,
    gueltig_bis: o.gueltig_bis, widerruf_ausgeschlossen: false, anbieterin: kursProviderPublic(p),
    portal: `${p.site}/mitglied.html?p=${p.id}&code=${encodeURIComponent(o.karte_code || '')}`,
  };
}

/* ---------------- Verwaltung ---------------- */

async function kursAdminKarten(env, p) {
  const out = [];
  let cursor;
  do {
    const l = await env.VOUCHERS.list({ prefix: K.kurskartePrefix(p.id), cursor });
    for (const k of l.keys) {
      const raw = await env.VOUCHERS.get(k.name);
      if (!raw) continue;
      const c = JSON.parse(raw);
      const st = kursKarteStand(c);
      out.push({
        code: c.code, label: c.label, name: c.kunde.name, email: c.kunde.email, anzahl: c.anzahl, korrektur: c.korrektur || 0,
        frei: st.frei, genutzt: st.genutzt, bis: c.bis, created: c.created,
        buchungen: (c.genutzt || []).map((g) => ({ bestellung: g.bestellung, kurs_titel: g.kurs_titel, datum: g.datum, start: g.start, status: g.status })),
      });
    }
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return json({ karten: out });
}

/** Ausnahmen: Einheit gutschreiben/abziehen, verfallene Buchung gutschreiben, Laufzeit verlängern. */
async function kursAdminKarteAktion(env, p, body) {
  const norm = kursKarteNorm(body.code);
  const aktion = String(body.aktion || '');
  let fehler = '';
  await kursMitSperre(env, p.id, 'kk-' + norm, async () => {
    const card = await kursKarteLesen(env, p, norm);
    if (!card) { fehler = 'Diese Karte gibt es nicht.'; return; }
    if (aktion === 'gutschreiben') card.korrektur = Number(card.korrektur || 0) + 1;
    else if (aktion === 'abziehen') card.korrektur = Number(card.korrektur || 0) - 1;
    else if (aktion === 'eintrag-gutschreiben') {
      const g = (card.genutzt || []).find((x) => x.bestellung === clean(body.bestellung, 40));
      if (!g || g.status !== 'verfallen') { fehler = 'Dieser Eintrag ist nicht verfallen.'; return; }
      g.status = 'gutgeschrieben';
      g.ende_at = new Date().toISOString();
    } else if (aktion === 'verlaengern') {
      const monate = Math.max(1, Math.min(24, Number(body.monate) || 1));
      card.bis = addMonths(card.bis, monate);
    } else { fehler = 'Unbekannte Aktion.'; return; }
    card.notizen = (card.notizen || []).concat([{ at: new Date().toISOString(), aktion, notiz: clean(body.notiz, 200) }]).slice(-30);
    await kursKarteSpeichern(env, p, card);
  });
  if (fehler) return kursErr(fehler, 400);
  return kursAdminKarten(env, p);
}
