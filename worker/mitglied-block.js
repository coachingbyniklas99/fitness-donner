/* ================================================================== */
/* MITGLIEDERBEREICH: Meine Daten, Mitteilungen aufs Handy             */
/* (neu in worker-code-27)                                              */
/* ================================================================== */
/*
 * Meine Daten: Mitglieder ändern Telefon und Adresse selbst (POST /api/kurse/karte-profil, mit Code + E-Mail).
 *   Die Änderung steht danach in der Karte, im Kundenprofil und in der Kartenbestellung. Du bekommst eine Mail
 *   (löst die Push-Meldung aus) und siehst in der Verwaltung unter "Kurskarten" einen Hinweis "Daten geändert".
 *   Name und E-Mail ändern sich nur auf Anfrage, weil die E-Mail-Adresse der Schlüssel zur Karte ist.
 *   Bankdaten werden bewusst NICHT im eigenen System gespeichert.
 *
 * Mitteilungen: Das Gerät eines Mitglieds meldet sich mit Code + E-Mail für Push an (POST /api/kurse/karte-push).
 *   KV: push:mem:<hash> → { p, code, endpoint, keys, ua, created, updated }. Dasselbe Schlüsselpaar (VAPID) wie bei der Verwaltung.
 *   Verwaltung: POST kurse/push-info · POST kurse/push-senden { titel, text, ziel: 'alle'|'gebucht', kurs?, datum? }.
 *   Fällt ein Kurs aus, bekommen die betroffenen Mitglieder automatisch eine Mitteilung.
 */

const MPUSH_PREFIX = 'push:mem:';

async function mpushSubKey(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
  return MPUSH_PREFIX + [...new Uint8Array(h)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Geräte der Mitglieder einer Anbieterin; codes = nur diese Karten (Set mit Anzeige-Codes) oder null für alle. */
async function mpushListe(env, p, codes) {
  const out = [];
  let cursor;
  do {
    const l = await env.VOUCHERS.list({ prefix: MPUSH_PREFIX, cursor });
    for (const k of l.keys) {
      const raw = await env.VOUCHERS.get(k.name);
      if (!raw) continue;
      let sub;
      try { sub = JSON.parse(raw); } catch (e) { continue; }
      if (!sub || sub.p !== p.id) continue;
      if (codes && !codes.has(sub.code)) continue;
      out.push({ key: k.name, sub });
    }
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  return out;
}

/** Schickt eine Meldung an die Geräte der Liste. Wirft nie. */
async function mpushSenden(env, liste, msg) {
  const res = { gesendet: 0, entfernt: 0, fehler: 0 };
  try {
    if (!liste.length) return res;
    const vapid = await pushVapid(env);
    const plain = new TextEncoder().encode(JSON.stringify({
      title: String(msg.title || 'Fitness Donner').slice(0, 80),
      body: String(msg.body || '').slice(0, 220),
      url: msg.url || '/mitglied.html',
    }));
    for (let i = 0; i < liste.length; i += 15) {
      await Promise.all(liste.slice(i, i + 15).map(async ({ key, sub }) => {
        try {
          const body = await pushEncrypt(sub, plain);
          const jwt = await pushJwt(vapid, sub.endpoint);
          const r = await fetch(sub.endpoint, {
            method: 'POST',
            headers: {
              Authorization: `vapid t=${jwt}, k=${vapid.pub}`,
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              TTL: String(PUSH_TTL),
              Urgency: 'high',
            },
            body,
            signal: AbortSignal.timeout(6000),
          });
          if (r.status === 404 || r.status === 410) { await env.VOUCHERS.delete(key); res.entfernt++; }
          else if (r.ok) res.gesendet++;
          else { res.fehler++; console.error('Mitglieder-Push abgelehnt', r.status, (await r.text()).slice(0, 200)); }
        } catch (e) {
          res.fehler++;
          console.error('Mitglieder-Push fehlgeschlagen', e && e.message);
        }
      }));
    }
  } catch (e) {
    console.error('Mitglieder-Push-Fehler', e && e.message);
  }
  return res;
}

async function mpushAnCodes(env, p, codes, msg) {
  try {
    const set = new Set(codes.filter(Boolean));
    if (!set.size) return { gesendet: 0, entfernt: 0, fehler: 0 };
    return await mpushSenden(env, await mpushListe(env, p, set), msg);
  } catch (e) { console.error('Mitglieder-Push', e && e.message); return { gesendet: 0, entfernt: 0, fehler: 1 }; }
}

async function mpushKeyRoute(env) {
  const v = await pushVapid(env);
  return json({ ok: true, key: v.pub });
}

async function mpushAnmeldenRoute(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const r = await kursKarteOeffnen(env, request, p, body);
  if (r.error) return kursFehler(r.error, r.status);
  if (body.aktion === 'aus') {
    if (body.endpoint) {
      const key = await mpushSubKey(body.endpoint);
      const raw = await env.VOUCHERS.get(key);
      let alt = null; try { alt = raw ? JSON.parse(raw) : null; } catch (e) { /* egal */ }
      if (alt && alt.code === r.card.code) await env.VOUCHERS.delete(key);
    }
    return json({ ok: true });
  }
  const s = body.subscription;
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) {
    return kursFehler('Anmeldung unvollständig.');
  }
  const key = await mpushSubKey(s.endpoint);
  const alt = await env.VOUCHERS.get(key);
  let created = new Date().toISOString();
  if (alt) { try { created = JSON.parse(alt).created || created; } catch (e) { /* neu */ } }
  await env.VOUCHERS.put(key, JSON.stringify({
    p: p.id, code: r.card.code, endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) },
    ua: String(body.ua || '').slice(0, 160), created, updated: new Date().toISOString(),
  }));
  return json({ ok: true });
}

