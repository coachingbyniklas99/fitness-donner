
/* ------------------------------------------------------------------ */
/* KUNDE2 – Kunden ohne E-Mail, Stammdaten, Zahler und trainierte Person, */
/*          Kartenverkauf per Zahlungslink (Apple Pay)                    */
/* ------------------------------------------------------------------ */
/*
 * Ein Kunde ohne E-Mail bekommt einen internen Schlüssel „k-xxxx@kunde.invalid“. Er taucht nirgends als Adresse auf
 * (Anzeige = Name), und an so einen Schlüssel geht nie eine Mail (sendMail leitet um: eigene echte Adresse → Adresse des
 * Zahlers → sonst nichts).
 *
 * KV:  kundendaten:<schlüssel>   Stammdaten (Name, Vorname, Nachname, Geburtsdatum, Telefon, E-Mail, Adresse, Zahler)
 *      kdvorschlag:<kartencode>  Vorschlag aus der Zahlung (Name/Adresse/E-Mail des Zahlenden), wartet auf Bestätigung
 * Verwaltung: POST kunde2/anlegen · daten · loeschen · karte-link · vorschlag   GET kunde2/karte-status
 *             (kunden/liste und kunden/profil werden ergänzt)
 */

const KUNDE2_INTERN = /@kunde\.invalid$/i;
function kundeIstIntern(e) { return KUNDE2_INTERN.test(String(e || '').trim()); }
function kundeDatenKey(k) { return `kundendaten:${String(k || '').trim().toLowerCase()}`; }
function kundeNeuerKey() {
  const r = String(randomToken(10) || '').replace(/[^a-z0-9]/g, '');
  return `k-${r || Date.now().toString(36)}@kunde.invalid`;
}