/* ---------------- Meine Daten ---------------- */

function kursKarteProfilSicht(card) {
  const a = card.profil || {};
  return { name: card.kunde.name, email: card.kunde.email, phone: card.kunde.phone || '', strasse: a.strasse || '', plz: a.plz || '', ort: a.ort || '' };
}

async function kursKarteProfilRoute(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const r = await kursKarteOeffnen(env, request, p, body);
  if (r.error) return kursFehler(r.error, r.status);
  const phone = clean(body.phone, 40);
  if (!phone) return kursFehler(PHONE_ERROR);
  const strasse = clean(body.strasse, 80), plz = clean(body.plz, 10), ort = clean(body.ort, 60);
  const teile = [strasse, plz, ort].filter(Boolean).length;
  if (teile && teile < 3) return kursFehler('Bitte Straße, Postleitzahl und Ort zusammen angeben oder alle drei leer lassen.');
  if (plz && !/^\d{4,5}$/.test(plz)) return kursFehler('Bitte eine gültige Postleitzahl angeben.');
  const norm = r.card.norm;
  let geaendert = [];
  let name = '';
  let orderId = '';
  await kursMitSperre(env, p.id, 'kk-' + norm, async () => {
    const card = await kursKarteLesen(env, p, norm);
    const alt = kursKarteProfilSicht(card);
    if (alt.phone !== phone) geaendert.push('Telefon');
    if (alt.strasse !== strasse || alt.plz !== plz || alt.ort !== ort) geaendert.push('Adresse');
    if (!geaendert.length) return;
    card.kunde.phone = phone;
    card.profil = { strasse, plz, ort };
    card.profil_geaendert = new Date().toISOString();
    await kursKarteSpeichern(env, p, card);
    name = card.kunde.name;
    orderId = card.order;
  });
  if (geaendert.length) {
    const email = String(r.card.kunde.email || '').toLowerCase();
    try {
      const key = K.kunde(p.id, email);
      const raw = await env.VOUCHERS.get(key);
      const k = raw ? JSON.parse(raw) : { email, created: new Date().toISOString(), bestellungen: [] };
      k.telefon = phone;
      k.adresse = { strasse, plz, ort };
      k.updated = new Date().toISOString();
      await kursPut(env, key, JSON.stringify(k));
    } catch (e) { console.error('Kundenprofil', e); }
    try {
      const o = orderId ? await kursGetBestellung(env, p.id, orderId) : null;
      if (o) { o.kunde = { ...o.kunde, phone, adresse: { strasse, plz, ort } }; await kursPutBestellung(env, p.id, o); }
    } catch (e) { console.error('Bestellung', e); }
    try {
      const rows = row('Mitglied', esc(name)) + row('Karte', esc(r.card.code)) + row('Geändert', esc(geaendert.join(' und '))) +
        row('Telefon', esc(phone)) + (strasse ? row('Adresse', esc(`${strasse}, ${plz} ${ort}`)) : '');
      await kursSendMail(env, p, {
        to: p.email || config(env).ownerEmail,
        subject: `Daten geändert: ${name}`,
        html: kursShell(env, p, 'Mitglied hat Daten geändert', `<table style="width:100%;border-collapse:collapse">${rows}</table>`),
      });
    } catch (e) { console.error('Änderungs-Mail', e); }
  }
  const card = await kursKarteLesen(env, p, norm);
  return json({ ok: true, geaendert, profil: kursKarteProfilSicht(card) });
}

/* ---------------- Verwaltung: Mitteilungen senden ---------------- */

async function kursAdminPushInfo(env, p) {
  const liste = await mpushListe(env, p, null);
  const codes = new Set(liste.map((x) => x.sub.code));
  const raw = await env.VOUCHERS.get(`kurs:${p.id}:pushlog`);
  let log = [];
  try { log = raw ? JSON.parse(raw) : []; } catch (e) { /* leer */ }
  return json({ ok: true, geraete: liste.length, mitglieder: codes.size, log });
}

async function kursAdminPushSenden(env, p, body) {
  const titel = clean(body.titel, 60);
  const text = clean(body.text, 200);
  if (!titel || !text) return kursErr('Bitte Titel und Text angeben.');
  const ziel = body.ziel === 'gebucht' ? 'gebucht' : 'alle';
  let kurs = null;
  const datum = String(body.datum || '');
  if (body.kurs) {
    kurs = await kursFind(env, p.id, String(body.kurs));
    if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
    if (!KURS_DATUM.test(datum)) return kursErr('Bitte einen Termin wählen.');
  }
  let codes = null;
  if (ziel === 'gebucht') {
    if (!kurs) return kursErr('Für "nur Gebuchte" bitte einen Termin wählen.');
    codes = new Set();
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    for (const z of doc.plaetze) {
      if (z.status !== 'gebucht' || !z.order) continue;
      const o = await kursGetBestellung(env, p.id, z.order);
      if (o && o.karte_code) codes.add(o.karte_code);
    }
  }
  const url = `/mitglied.html?p=${encodeURIComponent(p.id)}` + (kurs ? `&k=${encodeURIComponent(kurs.id)}&d=${datum}` : '');
  const liste = await mpushListe(env, p, codes);
  const res = await mpushSenden(env, liste, { title: titel, body: text, url });
  const raw = await env.VOUCHERS.get(`kurs:${p.id}:pushlog`);
  let log = [];
  try { log = raw ? JSON.parse(raw) : []; } catch (e) { /* leer */ }
  log.unshift({ at: new Date().toISOString(), titel, text, ziel, termin: kurs ? `${kurs.titel} ${datum}` : '', gesendet: res.gesendet, fehler: res.fehler, geraete: liste.length });
  await kursPut(env, `kurs:${p.id}:pushlog`, JSON.stringify(log.slice(0, 15)));
  return json({ ok: true, geraete: liste.length, ...res });
}

/** Verwaltung streicht Platz oder Termin: Die Einheit der Karte geht zurück oder zieht auf den Ersatztermin um. */
async function kursKarteEinheitZurueck(env, p, o, ersatz) {
  try {
    if (!o || o.art !== 'kartebuchung' || !o.karte_code) return;
    const norm = kursKarteNorm(o.karte_code);
    await kursMitSperre(env, p.id, 'kk-' + norm, async () => {
      const card = await kursKarteLesen(env, p, norm);
      if (!card) return;
      const g = (card.genutzt || []).find((x) => x.bestellung === o.id && x.status === 'gebucht');
      if (!g) return;
      if (ersatz) { g.datum = ersatz.datum; g.start = ersatz.start; g.ende = ersatz.ende; }
      else { g.status = 'freigegeben'; g.ende_at = new Date().toISOString(); }
      await kursKarteSpeichern(env, p, card);
    });
  } catch (e) { console.error('Karteneinheit zurück', e); }
}