async function kundeDatenLaden(env, key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return null;
  try { const raw = await env.VOUCHERS.get(kundeDatenKey(k)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
async function kundeDatenAlle(env) {
  const out = new Map();
  for (const x of await kundenGetMany(env, await kundenListAll(env, 'kundendaten:'))) if (x.v && x.v.key) out.set(x.v.key, x.v);
  return out;
}
async function kundeDatenSchreiben(env, d) {
  d.geaendert = new Date().toISOString();
  await env.VOUCHERS.put(kundeDatenKey(d.key), JSON.stringify(d));
  return d;
}

/** An wen geht eine Mail für diesen Kunden wirklich? Echte Adresse: dieselbe. Interner Schlüssel: eigene Adresse, sonst Zahler, sonst niemand (''). */
async function kundeMailZiel(env, to) {
  const e = String(to || '').trim().toLowerCase();
  if (!kundeIstIntern(e)) return to;
  const d = await kundeDatenLaden(env, e);
  if (d && d.email && isEmail(d.email) && !kundeIstIntern(d.email)) return d.email;
  const z = d && d.zahler ? String(d.zahler).trim().toLowerCase() : '';
  if (z) {
    if (!kundeIstIntern(z)) return z;
    const zd = await kundeDatenLaden(env, z);
    if (zd && zd.email && isEmail(zd.email) && !kundeIstIntern(zd.email)) return zd.email;
  }
  return '';
}

function kundeNameTeilen(voll) {
  const t = clean(voll, 80).split(/\s+/).filter(Boolean);
  if (t.length < 2) return { vorname: '', nachname: t[0] || '' };
  return { vorname: t.slice(0, -1).join(' '), nachname: t[t.length - 1] };
}
function kundeDatumOk(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return s >= '1900-01-01' && s <= isoDate(new Date());
}

/** Liest die Felder aus dem Formular auf einen bestehenden (oder neuen) Datensatz. { error } bei Fehler. */
function kundeFelder(body, alt) {
  const r = Object.assign({}, alt);
  const f = (name, max) => { if (body[name] !== undefined) r[name] = clean(body[name], max); };
  f('name', 80); f('vorname', 60); f('nachname', 60); f('telefon', 40);
  f('strasse', 120); f('ort', 60);
  if (body.plz !== undefined) {
    const p = clean(body.plz, 10);
    if (p && !/^[0-9A-Za-z -]{3,10}$/.test(p)) return { error: 'Die Postleitzahl sieht nicht richtig aus.' };
    r.plz = p;
  }
  if (body.land !== undefined) {
    const l = clean(body.land, 2).toUpperCase();
    if (l && !/^[A-Z]{2}$/.test(l)) return { error: 'Bitte das Land mit zwei Buchstaben angeben (zum Beispiel DE).' };
    r.land = l || 'DE';
  }
  if (body.geburtsdatum !== undefined) {
    const g = String(body.geburtsdatum || '').trim();
    if (g && !kundeDatumOk(g)) return { error: 'Das Geburtsdatum sieht nicht richtig aus.' };
    r.geburtsdatum = g;
  }
  if (body.email !== undefined) {
    const e = String(body.email || '').trim().toLowerCase();
    if (e && (!isEmail(e) || kundeIstIntern(e))) return { error: 'Bitte eine gültige E-Mail-Adresse angeben.' };
    r.email = e;
  }
  if (!r.name && (r.vorname || r.nachname)) r.name = clean(`${r.vorname || ''} ${r.nachname || ''}`, 80);
  if (!r.name) return { error: 'Bitte einen Namen angeben (zum Beispiel „Frau Palassos“).' };
  return { rec: r };
}

/** Echte E-Mail als weitere Adresse dieses Kunden zuordnen (Zuordnungstabelle kunden:alias, wie „Zusammenführen“). */
async function kundeAliasSetzen(env, von, nach) {
  await kundenAliasLaden(env);
  von = String(von || '').trim().toLowerCase();
  if (!von || von === nach) return '';
  if (KUNDEN_ALIAS.get(von) === nach) return '';
  if (KUNDEN_ALIAS.has(von)) return 'Diese E-Mail-Adresse ist schon einem anderen Kunden zugeordnet.';
  const obj = Object.fromEntries(KUNDEN_ALIAS);
  for (const k of Object.keys(obj)) if (obj[k] === von) obj[k] = nach;
  obj[von] = nach;
  await env.VOUCHERS.put('kunden:alias', JSON.stringify(obj));
  await kundenAliasLaden(env);
  return '';
}
async function kundeAliasLoesen(env, von, nach) {
  await kundenAliasLaden(env);
  von = String(von || '').trim().toLowerCase();
  if (!von || KUNDEN_ALIAS.get(von) !== nach) return;
  const obj = Object.fromEntries(KUNDEN_ALIAS);
  delete obj[von];
  await env.VOUCHERS.put('kunden:alias', JSON.stringify(obj));
  await kundenAliasLaden(env);
}

/** Zahler prüfen: gültiger Schlüssel, nicht man selbst, keine Schleife. Gibt { zahler } oder { error } zurück. */
async function kundeZahlerPruefen(env, key, wert) {
  const z0 = String(wert || '').trim().toLowerCase();
  if (!z0) return { zahler: '' };
  if (!isEmail(z0)) return { error: 'Der Zahler ist ungültig.' };
  const z = kundenMail(z0);
  if (z === key) return { error: 'Ein Kunde kann nicht sein eigener Zahler sein.' };
  const zd = await kundeDatenLaden(env, z);
  if (zd && zd.zahler && kundenMail(zd.zahler) === key) return { error: 'Dieser Kunde zahlt schon für die Person, die du als Zahler wählst.' };
  return { zahler: z };
}

/* ---- Anlegen / Ändern / Löschen ---- */

async function kundeAnlegen(body, env) {
  await kundenAliasLaden(env);
  const e0 = String(body.email || '').trim().toLowerCase();
  if (e0 && (!isEmail(e0) || kundeIstIntern(e0))) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const key = e0 ? kundenMail(e0) : kundeNeuerKey();
  if (await kundeDatenLaden(env, key)) return json({ error: 'Diesen Kunden gibt es schon.', key, vorhanden: true }, 409);
  const felder = Object.assign({}, body);
  if (!kundeIstIntern(key)) delete felder.email;   // echte Adresse ist schon der Schlüssel
  const x = kundeFelder(felder, { key, created: new Date().toISOString(), land: 'DE' });
  if (x.error) return json({ error: x.error }, 400);
  const z = await kundeZahlerPruefen(env, key, body.zahler);
  if (z.error) return json({ error: z.error }, 400);
  const rec = x.rec;
  rec.zahler = z.zahler;
  rec.zahler_name = z.zahler ? clean(body.zahler_name, 80) : '';
  if (kundeIstIntern(key) && rec.email) {
    if (await kundeDatenLaden(env, rec.email)) return json({ error: 'Für diese E-Mail-Adresse gibt es schon einen angelegten Kunden.' }, 409);
    const err = await kundeAliasSetzen(env, rec.email, key);
    if (err) return json({ error: err }, 400);
  }
  await kundeDatenSchreiben(env, rec);
  return json({ ok: true, key, intern: kundeIstIntern(key) });
}

async function kundeDatenSetzen(body, env) {
  await kundenAliasLaden(env);
  const key = kundenMail(String(body.key || ''));
  if (!isEmail(key)) return json({ error: 'Unbekannter Kunde.' }, 400);
  const alt = (await kundeDatenLaden(env, key)) || { key, created: new Date().toISOString(), land: 'DE' };
  const felder = Object.assign({}, body);
  if (!kundeIstIntern(key)) delete felder.email;
  if (!alt.name && !felder.name && !felder.vorname && !felder.nachname) felder.name = clean(body.fallback_name, 80);
  const x = kundeFelder(felder, alt);
  if (x.error) return json({ error: x.error }, 400);
  const rec = x.rec;
  if (body.zahler !== undefined) {
    const z = await kundeZahlerPruefen(env, key, body.zahler);
    if (z.error) return json({ error: z.error }, 400);
    rec.zahler = z.zahler;
    rec.zahler_name = z.zahler ? clean(body.zahler_name, 80) : '';
  }
  if (kundeIstIntern(key)) {
    const neu = rec.email || '', alte = alt.email || '';
    if (neu && neu !== alte) {
      if (await kundeDatenLaden(env, neu)) return json({ error: 'Für diese E-Mail-Adresse gibt es schon einen angelegten Kunden.' }, 409);
      const err = await kundeAliasSetzen(env, neu, key);
      if (err) return json({ error: err }, 400);
    }
    if (alte && alte !== neu) await kundeAliasLoesen(env, alte, key);
  } else rec.email = '';
  await kundeDatenSchreiben(env, rec);
  return json({ ok: true, daten: rec });
}

async function kundeLoeschen(body, env) {
  await kundenAliasLaden(env);
  const key = kundenMail(String(body.key || ''));
  if (!isEmail(key)) return json({ error: 'Unbekannter Kunde.' }, 400);
  const d = await kundeDatenLaden(env, key);
  if (!d) return json({ error: 'Dieser Kunde ist nicht von Hand angelegt, ich lösche ihn nicht.' }, 400);
  const scan = await kundenScan(env);
  const benutzt = scan.bookings.some((b) => kundenMail(b.email) === key)
    || scan.vouchers.some((v) => kundenMail(v.buyer_email) === key || kundenMail(v.gift_email) === key || kundenMail(v.person) === key)
    || scan.kurskunden.some((k) => kundenMail(k.email) === key)
    || [...KUNDEN_ALIAS.values()].some((n) => n === key);
  if (benutzt) return json({ error: 'Dieser Kunde hat schon Termine, Karten oder zugeordnete Adressen. Ich lösche ihn deshalb nicht.' }, 409);
  const alle = await kundeDatenAlle(env);
  if ([...alle.values()].some((x) => x.zahler && kundenMail(x.zahler) === key)) return json({ error: 'Dieser Kunde ist Zahler für jemand anderen. Bitte zuerst dort den Zahler entfernen.' }, 409);
  await env.VOUCHERS.delete(kundeDatenKey(key));
  await env.VOUCHERS.delete(`infobox:${key}`);
  return json({ ok: true });
}

/* ---- Liste und Profil ergänzen ---- */

async function kunde2Erweitern(path, url, request, env, body) {
  const r = await karteAdmin(path, url, request, env, body);
  if (!r) return path === 'kunden/liste' ? kundenListe(url, env) : kundenProfil(url, env);
  if (!r.ok) return r;
  const d = await r.json();
  await kundenAliasLaden(env);
  return json(path === 'kunden/liste' ? await kundeListeErgaenzen(d, url, env) : await kundeProfilErgaenzen(d, env));
}

async function kundeListeErgaenzen(d, url, env) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const alle = await kundeDatenAlle(env);
  const da = new Set();
  for (const c of d.kunden) {
    da.add(c.email);
    c.intern = kundeIstIntern(c.email);
    const x = alle.get(c.email);
    if (x) { if (x.name) c.name = x.name; if (!c.phone && x.telefon) c.phone = x.telefon; }
  }
  for (const [k, x] of alle) {
    if (da.has(k) || KUNDEN_ALIAS.has(k)) continue;
    if (q && `${x.name || ''} ${k} ${x.telefon || ''} ${x.email || ''}`.toLowerCase().indexOf(q) === -1) continue;
    d.kunden.push({ email: k, name: x.name || '', phone: x.telefon || '', termine: 0, kommend: '', karten: 0, kurse: 0, mails: 0, last: x.created || '', aktiv: false, offen: 0, intern: kundeIstIntern(k) });
    d.total = (d.total || 0) + 1;
  }
  return d;
}

async function kundeProfilErgaenzen(d, env) {
  const key = d.email;
  const daten = await kundeDatenLaden(env, key);
  d.intern = kundeIstIntern(key);
  d.daten = daten ? {
    name: daten.name || '', vorname: daten.vorname || '', nachname: daten.nachname || '', geburtsdatum: daten.geburtsdatum || '', telefon: daten.telefon || '',
    email: daten.email || '', strasse: daten.strasse || '', plz: daten.plz || '', ort: daten.ort || '', land: daten.land || 'DE', zahler: daten.zahler || '',
  } : null;
  d.kontakt_email = d.intern ? ((daten && daten.email) || '') : key;
  if (daten) {
    if (daten.name) d.name = daten.name;
    if (!d.phone && daten.telefon) d.phone = daten.telefon;
  }
  d.zahler = null;
  if (daten && daten.zahler) {
    const zk = kundenMail(daten.zahler);
    const zd = await kundeDatenLaden(env, zk);
    d.zahler = { key: zk, name: (zd && zd.name) || daten.zahler_name || '', email: kundeIstIntern(zk) ? ((zd && zd.email) || '') : zk };
  }
  const alle = await kundeDatenAlle(env);
  d.zahlt_fuer = [...alle.values()].filter((x) => x.zahler && kundenMail(x.zahler) === key && !KUNDEN_ALIAS.has(x.key)).map((x) => ({ key: x.key, name: x.name || '' }));
  d.vorschlaege = [];
  for (const x of await kundenGetMany(env, await kundenListAll(env, 'kdvorschlag:'))) {
    const v = x.v;
    if (!v || v.status !== 'offen') continue;
    if (kundenMail(v.person) === key) d.vorschlaege.push(v);
  }
  return d;
}

/* ---- Karte per Zahlungslink verkaufen (Apple Pay, Karte, Lastschrift, PayPal) ---- */

async function kundeKarteLink(body, env) {
  await kundenAliasLaden(env);
  const key = kundenMail(String(body.key || ''));
  if (!isEmail(key)) return json({ error: 'Unbekannter Kunde.' }, 400);
  const daten = await kundeDatenLaden(env, key);
  const name = clean((daten && daten.name) || body.name, 80);
  if (!name) return json({ error: 'Bitte zuerst einen Namen eintragen.' }, 400);
  const cards = await liveCards(env);
  const card = cards[body.card];
  if (!card) return json({ error: 'Diese Karte gibt es nicht.' }, 400);
  const cfg = await liveConfig(env);
  const jetzt = new Date();

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('locale', 'de');
  params.set('success_url', `${cfg.siteOrigin}/karte-gekauft.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${cfg.siteOrigin}/`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(card.totalCents));
  params.set('line_items[0][price_data][product_data][name]', `${card.label} Personal Training`);
  params.set('line_items[0][price_data][product_data][description]', `${card.sessions} Einheiten à 60 Minuten, ${fmtEur(card.unitCents)} pro Einheit`);
  params.set('payment_intent_data[description]', `${card.label} (${card.sessions} Einheiten)`);
  params.set('invoice_creation[enabled]', 'true');
  params.set('customer_creation', 'always');
  params.set('billing_address_collection', 'required');
  params.set('invoice_creation[invoice_data][description]', `${card.label}: ${card.sessions} Einheiten Personal Training à ${fmtEur(card.unitCents)}`);
  params.set('invoice_creation[invoice_data][footer]', INVOICE_FOOTER_SERVICE);
  params.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Einlösbar bis');
  params.set('invoice_creation[invoice_data][custom_fields][0][value]', fmtDate(expiryDate(jetzt, 1)));
  params.set('metadata[kind]', 'karte');
  params.set('metadata[card]', body.card);
  params.set('metadata[buyer_name]', name);
  params.set('metadata[fd_person]', key);
  params.set('metadata[fd_person_name]', name);
  params.set('metadata[fd_quelle]', 'verwaltung-link');
  if (body.zustimmung === true) params.set('metadata[vorzeitig_at]', jetzt.toISOString());
  params.set('expires_at', String(Math.floor(jetzt.getTime() / 1000) + 23 * 3600));

  const session = await createCheckoutSession(env, params, PAY_TYPES);
  if (!session || !session.url) return json({ error: 'Der Zahlungslink konnte nicht erstellt werden. Bitte versuche es gleich noch einmal.' }, 502);
  return json({ ok: true, url: session.url, session: session.id, label: card.label, cents: card.totalCents });
}

async function kundeKarteStatus(url, env) {
  const id = String(url.searchParams.get('session') || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: 'Unbekannte Zahlung.' }, 400);
  const code = await env.VOUCHERS.get(`session:${id}`);
  if (code) return json({ status: 'paid', code });
  const res = await karteStripeGet(env, `checkout/sessions/${id}`);
  if (!res.ok) return json({ error: 'Der Zahlungsstand lässt sich gerade nicht abfragen.' }, 502);
  const s = res.data || {};
  if (s.status === 'expired') return json({ status: 'expired' });
  if (s.status === 'complete') return json({ status: 'paid', code: '' });   // Zahlung da, Karte wird gerade angelegt
  return json({ status: 'open' });
}

/** Wird beim Anlegen einer Karte aus einer Zahlung aufgerufen (createCardFromSession, vor dem Speichern). */
async function kundeNachKartenkauf(session, rec, env) {
  const m = session.metadata || {};
  const person = String(m.fd_person || '').trim().toLowerCase();
  if (!person || !isEmail(person)) return;
  try {
    const cd = session.customer_details || {};
    const a = cd.address || {};
    rec.person = person;
    rec.person_name = clean(m.fd_person_name, 80);
    if (cd.name) rec.buyer_name = clean(cd.name, 80);   // zahlende Person, damit die Mail richtig anspricht
    const v = {
      code: rec.code, person, person_name: rec.person_name, status: 'offen', created: new Date().toISOString(),
      payer: {
        name: clean(cd.name, 80), email: String(cd.email || '').trim().toLowerCase(), telefon: clean(cd.phone, 40),
        strasse: clean([a.line1, a.line2].filter(Boolean).join(', '), 120), plz: clean(a.postal_code, 10), ort: clean(a.city, 60), land: clean(a.country, 2).toUpperCase() || 'DE',
      },
    };
    await env.VOUCHERS.put(`kdvorschlag:${rec.code}`, JSON.stringify(v));
  } catch (err) { console.error('Kunde2: Vorschlag aus Zahlung', err); }
}

/** Vorschlag aus der Zahlung übernehmen ('selbst' = die Person hat selbst bezahlt, 'zahler' = jemand anderes) oder verwerfen. */
async function kundeVorschlag(body, env) {
  await kundenAliasLaden(env);
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  const raw = code ? await env.VOUCHERS.get(`kdvorschlag:${code}`) : null;
  if (!raw) return json({ error: 'Diesen Vorschlag gibt es nicht (mehr).' }, 404);
  const v = JSON.parse(raw);
  if (v.status !== 'offen') return json({ error: 'Dieser Vorschlag ist schon erledigt.' }, 409);
  const wer = String(body.wer || '');
  if (wer === 'verwerfen') {
    v.status = 'verworfen'; v.erledigt = new Date().toISOString();
    await env.VOUCHERS.put(`kdvorschlag:${code}`, JSON.stringify(v));
    return json({ ok: true });
  }
  if (wer !== 'selbst' && wer !== 'zahler') return json({ error: 'Bitte wählen, wer bezahlt hat.' }, 400);
  const p = v.payer || {};
  const teil = kundeNameTeilen(p.name);
  const pk = kundenMail(v.person);
  const pe = String(p.email || '').trim().toLowerCase();
  const adresse = { strasse: p.strasse || '', plz: p.plz || '', ort: p.ort || '', land: p.land || 'DE' };

  if (wer === 'selbst') {
    const alt = (await kundeDatenLaden(env, pk)) || { key: pk, created: new Date().toISOString(), land: 'DE' };
    const rec = Object.assign({}, alt, adresse);
    if (p.name) { rec.name = clean(p.name, 80); rec.vorname = teil.vorname; rec.nachname = teil.nachname; }
    if (p.telefon && !rec.telefon) rec.telefon = p.telefon;
    if (kundeIstIntern(pk) && pe && isEmail(pe) && !kundeIstIntern(pe) && !rec.email) {
      if (pe !== pk && await kundeDatenLaden(env, pe)) return json({ error: 'Für die E-Mail-Adresse aus der Zahlung gibt es schon einen angelegten Kunden. Bitte führe die beiden über „Doppelter Kunde?“ zusammen.' }, 409);
      const err = await kundeAliasSetzen(env, pe, pk);
      if (err) return json({ error: err }, 400);
      rec.email = pe;
    }
    await kundeDatenSchreiben(env, rec);
  } else {
    if (!pe || !isEmail(pe) || kundeIstIntern(pe)) return json({ error: 'In der Zahlung steht keine E-Mail-Adresse. Bitte trage den Zahler selbst im Profil ein.' }, 400);
    const zk = kundenMail(pe);
    if (zk === pk) return json({ error: 'Die zahlende Person ist dieselbe wie die trainierte. Bitte „hat selbst bezahlt“ wählen.' }, 400);
    const zalt = (await kundeDatenLaden(env, zk)) || { key: zk, created: new Date().toISOString(), land: 'DE' };
    const zrec = Object.assign({}, zalt, adresse);
    if (p.name) { zrec.name = clean(p.name, 80); zrec.vorname = teil.vorname; zrec.nachname = teil.nachname; }
    if (p.telefon && !zrec.telefon) zrec.telefon = p.telefon;
    if (!zrec.name) zrec.name = pe;
    const chk = await kundeZahlerPruefen(env, pk, zk);
    if (chk.error) return json({ error: chk.error }, 400);
    await kundeDatenSchreiben(env, zrec);
    const palt = (await kundeDatenLaden(env, pk)) || { key: pk, created: new Date().toISOString(), land: 'DE', name: v.person_name || '' };
    palt.zahler = zk; palt.zahler_name = zrec.name;
    await kundeDatenSchreiben(env, palt);
  }
  v.status = 'uebernommen'; v.wer = wer; v.erledigt = new Date().toISOString();
  await env.VOUCHERS.put(`kdvorschlag:${code}`, JSON.stringify(v));
  return json({ ok: true, wer });
}

/** Aus dem Formular „Karte ausstellen“: für wen die Karte ist (trainierte Person), falls nicht der Käufer. */
function kundePersonAusBody(body) {
  const p = String((body && body.person) || '').trim().toLowerCase();
  return isEmail(p) ? { person: p, person_name: clean(body.person_name, 80) } : {};
}

async function kunde2Admin(path, url, request, env, body) {
  const POST = request.method === 'POST', GET = request.method === 'GET';
  if (path === 'anlegen' && POST) return kundeAnlegen(body, env);
  if (path === 'daten' && POST) return kundeDatenSetzen(body, env);
  if (path === 'loeschen' && POST) return kundeLoeschen(body, env);
  if (path === 'karte-link' && POST) return kundeKarteLink(body, env);
  if (path === 'karte-status' && GET) return kundeKarteStatus(url, env);
  if (path === 'vorschlag' && POST) return kundeVorschlag(body, env);
  return json({ error: 'Unbekannte Aktion.' }, 404);
}
