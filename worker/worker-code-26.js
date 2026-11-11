/* worker-code-26 – worker-code-25 (Gutschein-Wunsch-Uhrzeit, PDF-Download) plus Kurskarte ohne feste Termine (Mitgliederbereich: /api/kurse/karte, /karte-buchen, /karte-absagen, 24-Stunden-Regel, Admin-Kartenliste). Stand: 2026-11-11 */
/* worker-code-25 – worker-code-24 plus Gutschein-Versand zur Wunsch-Uhrzeit (sendDate "JJJJ-MM-TTTHH:MM", deutsche Zeit, Viertelstunden-Cron), neue Mail an Beschenkte (eingepacktes Geschenk, Link auf auspacken.html, Bilder /mailbilder/geschenk-*.jpg, ohne Code, Fragen nur per WhatsApp), Auspack-Link in der Käufer-Mail, PDF-Download /api/voucher-pdf. Stand: 2026-11-10 */
/* worker-code-22 – worker-code-21 plus Gutschein-Titel 'Personal Training und Kurse' (Mail, PDF). Stand: 2026-11-06 */
/* worker-code-21 – worker-code-20 plus Gutschein-Texte 'Personal Training und Fitnesskurse'. Stand: 2026-11-06 */
/* worker-code-24 – wie 23, aber Mailbilder werden vom Worker selbst geladen und als Inline-Anhang (base64) mitgeschickt; schlaegt das fehl, bleibt die normale Bild-URL stehen. Stand: 2026-11-09 */
/* worker-code-23 – worker-code-22 plus Bastelkarte (zweiseitiges A4-quer-PDF zum Selbstdrucken, metadata[bastel], Vorlagen unter /mailbilder/bastel-*). Stand: 2026-11-08 */
/* worker-code-20 – worker-code-18 plus Mail-Gutschein ohne Hintergrundbilder (kopf2/band2), Bilder als Inline-Anhang (cid), Buttons als Tabelle, Mailtest mit design/pdf. Stand: 2026-11-06 */
/* worker-code-18 – worker-code-17 plus Festgutschein in der Mail (Bildteile unter /mailbilder/) und PDF-Anhang bei Kauf "An mich" (metadata[pdf]). Stand: 2026-11-06 */
/* worker-code-16 – worker-code-15 plus Zahlart "Vor Ort bezahlen (QR)": Rechnung mit Zahlungsseite, Status-Abfrage, Karten-Mail erst nach Zahlung, Zahlungslink per Mail. Stand: 2026-11-04 */
/* worker-code-15 – worker-code-13 plus Karte im Kundenprofil ausstellen (Rechnung + Mail), Zahlart je Kunde, Rechnungsvorlage, Rechnungsliste, SEPA-Mandat speichern und per Link anfordern (Block "KARTE" am Dateiende, Haken: KARTE-HOOK).
   Stand: 2026-11-04 */
/* worker-code-13 – worker-code-12 plus Verwaltung: Termine verschieben und von Hand eintragen, Kartenübersicht (Block "TERMIN" am Dateiende, Haken: TERMIN-HOOK).
   worker-code-12 – worker-code-11 plus Push-Mitteilungen aufs Handy (Block "PUSH" am Dateiende, Haken: PUSH-HOOK).
   Stand: 2026-10-28 */
/* worker-code-11 – worker-code-10 plus Kundenprofil und Mail-Verlauf (Block "KUNDEN" am Dateiende, Haken: KUNDEN-HOOK).
   worker-code-10 – worker-code-9 plus Wiedervorlage, WhatsApp-Button, Abmeldung und Aktionscodes.
   Neu: der Block "WIEDERVORLAGE" am Dateiende und alle mit WV-HOOK markierten Stellen.
   Achtung: worker-code-9 wurde aus worker/src (basis.js + kurse/*.js) gebaut. Diese Änderungen
   sind dort noch nicht eingepflegt – vor dem nächsten "node build.mjs" in src/ nachtragen.
   Stand: 2026-10-24 */
/**
 * Fitness Donner – Gutschein-Backend
 * Cloudflare Worker: Stripe Checkout + Gutschein-Erzeugung + Mailversand
 *
 * Endpunkte
 *   POST /api/checkout   -> erstellt eine Stripe-Checkout-Session, liefert { url }
 *   POST /api/webhook    -> Stripe-Webhook (checkout.session.completed)
 *   GET  /api/voucher    -> Gutscheindaten für die Danke-/Ansichtsseite
 *                           ?session_id=cs_...   (direkt nach der Zahlung)
 *                           ?code=FD-...&t=...   (Link aus der E-Mail)
 *
 * Cron (täglich): versendet Gutscheine mit Wunsch-Versanddatum.
 *
 * Benötigte Secrets (Cloudflare -> Worker -> Settings -> Variables):
 *   STRIPE_SECRET_KEY        sk_live_... bzw. sk_test_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...
 *   RESEND_API_KEY           re_...
 * Benötigte Variablen (Klartext, dürfen im Code stehen):
 *   siehe CONFIG unten – bzw. als Environment Variables überschreibbar
 * Benötigtes KV-Binding:
 *   VOUCHERS
 *
 * Kursmodul (ab worker-code-9): alles unter /api/kurse… und /api/admin/kurse/…,
 * Code in src/kurse/. Eingriffe in den bestehenden Code sind mit KURSE-HOOK markiert.
 */

const CONFIG = {
  siteOrigin: 'https://fitnessdonner.de',
  siteName: 'Fitness Donner',
  ownerEmail: 'info@fitnessdonner.de',
  ownerName: 'Niklas Donner',
  ownerPhone: '0177 6311404',
  // Adresse dieses Workers (für die Ein-Klick-Abmeldung im Mailprogramm); per Variable API_ORIGIN überschreibbar
  apiOrigin: 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev', // WV-HOOK
  // Absenderadresse – muss in Resend als verifizierte Domain hinterlegt sein
  fromEmail: 'Fitness Donner <info@fitnessdonner.de>',
  minCents: 1500,      // 15 €
  maxCents: 100000,    // 1.000 €
  validYears: 3,       // Gültigkeit: 3 Jahre bis zum Jahresende
  /* ---- Buchung ---- */
  trainingCents: 9900,        // Einzeltraining, 60 Minuten
  probeCents: 2900,           // Probetraining
  bookingHorizonDays: 56,     // wie weit im Voraus buchbar
  bookingLeadHours: 24,       // Mindestvorlauf vor Trainingsbeginn
  // Fußzeile der automatisch erzeugten Rechnung
  invoiceFooter:
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet. ' +
    'Der Gutschein ist ein Mehrzweckgutschein und wird bei Einlösung auf die Leistung angerechnet.',
};

const ALLOWED_ORIGINS = ['https://fitnessdonner.de', 'https://www.fitnessdonner.de'];

/**
 * Verfügbarkeiten je Wochentag.
 *   weekday  0 = Sonntag, 1 = Montag ... 6 = Samstag
 *   ranges   feste Zeiten [von, bis] – genau so, wie sie angeboten werden
 *   windows  offene Fenster [von, bis]; daraus werden Termine erzeugt
 *   minutes  Trainingsdauer in einem Fenster (Standard 60)
 *   gap      Pause zwischen zwei Terminen eines Fensters (Standard 15)
 *   from     Datum, ab dem der Standort verfügbar ist (optional)
 *
 * Überlappende Zeiten sind ausdrücklich erlaubt: 8:00–9:00 und 8:30–9:30 stehen
 * beide zur Auswahl, sobald eine der beiden gebucht ist, verschwindet die andere.
 * Dasselbe gilt für Training und Probetraining im selben Zeitraum.
 */
/** Ab wann online gebucht werden kann. Vorher zeigt die Seite keine Termine an. */
const STUDIO_START = '2026-10-01';

/**
 * Standorte. Solingen steht bewusst zuerst – das ist der Hauptstandort und
 * auf der Buchungsseite vorausgewählt.
 * Beim neuen Studio fehlen Name und Adresse noch; sobald sie öffentlich sind,
 * hier eintragen, dann stehen sie automatisch überall.
 */
const LOCATIONS = [
  {
    city: 'Solingen',
    name: 'New Forge, Solingen-Ohligs',
    address: 'Prinzenstraße 2a, 42697 Solingen',
    note: 'Privater Trainingsraum im Haus, Duschen und Umkleiden direkt daneben. Wo genau wir uns treffen, steht in der Terminbestätigung.',
    image: 'newforge-studio.webp',
    primary: true,
  },
  {
    city: 'Neuss',
    name: 'Iron&Soul Neuss',
    address: 'Römerstraße 120, 41462 Neuss',
    note: 'Einzelne Termine rund um meine Kurse.',
    image: '',
  },
  {
    city: 'Köln',
    name: 'Iron&Soul Zollstock',
    address: 'Weyerstraßerweg 10a, 50969 Köln',
    note: 'Einzelne Termine rund um meine Kurse.',
    image: '',
  },
];

const PLACES = {
  solingen: 'New Forge, Solingen-Ohligs',
  neuss: 'Iron&Soul Neuss, Römerstraße 120',
  koeln: 'Iron&Soul Zollstock, Weyerstraßerweg 10a',
};

const AVAILABILITY = [
  // Montag – Solingen
  {
    weekday: 1, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START,
    ranges: [['06:00', '07:00'], ['07:15', '08:15'], ['12:00', '13:00'], ['13:15', '14:15'],
             ['18:15', '19:15'], ['19:30', '20:30']],
  },
  // Mittwoch – Neuss
  {
    weekday: 3, city: 'Neuss', place: PLACES.neuss, from: STUDIO_START,
    ranges: [['10:45', '11:45']],
  },
  // Mittwoch – Solingen
  {
    weekday: 3, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START,
    ranges: [['16:00', '17:00'], ['17:15', '18:15'], ['18:30', '19:30'], ['19:45', '20:45']],
  },
  // Donnerstag – Solingen
  {
    weekday: 4, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START,
    ranges: [['06:00', '07:00'], ['07:15', '08:15'], ['08:30', '09:30'], ['12:00', '13:00'],
             ['13:15', '14:15'], ['20:30', '21:30']],
  },
  // Freitag – Solingen
  {
    weekday: 5, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START,
    ranges: [['06:00', '07:00'], ['07:15', '08:15'], ['08:30', '09:30'], ['09:45', '10:45'],
             ['11:00', '12:00']],
  },
  // Freitag – Köln
  {
    weekday: 5, city: 'Köln', place: PLACES.koeln, from: STUDIO_START,
    ranges: [['13:45', '14:45'], ['15:00', '16:00']],
  },
  // Wochenende – Solingen
  { weekday: 6, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START, ranges: [['10:00', '11:00']] },
  { weekday: 0, city: 'Solingen', place: PLACES.solingen, from: STUDIO_START, ranges: [['10:00', '11:00']] },
];

/**
 * Mehrfachkarten. Werden ohne Termin gekauft; der Käufer bekommt einen Code und
 * bucht damit später einzelne Einheiten. Preis pro Einheit ist der Kartenpreis,
 * nicht der Einzelpreis – deshalb wird in Einheiten gezählt, nicht in Euro.
 */
const CARDS = {
  karte4: { label: '4er-Karte', sessions: 4, unitCents: 8900, totalCents: 35600 },
  karte8: { label: '8er-Karte', sessions: 8, unitCents: 7900, totalCents: 63200 },
};

const BOOKING_TYPES = {
  training: { label: 'Personal Training', priceKey: 'trainingCents' },
  probe: { label: 'Probetraining', priceKey: 'probeCents', oncePerEmail: true, credit: true },
};

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      // KURSE-HOOK: Kurs-Endpunkte dürfen auch von eingebetteten Partnerseiten aufgerufen werden
      if (url.pathname.startsWith('/api/kurse')) return kursCors(new Response(null, { status: 204 }), request, env);
      return cors(new Response(null, { status: 204 }), request);
    }

    try {
      // KURSE-HOOK: neues Kursmodul, eigene Endpunkte
      if (url.pathname === '/api/kurse' || url.pathname.startsWith('/api/kurse/')) {
        return await kursRoute(url, request, env, ctx);
      }
      if (url.pathname === '/api/checkout' && request.method === 'POST') {
        return cors(await handleCheckout(request, env), request);
      }
      if (url.pathname === '/api/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env, ctx);
      }
      if (url.pathname === '/api/voucher' && request.method === 'GET') {
        return cors(await handleVoucherLookup(url, env), request);
      }
      if (url.pathname === '/api/voucher-pdf' && request.method === 'GET') {
        return cors(await handleVoucherPdf(url, env), request);
      }
      if (url.pathname === '/api/slots' && request.method === 'GET') {
        return cors(await handleSlots(env), request);
      }
      if (url.pathname === '/api/karte' && request.method === 'POST') {
        return cors(await handleKarteCheckout(request, env), request);
      }
      if (url.pathname === '/api/book' && request.method === 'POST') {
        return cors(await handleBook(request, env), request);
      }
      if (url.pathname === '/api/bewertungen' && request.method === 'GET') {
        return cors(await handleRatings(env, ctx), request);
      }
      if (url.pathname === '/api/widerruf' && request.method === 'POST') {
        return cors(await handleWiderruf(request, env), request);
      }
      if (url.pathname === '/api/termin' && request.method === 'GET') {
        return cors(await handleTerminInfo(url, env), request);
      }
      if (url.pathname === '/api/verschieben' && request.method === 'POST') {
        return cors(await handleMove(request, env), request);
      }
      if (url.pathname === '/api/release' && request.method === 'POST') {
        return cors(await handleRelease(request, env), request);
      }
      if (url.pathname === '/api/redeem-check' && request.method === 'POST') {
        return cors(await handleRedeemCheck(request, env), request);
      }
      // WV-HOOK: Abmeldung von Wiedervorlage-Mails (auch als Ein-Klick-Abmeldung aus dem Mailprogramm)
      if (url.pathname === '/api/abmelden' && request.method === 'POST') {
        return cors(await handleAbmelden(url, request, env), request);
      }
      if (url.pathname.startsWith('/api/admin/')) {
        return cors(await handleAdmin(url, request, env), request);
      }
      if (url.pathname === '/api/booking' && request.method === 'GET') {
        return cors(await handleBookingLookup(url, env), request);
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('Unhandled error', err && err.stack ? err.stack : err);
      return cors(json({ error: 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.' }, 500), request);
    }
  },

  // Täglicher Cron: Gutscheine mit Wunsch-Versanddatum verschicken
  async scheduled(event, env, ctx) {
    // GS-ZEIT: der Viertelstunden-Cron verschickt nur Gutscheine, deren Wunsch-Uhrzeit erreicht ist
    if (event && event.cron === GS_CRON) {
      ctx.waitUntil(sendScheduledVouchers(env, { takt: true }).catch((e) => console.error('Gutschein-Cron', e)));
      return;
    }
    // KURSE-HOOK: der stündliche Kurs-Cron (falls in Cloudflare eingerichtet) macht nur Kurssachen
    if (event && event.cron === KURS_CRON) {
      ctx.waitUntil(kursCron(env).catch((e) => console.error('Kurs-Cron', e)));
      return;
    }
    ctx.waitUntil(kursCron(env, { taeglich: true }).catch((e) => console.error('Kurs-Cron', e)));
    ctx.waitUntil(sendScheduledVouchers(env));
    ctx.waitUntil(sendTomorrowReminders(env));
    ctx.waitUntil(wvDaily(env).catch((e) => console.error('Wiedervorlage', e)));   // WV-HOOK
    ctx.waitUntil(cleanupOldData(env));
    ctx.waitUntil(refreshRating(env).catch((e) => console.error('Bewertungen', e)));
  },
};

/* ------------------------------------------------------------------ */
/* 1. Checkout                                                         */
/* ------------------------------------------------------------------ */

async function handleCheckout(request, env) {
  const cfg = config(env);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Ungültige Anfrage.' }, 400);

  const amountCents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents < cfg.minCents || amountCents > cfg.maxCents) {
    return json({ error: `Bitte einen Betrag zwischen ${cfg.minCents / 100} € und ${cfg.maxCents / 100} € wählen.` }, 400);
  }

  const buyerName = clean(body.buyerName, 80);
  const buyerEmail = clean(body.buyerEmail, 120).toLowerCase();
  if (!buyerName) return json({ error: 'Bitte deinen Namen angeben.' }, 400);
  if (!isEmail(buyerEmail)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);

  const delivery = body.delivery === 'gift' ? 'gift' : 'buyer';
  const giftEmail = clean(body.giftEmail, 120).toLowerCase();
  if (delivery === 'gift' && !isEmail(giftEmail)) {
    return json({ error: 'Bitte die E-Mail-Adresse der beschenkten Person angeben.' }, 400);
  }

  // Wunsch-Versand: Tag (bis 1 Jahr voraus) und optional Uhrzeit im Viertelstundentakt, deutsche Zeit.
  // Format vom Formular: "JJJJ-MM-TT" oder "JJJJ-MM-TTTHH:MM". Liegt der Zeitpunkt schon in der
  // Vergangenheit, bleibt beides leer und der Gutschein geht sofort raus.
  let sendDate = '', sendTime = '';
  if (delivery === 'gift' && body.sendDate) {
    const roh = String(body.sendDate);
    const d = roh.slice(0, 10);
    const zm = /^T([01]\d|2[0-3]):(00|15|30|45)$/.exec(roh.slice(10, 16));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const jetzt = gsBerlinNow();
      const max = isoDate(new Date(Date.now() + 365 * 864e5));
      if (zm) {
        const t = zm[1] + ':' + zm[2];
        if ((d > jetzt.date || (d === jetzt.date && t > jetzt.time)) && d <= max) { sendDate = d; sendTime = t; }
      } else if (d > jetzt.date && d <= max) sendDate = d;
    }
  }

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('locale', 'de');
  params.set('customer_email', buyerEmail);
  params.set('success_url', `${cfg.siteOrigin}/gutschein-danke.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${cfg.siteOrigin}/gutschein.html?abgebrochen=1`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(amountCents));
  params.set('line_items[0][price_data][product_data][name]', `Gutschein ${cfg.siteName}`);
  params.set(
    'line_items[0][price_data][product_data][description]',
    `Wertgutschein über ${fmtEur(amountCents)} für Personal Training und Fitnesskurse`
  );
  params.set('payment_intent_data[description]', `Gutschein ${fmtEur(amountCents)}`);

  // Automatische Rechnung nach erfolgreicher Zahlung.
  // Stripe erzeugt eine echte Rechnung mit fortlaufender Nummer und schickt sie
  // zusammen mit dem Beleg per Mail an den Käufer. Voraussetzung: in Stripe unter
  // Einstellungen -> Kundenmails muss "Erfolgreiche Zahlungen" aktiv sein.
  params.set('invoice_creation[enabled]', 'true');
  params.set('customer_creation', 'always');
  params.set('billing_address_collection', 'required');
  params.set(
    'invoice_creation[invoice_data][description]',
    `Wertgutschein über ${fmtEur(amountCents)} für Personal Training und Fitnesskurse bei ${cfg.siteName}`
  );
  params.set('invoice_creation[invoice_data][footer]', cfg.invoiceFooter);
  params.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Gutschein gültig bis');
  params.set(
    'invoice_creation[invoice_data][custom_fields][0][value]',
    fmtDate(expiryDate(new Date(), cfg.validYears))
  );

  params.set('metadata[buyer_name]', buyerName);
  params.set('metadata[recipient_name]', clean(body.recipientName, 80));
  params.set('metadata[message]', clean(body.message, 200));
  params.set('metadata[delivery]', delivery);
  params.set('metadata[gift_email]', delivery === 'gift' ? giftEmail : '');
  params.set('metadata[send_date]', sendDate); params.set('metadata[send_time]', sendTime); params.set('metadata[design]', xmDesign(body.design)); params.set('metadata[pdf]', delivery === 'buyer' && body.pdf ? '1' : ''); params.set('metadata[bastel]', delivery === 'buyer' && body.bastel && xmDesign(body.design) ? '1' : '');

  const session = await createCheckoutSession(env, params, PAY_TYPES_GIFT);
  if (!session || !session.url) {
    console.error('Stripe-Session fehlgeschlagen', session);
    return json({ error: 'Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.' }, 502);
  }
  return json({ url: session.url });
}

/* ------------------------------------------------------------------ */
/* 2. Webhook                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Buchung: freie Termine                                              */
/* ------------------------------------------------------------------ */

/** Alle an einem Tag grundsätzlich angebotenen Termine – ohne Rücksicht auf Belegung. */
function slotsForDate(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const out = [];

  for (const a of AVAILABILITY) {
    if (a.weekday !== weekday) continue;
    if (a.from && date < a.from) continue;

    const add = (start, end) => {
      const minutes = toMinutes(end) - toMinutes(start);
      out.push({
        slotId: `${slotPrefix(a.city)}-${start.replace(':', '')}-${minutes}`,
        date, start, end, minutes, city: a.city, place: a.place,
      });
    };

    for (const [start, end] of a.ranges || []) add(start, end);

    // Fenster in Termine zerlegen: Dauer + Pause, bis das Fenster voll ist
    for (const [from, to] of a.windows || []) {
      const minutes = a.minutes || 60;
      const step = minutes + (a.gap === undefined ? 15 : a.gap);
      for (let t = toMinutes(from); t + minutes <= toMinutes(to); t += step) {
        add(fromMinutes(t), fromMinutes(t + minutes));
      }
    }
  }

  const seen = new Set();
  return out
    .filter((s) => (seen.has(s.slotId) ? false : seen.add(s.slotId)))
    .sort((x, y) => x.start.localeCompare(y.start));
}

async function handleSlots(env) {
  const cfg = await liveConfig(env);
  const cards = await liveCards(env);
  const earliest = Date.now() + cfg.bookingLeadHours * 3600e3;
  const latest = Date.now() + cfg.bookingHorizonDays * 864e5;

  const dates = [];
  for (let i = 0; i <= cfg.bookingHorizonDays; i++) dates.push(isoDate(new Date(Date.now() + i * 864e5)));

  const taken = await takenState(env, dates[0], dates[dates.length - 1]);
  const out = [];

  for (const date of dates) {
    if (taken.blocked.has(date)) continue;
    const busy = taken.busy.get(date) || [];
    for (const s of slotsForDate(date)) {
      const startsAt = berlinToUtc(date, s.start).getTime();
      if (startsAt < earliest || startsAt > latest) continue;
      if (overlapsAny(s, busy)) continue;
      out.push(s);
    }
  }

  return json({
    slots: out,
    locations: LOCATIONS,
    multi_book: true,   // Karte: mehrere Termine auf einmal einlösen (POST /api/book mit slots)
    prices: { training: cfg.trainingCents, probe: cfg.probeCents },
    cards: Object.keys(cards).reduce(function (acc, k) {
      acc[k] = {
        label: cards[k].label, sessions: cards[k].sessions,
        unit_cents: cards[k].unitCents, total_cents: cards[k].totalCents,
      };
      return acc;
    }, {}),
  });
}

/**
 * Belegte Zeiten und gesperrte Tage sammeln – aus dem KV und, sofern
 * eingerichtet, zusätzlich aus dem Google Kalender.
 */
async function takenState(env, fromDate, toDate) {
  const blocked = new Set();
  const busy = new Map();
  const addBusy = (date, from, to) => {
    if (!busy.has(date)) busy.set(date, []);
    busy.get(date).push([from, to]);
  };

  const [b, s, bs, freed] = await Promise.all([
    env.VOUCHERS.list({ prefix: 'booking:' }),
    env.VOUCHERS.list({ prefix: 'block:' }),
    env.VOUCHERS.list({ prefix: 'blockslot:' }),
    readFreed(env),
  ]);
  for (const k of s.keys) blocked.add(k.name.slice('block:'.length));
  for (const k of bs.keys) {
    // blockslot:<datum>:<ort>-<hhmm>-<dauer>
    const m = /^blockslot:(\d{4}-\d{2}-\d{2}):[a-z]+-(\d{4})-(\d+)$/.exec(k.name);
    if (!m) continue;
    const from = Number(m[2].slice(0, 2)) * 60 + Number(m[2].slice(2));
    addBusy(m[1], from, from + Number(m[3]));
  }
  for (const k of b.keys) {
    // Die Schlüsselliste des KV hinkt bis zu 60 s hinterher – gerade freigegebene Termine überspringen
    if (freed[k.name] && !(await env.VOUCHERS.get(k.name))) continue;
    // booking:<datum>:<ort>-<hhmm>-<dauer>
    const m = /^booking:(\d{4}-\d{2}-\d{2}):[a-z]+-(\d{4})-(\d+)$/.exec(k.name);
    if (!m) continue;
    const from = Number(m[2].slice(0, 2)) * 60 + Number(m[2].slice(2));
    addBusy(m[1], from, from + Number(m[3]));
  }

  for (const e of await calendarBusy(env, fromDate, toDate)) addBusy(e.date, e.from, e.to);
  // KURSE-HOOK: eigene Kurstermine blockieren Personal-Training-Slots
  for (const e of await kursBusy(env, fromDate, toDate)) addBusy(e.date, e.from, e.to);

  return { blocked, busy };
}

/** Überschneidet sich der Termin mit einer bereits belegten Zeit? */
function overlapsAny(slot, busy) {
  const from = toMinutes(slot.start);
  const to = toMinutes(slot.end);
  return busy.some(([bf, bt]) => from < bt && bf < to);
}

function slotPrefix(city) {
  return String(city).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '').slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* Mehrfachkarten kaufen                                                */
/* ------------------------------------------------------------------ */

/**
 * Prüft eine Liste von Wunschterminen für einen Kartenkauf.
 * Liefert { error } oder { slots } mit den vollständigen Termindaten.
 */
async function checkWishedSlots(list, max, env) {
  const cfg = await liveConfig(env);
  if (!Array.isArray(list) || !list.length) return { slots: [] };
  if (list.length > max) return { error: `Du kannst höchstens ${max} Termine auf einmal festlegen.` };

  const taken = await takenState(env);
  const seen = new Set();
  const out = [];

  for (const wish of list) {
    const date = String(wish.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Ein Termin hat kein gültiges Datum.' };

    const slot = slotsForDate(date).find((s) => s.slotId === wish.slotId);
    if (!slot) return { error: `Am ${fmtDate(date)} gibt es diesen Termin nicht.` };

    const key = `${date}:${slot.slotId}`;
    if (seen.has(key)) return { error: 'Ein Termin wurde doppelt ausgewählt.' };
    seen.add(key);

    const startsAt = berlinToUtc(date, slot.start);
    if (startsAt.getTime() < Date.now() + cfg.bookingLeadHours * 3600e3) {
      return { error: `Der Termin am ${fmtDate(date)} liegt zu kurzfristig.` };
    }
    if (startsAt.getTime() > Date.now() + cfg.bookingHorizonDays * 864e5) {
      return { error: `Der Termin am ${fmtDate(date)} liegt zu weit in der Zukunft.` };
    }
    if (taken.blocked.has(date)) return { error: `Am ${fmtDate(date)} sind keine Termine möglich.` };

    const busy = (taken.busy.get(date) || []).slice();
    if (overlapsAny(slot, busy) || (await env.VOUCHERS.get(`booking:${date}:${slot.slotId}`))) {
      return { error: `Der Termin am ${fmtDate(date)} um ${slot.start} Uhr ist inzwischen vergeben.` };
    }
    // die eigene Auswahl darf sich auch nicht selbst überschneiden
    busy.push([toMinutes(slot.start), toMinutes(slot.end)]);
    taken.busy.set(date, busy);

    out.push(slot);
  }
  return { slots: out };
}

async function handleKarteCheckout(request, env) {
  const cfg = await liveConfig(env);
  const body = await request.json().catch(() => ({}));
  const cards = await liveCards(env);
  const card = cards[body.card];
  if (!card) return json({ error: 'Diese Karte gibt es nicht.' }, 400);

  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase();
  if (!name) return json({ error: 'Bitte deinen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  if (!clean(body.phone, 40)) return json({ error: PHONE_ERROR }, 400);
  if (body.vorzeitig !== true) return json({ error: CONSENT_ERROR }, 400);
  const consentAt = new Date().toISOString();

  // Kommt jemand von der Zahlseite zurück, gibt er seine eigene Reservierung zuerst frei
  const hold = holdId(body.hold);
  if (hold) await releaseHold(hold, env);

  // Optional: der Käufer legt einen Teil oder alle Termine gleich fest
  const wished = await checkWishedSlots(body.slots, card.sessions, env);
  if (wished.error) return json({ error: wished.error }, 409);

  const pending = randomToken(18);
  const bookings = wished.slots.map((slot) => ({
    id: randomToken(16),
    date: slot.date,
    slot_id: slot.slotId,
    start: slot.start,
    end: slot.end,
    minutes: slot.minutes,
    city: slot.city,
    place: slot.place,
    type: 'training',
    label: BOOKING_TYPES.training.label,
    name, email,
    phone: clean(body.phone, 40),
    note: clean(body.note, 300),
    price_cents: card.unitCents,
    voucher_code: '',
    card_code: '',
    voucher_cents: card.unitCents,
    open_cents: 0,
    created: new Date().toISOString(),
    vorzeitig_at: consentAt,
    status: 'pending',
  }));

  // Termine sofort reservieren, damit sie während der Zahlung niemand wegschnappt
  for (const b of bookings) {
    await env.VOUCHERS.put(`booking:${b.date}:${b.slot_id}`, JSON.stringify(b), { expirationTtl: RESERVE_TTL });
  }
  await env.VOUCHERS.put(
    `kartepending:${pending}`,
    JSON.stringify({ card: body.card, name, email, bookings }),
    { expirationTtl: 3600 }
  );

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('locale', 'de');
  params.set('customer_email', email);
  params.set('success_url', `${cfg.siteOrigin}/karte-gekauft.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${cfg.siteOrigin}/termin-buchen.html?art=${body.card}&abgebrochen=1`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(card.totalCents));
  params.set('line_items[0][price_data][product_data][name]', `${card.label} Personal Training`);
  params.set(
    'line_items[0][price_data][product_data][description]',
    `${card.sessions} Einheiten à 60 Minuten, ${fmtEur(card.unitCents)} pro Einheit`
  );
  params.set('payment_intent_data[description]', `${card.label} (${card.sessions} Einheiten)`);
  params.set('invoice_creation[enabled]', 'true');
  params.set('customer_creation', 'always');
  params.set('billing_address_collection', 'required');
  params.set(
    'invoice_creation[invoice_data][description]',
    `${card.label}: ${card.sessions} Einheiten Personal Training à ${fmtEur(card.unitCents)}`
  );
  params.set('invoice_creation[invoice_data][footer]', INVOICE_FOOTER_SERVICE);
  params.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Einlösbar bis');
  params.set('invoice_creation[invoice_data][custom_fields][0][value]', fmtDate(expiryDate(new Date(), 1)));
  params.set('metadata[kind]', 'karte');
  params.set('metadata[card]', body.card);
  params.set('metadata[buyer_name]', name);
  params.set('metadata[pending]', pending);
  params.set('metadata[vorzeitig_at]', consentAt);
  params.set('expires_at', String(Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60));

  const session = await createCheckoutSession(env, params, PAY_TYPES);
  if (!session || !session.url) {
    for (const b of bookings) await env.VOUCHERS.delete(`booking:${b.date}:${b.slot_id}`);
    await env.VOUCHERS.delete(`kartepending:${pending}`);
    console.error('Stripe-Session (Karte) fehlgeschlagen', session);
    return json({ error: 'Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.' }, 502);
  }
  await rememberReservation(hold, bookings, session.id, pending, env);
  return json({ url: session.url });
}

async function createCardFromSession(session, env) {
  const m = session.metadata || {};
  const card = (await liveCards(env))[m.card];
  if (!card) return;

  const code = await uniqueCode(env);
  const now = new Date();
  const rec = {
    kind: 'karte',
    code,
    token: randomToken(20),
    card: m.card,
    label: card.label,
    sessions_total: card.sessions,
    sessions_used: 0,
    unit_cents: card.unitCents,
    amount_cents: session.amount_total,
    currency: (session.currency || 'eur').toUpperCase(),
    buyer_name: m.buyer_name || '',
    buyer_email: session.customer_details?.email || session.customer_email || '',
    created: now.toISOString(),
    expires: expiryDate(now, 1),
    status: 'active',
    redemptions: [],
    session_id: session.id,
    pay_status: session.payment_status || 'paid',   // 'unpaid' = Lastschrift noch unterwegs
    vorzeitig_at: m.vorzeitig_at || '',
  };

  // gleich mitgebuchte Termine bestätigen
  const pendingRaw = m.pending ? await env.VOUCHERS.get(`kartepending:${m.pending}`) : null;
  const bookings = pendingRaw ? (JSON.parse(pendingRaw).bookings || []) : [];

  for (const b of bookings) {
    b.status = 'confirmed';
    b.card_code = code;
    b.session_id = session.id;
    b.pay_status = rec.pay_status;
    b.orig_date = b.date;
    rec.sessions_used += 1;
    rec.redemptions.push({ date: b.date, booking_id: b.id, sessions: 1 });
    // ohne TTL neu schreiben: aus der Reservierung wird die feste Buchung
    await env.VOUCHERS.put(`booking:${b.date}:${b.slot_id}`, JSON.stringify(b));
    await indexBooking(b, env);
  }
  if (rec.sessions_used >= rec.sessions_total) rec.status = 'redeemed';

  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
  await env.VOUCHERS.put(`session:${session.id}`, code, { expirationTtl: 60 * 60 * 24 * 90 });
  if (m.pending) await env.VOUCHERS.delete(`kartepending:${m.pending}`);

  await sendCardMail(rec, env, bookings);
  await sendCardOwnerMail(rec, env, bookings);
  for (const b of bookings) await calendarInsert(b, env);
}



/* ------------------------------------------------------------------ */
/* Kalenderdatei und Terminübersicht                                    */
/* ------------------------------------------------------------------ */

/**
 * Termin als .ics-Datei. Damit landet er im Kalender des Kunden – egal ob
 * Apple, Google oder Outlook. Die eingebaute Erinnerung (VALARM) meldet sich
 * zusätzlich einen Tag vorher direkt auf dem Gerät.
 */
function icsFor(b, env) {
  const cfg = config(env);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const start = berlinToUtc(b.date, b.start);
  const end = berlinToUtc(b.date, b.end);

  // Zeilen dürfen laut Norm nicht zu lang werden und Sonderzeichen müssen escaped sein
  const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/[;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fitness Donner//Termin//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@fitnessdonner.de`,
    `SEQUENCE:${Number(b.moves || 0)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(b.label + ' bei ' + cfg.siteName)}`,
    `LOCATION:${esc(b.place + ', ' + b.city)}`,
    `DESCRIPTION:${esc(b.label + ' mit ' + cfg.ownerName + '. Verschieben bis 12 Stunden vorher: ' + moveLink(b, env) + ' – kurzfristig: ' + cfg.ownerPhone)}`,
    `ORGANIZER;CN=${esc(cfg.ownerName)}:mailto:${cfg.ownerEmail}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc('Morgen: ' + b.label + ' in ' + b.city)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function icsAttachment(b, env) {
  const text = icsFor(b, env);
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return [{ filename: `Termin-${b.date}.ics`, content: btoa(bin), content_type: 'text/calendar; charset=utf-8; method=PUBLISH' }];
}

/** Alle kommenden, bestätigten Termine einer Mailadresse – für die Übersicht. */
async function upcomingFor(email, env) {
  const today = isoDate(new Date());
  const list = await env.VOUCHERS.list({ prefix: 'booking:' });
  const out = [];
  for (const k of list.keys) {
    const raw = await env.VOUCHERS.get(k.name);
    if (!raw) continue;
    const b = JSON.parse(raw);
    if (!b || !b.date || !b.start) continue;
    if (b.status !== 'confirmed') continue;
    if (String(b.email || '').toLowerCase() !== String(email).toLowerCase()) continue;
    if (b.date < today) continue;
    out.push(b);
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function overviewHtml(list, aktuell) {
  if (!list || list.length < 2) return '';
  const rows = list.map((b) => {
    const ist = aktuell && b.id === aktuell.id;
    return `<tr>
      <td style="padding:9px 0;font-size:14px;color:${ist ? '#ECE9E2' : '#C9CCD3'};${ist ? 'font-weight:700' : ''}">${esc(fmtDate(b.date))}, ${esc(b.start)}&ndash;${esc(b.end)} Uhr</td>
      <td style="padding:9px 0;font-size:14px;text-align:right;color:${ist ? '#EFB92E' : '#9AA0AB'}">${esc(b.city)}${ist ? ' &middot; neu' : ''}</td>
    </tr>`;
  }).join('');
  return `
    <div style="border-top:1px solid #2E323B;margin-top:8px;padding-top:20px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9AA0AB;margin-bottom:8px">
        Deine n&auml;chsten Termine
      </div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Terminerinnerung am Vortag                                           */
/* ------------------------------------------------------------------ */

async function sendTomorrowReminders(env) {
  const morgen = isoDate(new Date(Date.now() + 864e5));
  const list = await env.VOUCHERS.list({ prefix: `booking:${morgen}:` });

  for (const k of list.keys) {
    try {
      const raw = await env.VOUCHERS.get(k.name);
      if (!raw) continue;
      const b = JSON.parse(raw);
      if (!b || b.status !== 'confirmed' || b.reminded) continue;
      if (b.no_reminder) continue;

      await sendReminderMail(b, env);
      b.reminded = true;
      await env.VOUCHERS.put(k.name, JSON.stringify(b));
    } catch (err) {
      console.error('Erinnerung fehlgeschlagen', k.name, err);
    }
  }
}

async function sendReminderMail(b, env) {
  const cfg = config(env);
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(b.name))},</p>
    <p style="margin:0 0 22px">kurze Erinnerung: Wir sehen uns <b>morgen</b>.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${row('Wann', `${fmtDate(b.date)}, ${b.start}–${b.end} Uhr`)}
      ${row('Wo', `${b.place}, ${b.city}`)}
      ${row('Was', b.label)}
    </table>
    ${moveHtml(b, env)}
    <p style="margin:0;font-size:12px;color:#9ca3af">
      Diese Erinnerung geh&ouml;rt zu deinem gebuchten Termin. Wenn du keine mehr bekommen
      m&ouml;chtest, antworte kurz auf diese Mail &ndash; dann stelle ich sie ab.
    </p>`;

  await sendMail(env, {
    to: b.email,
    subject: `Morgen ${b.start} Uhr: ${b.label} in ${b.city}`,
    html: mailShell('Morgen ist es soweit', inner, env),
  });
}

/* ------------------------------------------------------------------ */
/* Backend für Niklas                                                   */
/* ------------------------------------------------------------------ */
/*
 * Zugang über ein einziges Passwort, das als Secret ADMIN_PASSWORT im
 * Cloudflare-Dashboard hinterlegt wird. Nach dem Login gibt es einen
 * signierten Token, der 30 Tage gilt – deshalb muss man sich am Handy
 * nur selten neu anmelden.
 */

const ADMIN_TOKEN_DAYS = 30;
const ADMIN_MAX_FAILS = 8;

async function handleAdmin(url, request, env) {
  if (!env.ADMIN_PASSWORT) {
    return json({ error: 'Das Backend ist noch nicht eingerichtet (Secret ADMIN_PASSWORT fehlt).' }, 503);
  }
  const path = url.pathname.replace('/api/admin/', '');

  if (path === 'login' && request.method === 'POST') return adminLogin(request, env);

  const ok = await adminCheck(request, env);
  if (!ok) return json({ error: 'Bitte neu anmelden.' }, 401);

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  // KURSE-HOOK: Kursverwaltung
  if (path.startsWith('kurse/')) return kursAdmin(path.slice('kurse/'.length), url, request, env, body);
  // WV-HOOK: Wiedervorlage-Verwaltung
  if (path.startsWith('wv/')) return wvAdmin(path.slice('wv/'.length), url, request, env, body);
  // KARTE-HOOK: Karte ausstellen, Rechnungen, Zahlart, SEPA-Mandat
  if (path.startsWith('karte/') || path.startsWith('rechnung/') || path.startsWith('kunden/')) {
    const kr = await karteAdmin(path, url, request, env, body);
    if (kr) return kr;
  }
  // KUNDEN-HOOK: Kundenprofil und Mail-Verlauf
  if (path.startsWith('kunden/')) return kundenAdmin(path.slice('kunden/'.length), url, request, env, body);
  // PUSH-HOOK: Mitteilungen aufs Handy
  if (path.startsWith('push/')) return pushAdmin(path.slice('push/'.length), request, env, body);
  // TERMIN-HOOK: Termine verschieben/eintragen
  if (path.startsWith('termin/')) return terminAdmin(path.slice('termin/'.length), url, request, env, body);
  switch (path) {
    case 'state':    return adminState(url, env);
    case 'block':    return adminBlock(body, env, true);
    case 'unblock':  return adminBlock(body, env, false);
    case 'cancel':   return adminCancel(body, env);
    case 'codes':    return adminCodes(url, env);
    case 'code':     return adminCode(body, env);
    case 'settings': return adminSettings(body, env);
    case 'issue':    return adminIssue(body, env);
    case 'release':  return adminRelease(body, env);
    default:         return json({ error: 'Unbekannte Aktion.' }, 404);
  }
}

async function adminLogin(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unbekannt';
  const failKey = `adminfail:${ip}`;
  const fails = Number(await env.VOUCHERS.get(failKey) || 0);
  if (fails >= ADMIN_MAX_FAILS) {
    return json({ error: 'Zu viele Fehlversuche. Bitte in 15 Minuten noch einmal probieren.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  if (!timingSafeEqual(String(body.passwort || ''), String(env.ADMIN_PASSWORT))) {
    await env.VOUCHERS.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return json({ error: 'Passwort stimmt nicht.' }, 401);
  }
  await env.VOUCHERS.delete(failKey);

  const exp = Date.now() + ADMIN_TOKEN_DAYS * 864e5;
  return json({ token: await adminSign(exp, env), exp });
}

async function adminSign(exp, env) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_PASSWORT),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(exp)));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${exp}.${hex}`;
}

async function adminCheck(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp] = token.split('.');
  if (!exp || Number(exp) < Date.now()) return false;
  return timingSafeEqual(token, await adminSign(Number(exp), env));
}

/* ---- Übersicht ---- */

async function adminState(url, env) {
  const cfg = await liveConfig(env);
  const cards = await liveCards(env);
  const today = isoDate(new Date());
  const horizon = isoDate(new Date(Date.now() + cfg.bookingHorizonDays * 864e5));

  const [bk, bl, bs] = await Promise.all([
    env.VOUCHERS.list({ prefix: 'booking:' }),
    env.VOUCHERS.list({ prefix: 'block:' }),
    env.VOUCHERS.list({ prefix: 'blockslot:' }),
  ]);

  const bookings = [];
  for (const k of bk.keys) {
    const raw = await env.VOUCHERS.get(k.name);
    if (!raw) continue;
    const b = JSON.parse(raw);
    if (!b || !b.date || !b.start || b.date < today) continue;   // defekte Einträge überspringen
    bookings.push({
      date: b.date, start: b.start, end: b.end, slot_id: b.slot_id,
      city: b.city, place: b.place, label: b.label, status: b.status,
      name: b.name, email: b.email, phone: b.phone || '', note: b.note || '',
      paid: payLabel(b),
      pay_status: b.pay_status || '',
      card_code: b.card_code || '', voucher_code: b.voucher_code || '',
      created: b.created || '',
    });
  }
  bookings.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  // freie Termine, damit sich im Backend gezielt einer sperren lässt
  const taken = await takenState(env, today, horizon);
  const free = [];
  for (let i = 0; i <= cfg.bookingHorizonDays; i++) {
    const date = isoDate(new Date(Date.now() + i * 864e5));
    if (taken.blocked.has(date)) continue;
    const busy = taken.busy.get(date) || [];
    for (const s of slotsForDate(date)) {
      if (overlapsAny(s, busy)) continue;
      free.push({ date, slotId: s.slotId, start: s.start, end: s.end, city: s.city });
    }
  }

  return json({
    today,
    bookings,
    free,
    blocked_days: bl.keys.map((k) => k.name.slice('block:'.length)).filter((d) => d >= today).sort(),
    blocked_slots: bs.keys.map((k) => {
      const parts = k.name.slice('blockslot:'.length);
      const date = parts.slice(0, 10);
      const slotId = parts.slice(11);
      const s = slotsForDate(date).find((x) => x.slotId === slotId);
      return { date, slotId, start: s ? s.start : '', end: s ? s.end : '', city: s ? s.city : '' };
    }).filter((x) => x.date >= today).sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start))),
    settings: {
      trainingCents: cfg.trainingCents,
      probeCents: cfg.probeCents,
      bookingLeadHours: cfg.bookingLeadHours,
      bookingHorizonDays: cfg.bookingHorizonDays,
      cards: Object.keys(cards).reduce((acc, k) => {
        acc[k] = { label: cards[k].label, sessions: cards[k].sessions,
                   unitCents: cards[k].unitCents, totalCents: cards[k].totalCents };
        return acc;
      }, {}),
    },
  });
}

/* ---- Sperren ---- */

async function adminBlock(body, env, on) {
  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Bitte ein Datum angeben.' }, 400);

  if (body.slotId) {
    const slot = slotsForDate(date).find((s) => s.slotId === body.slotId);
    if (!slot) return json({ error: 'Diesen Termin gibt es an dem Tag nicht.' }, 400);
    const key = `blockslot:${date}:${body.slotId}`;
    if (on) {
      if (await env.VOUCHERS.get(`booking:${date}:${body.slotId}`)) {
        return json({ error: 'Da liegt schon eine Buchung. Sag den Termin ab, statt ihn zu sperren.' }, 409);
      }
      await env.VOUCHERS.put(key, '1');
    } else {
      await env.VOUCHERS.delete(key);
    }
    return json({ ok: true, date, slotId: body.slotId, blocked: on });
  }

  const key = `block:${date}`;
  if (on) await env.VOUCHERS.put(key, '1');
  else await env.VOUCHERS.delete(key);
  return json({ ok: true, date, blocked: on });
}

/* ---- Buchung absagen ---- */

async function adminCancel(body, env) {
  const date = String(body.date || '').slice(0, 10);
  const key = `booking:${date}:${body.slotId}`;
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return json({ error: 'Diese Buchung gibt es nicht (mehr).' }, 404);
  const b = JSON.parse(raw);
  const verfallen = body.verfallen === true;   // kurzfristig abgesagt: Einheit bleibt abgezogen
  if (verfallen && !(b.card_code || b.voucher_code)) {
    return json({ error: 'Ohne Karte oder Gutschein gibt es nichts, was verfallen könnte – bitte normal absagen.' }, 400);
  }

  // Karte oder Gutschein zurückbuchen
  const code = b.card_code || b.voucher_code;
  let refunded = '';
  if (code && !verfallen) {
    const vRaw = await env.VOUCHERS.get(`voucher:${code}`);
    if (vRaw) {
      const v = JSON.parse(vRaw);
      if (v.kind === 'karte') {
        v.sessions_used = Math.max(0, (v.sessions_used || 0) - 1);
        refunded = 'Eine Einheit wurde der Karte wieder gutgeschrieben.';
      } else if (b.voucher_cents) {
        v.redeemed_cents = Math.max(0, (v.redeemed_cents || 0) - b.voucher_cents);
        refunded = `${fmtEur(b.voucher_cents)} wurden dem Gutschein wieder gutgeschrieben.`;
      }
      v.status = 'active';
      v.redemptions = (v.redemptions || []).filter((r) => r.booking_id !== b.id);
      await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(v));
    }
  }

  if (verfallen) {
    // Der Termin fällt weg (Platz wird frei), die Buchung bleibt als Nachweis unter verfallen:… und zählt auf der Karte weiter
    const vf = Object.assign({}, b, { status: 'verfallen', verfallen_at: new Date().toISOString(), verfallen_grund: clean(body.grund, 200) });
    await env.VOUCHERS.put(`verfallen:${b.date}:${b.slot_id}:${b.id}`, JSON.stringify(vf));
    await env.VOUCHERS.delete(key);
    await markFree([key], env);
    await calendarMarkVerfallen(b, env);
    let mailVf = false;
    if (body.notify === true) {
      try { await sendVerfallenMail(b, env, String(body.grund || '')); mailVf = true; } catch (err) { console.error('Mail Verfallen', err); }
    }
    return json({ ok: true, verfallen: true, mail: mailVf, refunded: '', hinweis: 'Der Termin ist abgesagt. Die Einheit bleibt auf der Karte abgezogen.' });
  }

  await env.VOUCHERS.delete(key);
  await calendarRemove(b, env);
  if (body.notify !== false) await sendCancelMail(b, env, String(body.grund || ''));

  return json({
    ok: true,
    refunded,
    hinweis: b.open_cents > 0
      ? `Es wurden ${fmtEur(b.open_cents)} bezahlt – die Rückerstattung machst du in Stripe.`
      : '',
  });
}

async function sendCancelMail(b, env, grund) {
  const cfg = config(env);
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(b.name))},</p>
    <p style="margin:0 0 22px">dein Termin am <b>${esc(fmtDate(b.date))} um ${esc(b.start)} Uhr</b>
      in ${esc(b.city)} muss leider ausfallen.${grund ? ' ' + esc(grund) : ''}</p>
    <p style="margin:0 0 22px">Such dir gern einen neuen Termin aus &ndash;
      ${b.card_code ? 'deine Einheit ist wieder frei.' : b.voucher_code ? 'dein Guthaben ist wieder frei.' : 'melde dich einfach.'}</p>
    <p style="margin:0 0 22px;text-align:center">
      <a href="${esc(cfg.siteOrigin)}/termin-buchen.html" style="display:inline-block;background:#EFB92E;color:#15171C;
        padding:14px 26px;font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;
        font-size:14px">Neuen Termin aussuchen</a></p>
    <p style="margin:0;font-size:14px;color:#9AA0AB">Fragen? ${esc(cfg.ownerPhone)} oder ${esc(cfg.ownerEmail)}</p>`;

  await sendMail(env, {
    to: b.email,
    subject: `Termin am ${fmtDate(b.date)} muss leider ausfallen`,
    html: mailShell('Termin abgesagt', inner, env),
  });
}

/* ---- Gutscheine und Karten ---- */

async function adminCodes(url, env) {
  const q = (url.searchParams.get('q') || '').trim().toUpperCase();
  const list = await env.VOUCHERS.list({ prefix: 'voucher:' });
  const out = [];
  const zaehl = await kartenZaehlung(env);   // TERMIN-HOOK

  for (const k of list.keys) {
    const raw = await env.VOUCHERS.get(k.name);
    if (!raw) continue;
    const v = JSON.parse(raw);
    const hay = `${v.code} ${v.buyer_name || ''} ${v.buyer_email || ''} ${v.recipient_name || ''}`.toUpperCase();
    if (q && !hay.includes(q)) continue;

    out.push(v.kind === 'karte'
      ? { kind: 'karte', code: v.code, label: v.label, name: v.buyer_name, email: v.buyer_email,
          total: v.sessions_total, used: v.sessions_used, left: v.sessions_total - v.sessions_used,
          done: kartenStand(v, zaehl.get(v.code)).done, upcoming: kartenStand(v, zaehl.get(v.code)).upcoming, manual: kartenStand(v, zaehl.get(v.code)).manuell,   // TERMIN-HOOK
          expires: v.expires, status: v.status, created: v.created }
      : { kind: 'gutschein', code: v.code, label: v.origin === 'probetraining' ? 'Probetraining-Gutschrift' : 'Wertgutschein',
          name: v.buyer_name, email: v.buyer_email,
          amount: fmtEur(v.amount_cents), left_cents: v.amount_cents - (v.redeemed_cents || 0),
          left: fmtEur(v.amount_cents - (v.redeemed_cents || 0)),
          expires: v.expires, status: v.status, created: v.created });
  }
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return json({ codes: out.slice(0, 100), total: out.length });
}

/** Karte oder Gutschein von Hand korrigieren. */
async function adminCode(body, env) {
  const code = String(body.code || '').toUpperCase();
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return json({ error: 'Diesen Code gibt es nicht.' }, 404);
  const v = JSON.parse(raw);

  if (body.aktion === 'stornieren') v.status = 'cancelled';
  else if (body.aktion === 'aktivieren') v.status = 'active';
  else if (body.aktion === 'einheit_zurueck' && v.kind === 'karte') {
    v.sessions_used = Math.max(0, (v.sessions_used || 0) - 1);
    v.status = 'active';
  } else if (body.aktion === 'einheit_abziehen' && v.kind === 'karte') {
    v.sessions_used = Math.min(v.sessions_total, (v.sessions_used || 0) + 1);
    if (v.sessions_used >= v.sessions_total) v.status = 'redeemed';
  } else if (body.aktion === 'verlaengern') {
    v.expires = expiryDate(new Date(), 1);
    v.status = v.status === 'redeemed' ? v.status : 'active';
  } else {
    return json({ error: 'Unbekannte Aktion.' }, 400);
  }

  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(v));
  return json({ ok: true });
}

/** Karte oder Gutschein von Hand ausstellen – etwa wenn jemand bar bezahlt. */
async function adminIssue(body, env) {
  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase();
  if (!name) return json({ error: 'Bitte einen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);

  const code = await uniqueCode(env);
  const now = new Date();

  if (body.art === 'karte') {
    const cards = await liveCards(env);
    const card = cards[body.card];
    if (!card) return json({ error: 'Diese Karte gibt es nicht.' }, 400);
    const rec = {
      kind: 'karte', code, token: randomToken(20), card: body.card, label: card.label,
      sessions_total: card.sessions, sessions_used: 0, unit_cents: card.unitCents,
      amount_cents: card.totalCents, currency: 'EUR', buyer_name: name, buyer_email: email,
      created: now.toISOString(), expires: expiryDate(now, 1), status: 'active',
      redemptions: [], origin: 'manuell',
    };
    // Für Karten, die schon anderswo bezahlt wurden (z. B. Rechnung vor Systemstart): eigener Einheitspreis, Ablauf, Notiz
    const eigenerPreis = Math.round(Number(body.einheitspreis) * 100);
    if (eigenerPreis > 0) { rec.unit_cents = eigenerPreis; rec.amount_cents = eigenerPreis * card.sessions; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.gueltig_bis || ''))) rec.expires = String(body.gueltig_bis);
    if (body.notiz) rec.notiz = clean(body.notiz, 200);
    if (body.rechnung) rec.rechnung = clean(body.rechnung, 60);
    await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
    let mail = false;
    if (body.mail !== false) { await sendCardMail(rec, env, []); mail = true; }
    return json({ ok: true, code, kind: 'karte', mail });
  }

  const cents = num(body.betrag, 0) * 100;
  if (cents < 500) return json({ error: 'Bitte einen Betrag ab 5 € angeben.' }, 400);
  const rec = {
    code, token: randomToken(20), amount_cents: cents, currency: 'EUR',
    buyer_name: name, buyer_email: email, recipient_name: clean(body.fuer, 80),
    message: clean(body.nachricht, 200), delivery: 'buyer', gift_email: '', send_date: '',
    created: now.toISOString(), expires: expiryDate(now, config(env).validYears),
    status: 'active', redeemed_cents: 0, origin: 'manuell', sent: true,
  };
  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
  await sendBuyerMail(rec, env);
  return json({ ok: true, code, kind: 'gutschein' });
}

/* ---- Preise und Fristen ---- */

async function adminSettings(body, env) {
  const cur = await liveConfig(env);
  const curCards = await liveCards(env);

  const next = {
    trainingCents: num(body.trainingCents, cur.trainingCents),
    probeCents: num(body.probeCents, cur.probeCents),
    bookingLeadHours: num(body.bookingLeadHours, cur.bookingLeadHours),
    bookingHorizonDays: Math.min(180, num(body.bookingHorizonDays, cur.bookingHorizonDays)),
    cards: {},
  };
  for (const key of Object.keys(curCards)) {
    const o = (body.cards || {})[key] || {};
    const unit = num(o.unitCents, curCards[key].unitCents);
    next.cards[key] = { unitCents: unit, totalCents: num(o.totalCents, unit * curCards[key].sessions) };
  }

  await env.VOUCHERS.put('settings', JSON.stringify(next));
  return json({ ok: true, settings: next });
}

/* ------------------------------------------------------------------ */
/* Google Kalender                                                      */
/* ------------------------------------------------------------------ */
/*
 * Optional. Ohne die drei Secrets läuft alles wie bisher, nur ohne Abgleich:
 *   GOOGLE_SA_EMAIL     Mailadresse des Service Accounts
 *   GOOGLE_SA_KEY       privater Schlüssel des Service Accounts (PEM)
 *   GOOGLE_CALENDAR_ID  z. B. info@fitnessdonner.de
 * Der Kalender muss in Google für die Service-Account-Adresse freigegeben sein
 * ("Termine ändern").
 */

function calendarReady(env) {
  return Boolean(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY && env.GOOGLE_CALENDAR_ID);
}

/** Zugriffstoken holen (1 Stunde gültig, wird im KV zwischengespeichert). */
async function googleToken(env) {
  const cached = await env.VOUCHERS.get('gtoken');
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(env.GOOGLE_SA_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`)
  );
  const jwt = `${header}.${claim}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('Google-Token fehlgeschlagen', data);
    return null;
  }
  // etwas kürzer als die echte Laufzeit, damit nie ein abgelaufenes Token benutzt wird
  await env.VOUCHERS.put('gtoken', data.access_token, { expirationTtl: 3000 });
  return data.access_token;
}

/** Belegte Zeiten aus dem Google Kalender, aufgeteilt nach Tagen. */
async function calendarBusy(env, fromDate, toDate) {
  if (!calendarReady(env) || !fromDate) return [];
  try {
    const token = await googleToken(env);
    if (!token) return [];

    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: berlinToUtc(fromDate, '00:00').toISOString(),
        timeMax: berlinToUtc(toDate, '23:59').toISOString(),
        timeZone: 'Europe/Berlin',
        items: [{ id: env.GOOGLE_CALENDAR_ID }],
      }),
    });
    const data = await res.json();
    const periods = data?.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy || [];

    const out = [];
    for (const p of periods) {
      const a = berlinParts(new Date(p.start));
      const b = berlinParts(new Date(p.end));
      if (a.date === b.date) {
        out.push({ date: a.date, from: a.minutes, to: b.minutes });
      } else {
        // über Mitternacht: pro Tag eintragen
        out.push({ date: a.date, from: a.minutes, to: 24 * 60 });
        for (let d = nextDate(a.date); d < b.date; d = nextDate(d)) {
          out.push({ date: d, from: 0, to: 24 * 60 });
        }
        out.push({ date: b.date, from: 0, to: b.minutes });
      }
    }
    return out;
  } catch (err) {
    // Der Kalender darf die Buchung nie blockieren – im Zweifel ohne Abgleich weiter
    console.error('Kalenderabgleich fehlgeschlagen', err);
    return [];
  }
}

/** Bestätigten Termin in den Google Kalender eintragen. */
async function calendarInsert(b, env) {
  if (!calendarReady(env)) return;
  try {
    const token = await googleToken(env);
    if (!token) return;

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${b.label}: ${b.name}`,
          location: `${b.place}, ${b.city}`,
          // Der Freitext aus dem Formular bleibt bewusst draußen: er kann
          // Gesundheitsangaben enthalten und steht ohnehin in der Mail an dich.
          description:
            [`${b.label} über fitnessdonner.de`,
             `Name: ${b.name}`,
             `E-Mail: ${b.email}`,
             b.phone ? `Telefon: ${b.phone}` : '',
             b.note ? 'Notiz zum Anliegen: siehe Buchungsmail' : '',
             b.voucher_code ? `Gutschein: ${b.voucher_code}` : '',
             b.card_code ? `Karte: ${b.card_code}` : '',
             `Bezahlt: ${b.open_cents > 0 ? fmtEur(b.open_cents) : (b.manuell === 'bar' ? 'bar/privat (von Hand eingetragen)' : 'über Karte/Gutschein')}`]
              .filter(Boolean).join('\n'),
          start: { dateTime: `${b.date}T${b.start}:00`, timeZone: 'Europe/Berlin' },
          end: { dateTime: `${b.date}T${b.end}:00`, timeZone: 'Europe/Berlin' },
        }),
      }
    );
    // Eintrags-ID an der Buchung merken – damit lässt er sich beim Verschieben oder Absagen löschen
    const ev = await res.json().catch(() => ({}));
    if (ev && ev.id) {
      const key = `booking:${b.date}:${b.slot_id}`;
      const raw = await env.VOUCHERS.get(key);
      if (raw) {
        const cur = JSON.parse(raw);
        if (cur.id === b.id) {
          cur.gcal_id = ev.id;
          await env.VOUCHERS.put(key, JSON.stringify(cur));
        }
      }
      b.gcal_id = ev.id;
    }
  } catch (err) {
    console.error('Kalendereintrag fehlgeschlagen', err);
  }
}

/** Eintrag einer Buchung aus dem Google Kalender löschen (beim Verschieben und Absagen). */
async function calendarRemove(b, env) {
  if (!calendarReady(env)) return;
  try {
    const token = await googleToken(env);
    if (!token) return;
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`;
    const auth = { Authorization: `Bearer ${token}` };
    let ids = b.gcal_id ? [b.gcal_id] : [];
    if (!ids.length) {
      // Ältere Buchungen ohne gemerkte ID: über Zeit und Titel finden
      const q = new URLSearchParams({
        timeMin: berlinToUtc(b.date, b.start).toISOString(),
        timeMax: berlinToUtc(b.date, b.end).toISOString(),
        singleEvents: 'true',
        q: b.name || '',
      });
      const res = await fetch(`${base}?${q}`, { headers: auth });
      const data = await res.json().catch(() => ({}));
      ids = (data.items || []).filter((e) => e.summary === `${b.label}: ${b.name}`).map((e) => e.id);
    }
    for (const id of ids) {
      await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });
    }
  } catch (err) {
    console.error('Kalendereintrag löschen fehlgeschlagen', err);
  }
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToBuffer(pem) {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/** UTC-Zeitpunkt -> deutsches Datum + Minuten seit Mitternacht. */
function berlinParts(d) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, x) => ((acc[x.type] = x.value), acc), {});
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour === '24' ? 0 : p.hour) * 60 + Number(p.minute),
  };
}

function nextDate(date) {
  return isoDate(new Date(new Date(`${date}T12:00:00Z`).getTime() + 864e5));
}

/* ------------------------------------------------------------------ */
/* Buchung: Gutscheincode prüfen                                       */
/* ------------------------------------------------------------------ */

async function handleRedeemCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const cfg = await liveConfig(env);
  const type = BOOKING_TYPES[body.type] ? body.type : 'training';
  const price = cfg[BOOKING_TYPES[type].priceKey];
  // WV-HOOK: alles ohne "FD-" ist ein Stripe-Aktionscode
  if (wvIsPromoCode(body.code)) return wvRedeemCheck(body, env);
  const v = await loadVoucher(body.code, env);

  if (v.error) return json({ ok: false, error: v.error }, 200);

  if (v.kind === 'karte') {
    if (type !== 'training') {
      return json({
        ok: false,
        error: `${v.voucher.label} gilt nur für Personal Training, nicht für ${BOOKING_TYPES[type].label}.`,
      }, 200);
    }
    return json({
      ok: true, kind: 'karte', code: v.voucher.code, label: v.voucher.label,
      sessions_left: v.sessionsLeft, sessions_total: v.voucher.sessions_total,
      discount_cents: price, open_cents: 0,
    });
  }

  const discount = Math.min(v.remaining, price);
  return json({
    ok: true, kind: 'gutschein', code: v.voucher.code,
    remaining_cents: v.remaining, discount_cents: discount, open_cents: price - discount,
  });
}

/** Gutschein laden und prüfen. Liefert { error } oder { voucher, remaining }. */
async function loadVoucher(rawCode, env) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  if (!code) return { error: 'Bitte einen Gutscheincode eingeben.' };

  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return { error: 'Diesen Gutscheincode kennen wir nicht. Bitte prüfe die Schreibweise.' };

  const voucher = JSON.parse(raw);
  const what = voucher.kind === 'karte' ? (voucher.label || 'Diese Karte') : 'Dieser Gutschein';
  if (voucher.status === 'cancelled') return { error: `${what} wurde storniert.` };
  if (voucher.expires < isoDate(new Date())) {
    return { error: `${what} ist am ${fmtDate(voucher.expires)} abgelaufen.` };
  }

  if (voucher.kind === 'karte') {
    const left = (voucher.sessions_total || 0) - (voucher.sessions_used || 0);
    if (left <= 0) return { error: `${what} ist aufgebraucht – alle Einheiten sind eingelöst.` };
    return { voucher, kind: 'karte', sessionsLeft: left, remaining: left * (voucher.unit_cents || 0) };
  }

  const remaining = (voucher.amount_cents || 0) - (voucher.redeemed_cents || 0);
  if (remaining <= 0) return { error: 'Dieser Gutschein ist bereits vollständig eingelöst.' };

  return { voucher, kind: 'gutschein', remaining };
}

/* ------------------------------------------------------------------ */
/* Buchung: buchen                                                     */
/* ------------------------------------------------------------------ */

async function handleBook(request, env) {
  const cfg = await liveConfig(env);
  const body = await request.json().catch(() => ({}));

  const type = BOOKING_TYPES[body.type] ? body.type : 'training';
  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase();
  const phone = clean(body.phone, 40);
  const note = clean(body.note, 300);
  const date = String(body.date || '').slice(0, 10);

  if (!name) return json({ error: 'Bitte deinen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  if (!phone) return json({ error: PHONE_ERROR }, 400);

  // Kommt jemand von der Zahlseite zurück (auch über die Zurück-Taste), gibt er
  // seine eigene Reservierung zuerst frei – sonst blockiert er sich selbst
  const hold = holdId(body.hold);
  if (hold) await releaseHold(hold, env);

  // Mit einer 4er-/8er-Karte lassen sich mehrere Termine in einem Rutsch buchen
  if (Array.isArray(body.slots)) {
    return handleCardMultiBook(body, { name, email, phone, note }, env);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Bitte einen Termin auswählen.' }, 400);

  // Der Termin muss an diesem Datum tatsächlich angeboten werden
  const slot = slotsForDate(date).find((s) => s.slotId === body.slotId);
  if (!slot) return json({ error: 'Diesen Termin gibt es an diesem Tag nicht.' }, 400);

  const startsAt = berlinToUtc(date, slot.start);
  if (startsAt.getTime() < Date.now() + cfg.bookingLeadHours * 3600e3) {
    return json({ error: `Dieser Termin liegt zu kurzfristig. Bitte melde dich direkt unter ${cfg.ownerPhone}.` }, 400);
  }
  if (startsAt.getTime() > Date.now() + cfg.bookingHorizonDays * 864e5) {
    return json({ error: 'Dieser Termin liegt zu weit in der Zukunft.' }, 400);
  }

  const key = `booking:${date}:${slot.slotId}`;
  if (await env.VOUCHERS.get(`block:${date}`)) {
    return json({ error: 'An diesem Tag sind leider keine Termine möglich.' }, 409);
  }

  // Belegt ist ein Termin auch dann, wenn sich ein anderer damit überschneidet
  const taken = await takenState(env, date, date);
  // Die Schlüsselliste des KV zeigt neue Buchungen erst nach bis zu 60 s – den Termin selbst direkt prüfen
  if (overlapsAny(slot, taken.busy.get(date) || []) || (await env.VOUCHERS.get(key))) {
    return json({ error: 'Dieser Termin ist gerade vergeben worden. Bitte wähle einen anderen.' }, 409);
  }

  // Probetraining und Erstgespräch gibt es je einmal pro Person
  if (BOOKING_TYPES[type].oncePerEmail && (await env.VOUCHERS.get(`once:${type}:${email}`))) {
    return json({
      error: `${BOOKING_TYPES[type].label} gab es für diese E-Mail-Adresse schon einmal. Buche gern ein reguläres Training.`,
    }, 409);
  }

  let amount = cfg[BOOKING_TYPES[type].priceKey];
  let voucherCode = '';
  let voucherApplied = 0;

  let cardCode = '';
  // WV-HOOK: Stripe-Aktionscode (nur Personal Training, ein Code pro Buchung)
  let promoApplied = null;
  if (body.voucherCode && wvIsPromoCode(body.voucherCode)) {
    const pr = await wvCheckPromo(env, body.voucherCode, type, amount);
    if (pr.error) return json({ error: pr.error }, 400);
    promoApplied = pr;
  }
  if (body.voucherCode && !promoApplied) {
    const v = await loadVoucher(body.voucherCode, env);
    if (v.error) return json({ error: v.error }, 400);

    if (v.kind === 'karte') {
      if (type !== 'training') {
        return json({ error: `${v.voucher.label} gilt nur für Personal Training.` }, 400);
      }
      // Eine Einheit der Karte deckt genau eine Trainingseinheit ab
      cardCode = v.voucher.code;
      voucherApplied = amount;
      amount = 0;
    } else {
      voucherApplied = Math.min(v.remaining, amount);
      voucherCode = v.voucher.code;
      amount -= voucherApplied;
    }
  }

  // Neuer Vertrag (nicht nur eine Einheit einer schon gekauften Karte): Zustimmung zum
  // Beginn vor Ablauf der Widerrufsfrist ist nötig, sonst droht Widerruf ohne Wertersatz
  if (!cardCode && body.vorzeitig !== true) return json({ error: CONSENT_ERROR }, 400);

  const booking = {
    id: randomToken(16),
    date,
    orig_date: date,
    slot_id: slot.slotId,
    start: slot.start,
    end: slot.end,
    minutes: slot.minutes,
    city: slot.city,
    place: slot.place,
    type,
    label: BOOKING_TYPES[type].label,
    name,
    email,
    phone,
    note,
    price_cents: cfg[BOOKING_TYPES[type].priceKey],
    voucher_code: voucherCode,
    card_code: cardCode,
    voucher_cents: voucherApplied,
    open_cents: amount,
    created: new Date().toISOString(),
    vorzeitig_at: cardCode ? '' : new Date().toISOString(),
    status: 'pending',
  };

  // WV-HOOK: Der Rabatt wird von Stripe abgezogen (discounts), die Buchung merkt sich ihn nur
  if (promoApplied) {
    booking.promo_code = promoApplied.code;
    booking.promo_id = promoApplied.id;
    booking.promo_cents = promoApplied.discount;
    booking.open_cents = amount - promoApplied.discount;
  }

  // Der Slot wird sofort reserviert, damit in der Zahlstrecke niemand dazwischenkommt.
  // Bricht die Zahlung ab, läuft die Reservierung nach 30 Minuten von selbst aus.
  if (amount <= 0) {
    booking.status = 'confirmed';
    await env.VOUCHERS.put(key, JSON.stringify(booking));
    await indexBooking(booking, env);
    await applyVoucherRedemption(booking, env);
    await afterBookingConfirmed(booking, env);
    return json({ status: 'confirmed', id: booking.id, token: booking.id });
  }

  await env.VOUCHERS.put(key, JSON.stringify(booking), { expirationTtl: RESERVE_TTL });

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('locale', 'de');
  params.set('submit_type', 'book');
  params.set('customer_email', email);
  params.set('success_url', `${cfg.siteOrigin}/termin-bestaetigt.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${cfg.siteOrigin}/termin-buchen.html?abgebrochen=1`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(amount));
  params.set('line_items[0][price_data][product_data][name]', `${booking.label} · ${slot.city}`);
  params.set(
    'line_items[0][price_data][product_data][description]',
    `${fmtDate(date)}, ${slot.start}–${booking.end} Uhr` +
      (voucherApplied ? ` · Gutschein ${voucherCode} über ${fmtEur(voucherApplied)} angerechnet` : '')
  );
  params.set('payment_intent_data[description]', `${booking.label} ${fmtDate(date)} ${slot.start}`);
  params.set('invoice_creation[enabled]', 'true');
  params.set('customer_creation', 'always');
  params.set('billing_address_collection', 'required');
  params.set(
    'invoice_creation[invoice_data][description]',
    `${booking.label} am ${fmtDate(date)} um ${slot.start} Uhr in ${slot.city}`
  );
  params.set('invoice_creation[invoice_data][footer]', INVOICE_FOOTER_SERVICE);
  params.set('metadata[kind]', 'booking');
  params.set('metadata[booking_key]', key);
  params.set('metadata[booking_id]', booking.id);
  if (promoApplied) params.set('discounts[0][promotion_code]', promoApplied.id);   // WV-HOOK
  params.set('expires_at', String(Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60));

  const session = await createCheckoutSession(env, params, PAY_TYPES);
  if (!session || !session.url) {
    await env.VOUCHERS.delete(key);
    console.error('Stripe-Session (Buchung) fehlgeschlagen', session);
    return json({ error: 'Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.' }, 502);
  }
  await rememberReservation(hold, [booking], session.id, '', env);
  return json({ status: 'payment', url: session.url });
}

/**
 * Mehrere Termine auf einmal mit einer 4er-/8er-Karte buchen.
 * Es werden höchstens so viele Termine angenommen, wie auf der Karte noch frei sind.
 * Alles oder nichts: ist ein Termin vergeben, wird keiner gebucht (409).
 */
async function handleCardMultiBook(body, person, env) {
  const cfg = await liveConfig(env);
  if (!body.slots.length) return json({ error: 'Bitte mindestens einen Termin auswählen.' }, 400);

  const v = await loadVoucher(body.voucherCode, env);
  if (v.error) return json({ error: v.error }, 400);
  if (v.kind !== 'karte') {
    return json({ error: 'Mehrere Termine auf einmal gehen nur mit einer 4er- oder 8er-Karte.' }, 400);
  }
  if (body.slots.length > v.sessionsLeft) {
    return json({
      error: `Auf deiner ${v.voucher.label} ${v.sessionsLeft === 1 ? 'ist nur noch 1 Einheit' : `sind nur noch ${v.sessionsLeft} Einheiten`} frei.`,
    }, 400);
  }

  if (!person.phone) return json({ error: PHONE_ERROR }, 400);
  const wished = await checkWishedSlots(body.slots, v.sessionsLeft, env);
  if (wished.error) return json({ error: wished.error }, 409);

  const code = v.voucher.code;
  const now = new Date().toISOString();
  const bookings = wished.slots.map((slot) => ({
    id: randomToken(16),
    date: slot.date,
    orig_date: slot.date,
    slot_id: slot.slotId,
    start: slot.start,
    end: slot.end,
    minutes: slot.minutes,
    city: slot.city,
    place: slot.place,
    type: 'training',
    label: BOOKING_TYPES.training.label,
    name: person.name,
    email: person.email,
    phone: person.phone,
    note: person.note,
    price_cents: cfg.trainingCents,
    voucher_code: '',
    card_code: code,
    voucher_cents: cfg.trainingCents,
    open_cents: 0,
    created: now,
    status: 'confirmed',
  }));

  for (const b of bookings) {
    await env.VOUCHERS.put(`booking:${b.date}:${b.slot_id}`, JSON.stringify(b));
    await indexBooking(b, env);
  }

  // Karte einmal frisch lesen und alle Einheiten zusammen abziehen
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  const card = raw ? JSON.parse(raw) : v.voucher;
  card.redemptions = card.redemptions || [];
  for (const b of bookings) {
    card.sessions_used = (card.sessions_used || 0) + 1;
    card.redemptions.push({ date: b.date, booking_id: b.id, sessions: 1 });
  }
  if (card.sessions_used >= card.sessions_total) card.status = 'redeemed';
  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(card));

  // Die Buchung steht – Kalender und Mails dürfen sie nicht mehr kippen
  try {
    for (const b of bookings) await calendarInsert(b, env);
    const alle = await upcomingFor(person.email, env);
    await sendCardBookingsMail(bookings, card, env, alle);
  } catch (err) {
    console.error('Bestätigung (Karte, mehrere Termine) fehlgeschlagen', err);
  }
  try {
    await sendCardBookingsOwnerMail(bookings, card, env);
  } catch (err) {
    console.error('Inhaber-Mail (Karte, mehrere Termine) fehlgeschlagen', err);
  }

  const left = Math.max(0, card.sessions_total - card.sessions_used);
  return json({
    status: 'confirmed',
    count: bookings.length,
    ids: bookings.map((b) => b.id),
    code,
    label: card.label,
    sessions_left: left,
    sessions_total: card.sessions_total,
  });
}

async function confirmBookingFromSession(session, env) {
  const m = session.metadata || {};
  const raw = await env.VOUCHERS.get(m.booking_key);
  if (!raw) {
    console.error('Buchung zur Session nicht gefunden', m.booking_key);
    return;
  }
  const booking = JSON.parse(raw);
  booking.status = 'confirmed';
  booking.session_id = session.id;
  booking.paid_cents = session.amount_total;
  booking.pay_status = session.payment_status || 'paid';   // 'unpaid' = Lastschrift noch unterwegs
  delete booking.stripe_session;

  // ohne TTL neu schreiben: die Reservierung wird zur festen Buchung
  await env.VOUCHERS.put(m.booking_key, JSON.stringify(booking));
  await indexBooking(booking, env);
  await env.VOUCHERS.put(`bsession:${session.id}`, m.booking_key, { expirationTtl: 60 * 60 * 24 * 90 });
  await applyVoucherRedemption(booking, env);
  await afterBookingConfirmed(booking, env);
}

/** Eingelösten Betrag auf dem Gutschein vermerken. */
async function applyVoucherRedemption(booking, env) {
  const code = booking.card_code || booking.voucher_code;
  if (!code) return;
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return;
  const v = JSON.parse(raw);
  v.redemptions = v.redemptions || [];

  if (v.kind === 'karte') {
    v.sessions_used = (v.sessions_used || 0) + 1;
    v.redemptions.push({ date: booking.date, booking_id: booking.id, sessions: 1 });
    if (v.sessions_used >= v.sessions_total) v.status = 'redeemed';
  } else {
    if (!booking.voucher_cents) return;
    v.redeemed_cents = (v.redeemed_cents || 0) + booking.voucher_cents;
    v.redemptions.push({ date: booking.date, booking_id: booking.id, cents: booking.voucher_cents });
    if (v.redeemed_cents >= v.amount_cents) v.status = 'redeemed';
  }
  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(v));
}

async function afterBookingConfirmed(booking, env) {
  const type = BOOKING_TYPES[booking.type] || {};
  let credit = null;
  if (type.oncePerEmail) await env.VOUCHERS.put(`once:${booking.type}:${booking.email}`, booking.date);
  if (type.credit) credit = await createProbeCredit(booking, env);
  await calendarInsert(booking, env);
  const alle = await upcomingFor(booking.email, env);
  await sendBookingMail(booking, env, credit, alle);
  await sendBookingOwnerMail(booking, env);
}

/**
 * Das bezahlte Probetraining wird auf das nächste Training angerechnet:
 * dafür bekommt der Kunde automatisch einen Gutschein über den gezahlten Betrag.
 */
async function createProbeCredit(booking, env) {
  const cfg = config(env);
  const amount = booking.open_cents;
  if (amount <= 0) return null;

  const code = await uniqueCode(env);
  const now = new Date();
  const voucher = {
    code,
    token: randomToken(20),
    amount_cents: amount,
    currency: 'EUR',
    buyer_name: booking.name,
    buyer_email: booking.email,
    recipient_name: '',
    message: '',
    delivery: 'buyer',
    gift_email: '',
    send_date: '',
    created: now.toISOString(),
    expires: expiryDate(now, 1),
    status: 'active',
    redeemed_cents: 0,
    origin: 'probetraining',
    booking_id: booking.id,
    sent: true,
  };
  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(voucher));
  return { code, amount, expires: voucher.expires, link: voucherLink(voucher, env) };
}

async function handleBookingLookup(url, env) {
  const sessionId = url.searchParams.get('session_id');
  const key = sessionId ? await env.VOUCHERS.get(`bsession:${sessionId}`) : null;
  if (!key) return json({ status: 'pending' }, 202);
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return json({ status: 'pending' }, 202);

  const b = JSON.parse(raw);
  if (b.status !== 'confirmed') return json({ status: 'pending' }, 202);
  return json({
    status: 'confirmed',
    id: b.id,
    label: b.label,
    date: b.date,
    start: b.start,
    end: b.end,
    city: b.city,
    place: b.place,
    name: b.name,
    paid_formatted: fmtEur(b.open_cents),
    voucher_code: b.voucher_code,
    card_code: b.card_code || '',
    voucher_formatted: b.voucher_cents ? fmtEur(b.voucher_cents) : '',
  });
}

async function handleWebhook(request, env, ctx) {
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  const ok = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 400 });

  const event = JSON.parse(raw);
  const BEKANNT = [
    'checkout.session.completed', 'invoice.paid',
    'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  ];
  if (BEKANNT.indexOf(event.type) === -1) return new Response('ignored', { status: 200 });

  // Idempotenz: jedes Event nur einmal verarbeiten
  const seen = await env.VOUCHERS.get(`event:${event.id}`);
  if (seen) return new Response('duplicate', { status: 200 });
  await env.VOUCHERS.put(`event:${event.id}`, '1', { expirationTtl: 60 * 60 * 24 * 30 });

  if (event.type === 'invoice.paid') {
    // KARTE-HOOK: Rechnungen aus der Verwaltung gehen schon mit der Karten-Mail raus, hier nur den Status merken (QR: Mail erst jetzt)
    if (event.data.object.metadata && event.data.object.metadata.fd_karte) {
      ctx.waitUntil(karteRechnungBezahlt(event.data.object, env));
      if (event.data.object.metadata.fd_zahlart === 'qr') ctx.waitUntil(karteQrAbschluss(env, event.data.object, 'paid'));   // QR: jetzt geht die Karten-Mail raus
      return new Response('ok', { status: 200 });
    }
    ctx.waitUntil(sendInvoiceMail(event.data.object, env));
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object;
  // KURSE-HOOK: Kurszahlungen haben ihre eigene Verarbeitung
  if ((session.metadata || {}).kind === 'kurs') {
    if (event.type === 'checkout.session.completed') ctx.waitUntil(kursConfirmFromSession(session, env));
    else ctx.waitUntil(kursPayStatus(session, event.type, env));
    return new Response('ok', { status: 200 });
  }
  // Lastschrift: Der Termin steht schon seit checkout.session.completed.
  // Hier kommt nur noch die Nachricht, ob das Geld wirklich eingegangen ist.
  if (event.type === 'checkout.session.async_payment_succeeded') {
    ctx.waitUntil(setPayStatus(session, 'paid', env));
    return new Response('ok', { status: 200 });
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    ctx.waitUntil(handleDebitFailed(session, env));
    return new Response('ok', { status: 200 });
  }
  // KARTE-HOOK: Lastschrift-Mandat per Link erteilt (Checkout im Setup-Modus)
  if (session.mode === 'setup') {
    if ((session.metadata || {}).kind === 'mandat') ctx.waitUntil(karteMandatErhalten(session, env));
    return new Response('ok', { status: 200 });
  }
  var kind = (session.metadata || {}).kind;
  if (kind === 'booking') {
    ctx.waitUntil(confirmBookingFromSession(session, env));
  } else if (kind === 'karte') {
    ctx.waitUntil(createCardFromSession(session, env));
  } else {
    ctx.waitUntil(createVoucherFromSession(session, env));
  }
  return new Response('ok', { status: 200 });
}

async function createVoucherFromSession(session, env) {
  const cfg = config(env);
  const m = session.metadata || {};
  const code = await uniqueCode(env);
  const token = randomToken(20);
  const now = new Date();

  const voucher = {
    code,
    token,
    amount_cents: session.amount_total,
    currency: (session.currency || 'eur').toUpperCase(),
    buyer_name: m.buyer_name || '',
    buyer_email: session.customer_details?.email || session.customer_email || '',
    recipient_name: m.recipient_name || '',
    message: m.message || '',
    delivery: m.delivery || 'buyer',
    gift_email: m.gift_email || '',
    send_date: m.send_date || '', send_time: m.send_time || '', design: m.design || '', pdf: m.pdf || '', bastel: m.bastel || '',
    created: now.toISOString(),
    expires: expiryDate(now, cfg.validYears),
    status: 'active',
    redeemed_cents: 0,
    session_id: session.id,
    sent: false,
  };

  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(voucher));
  await env.VOUCHERS.put(`session:${session.id}`, code, { expirationTtl: 60 * 60 * 24 * 90 });

  // Käufer bekommt immer eine Bestätigung (inkl. Gutschein, wenn er selbst verschenkt)
  await sendBuyerMail(voucher, env);
  await sendOwnerMail(voucher, env);

  if (voucher.delivery === 'gift') {
    if (voucher.send_date) {
      // Für den Wunschtag vormerken – der Cron verschickt ihn dann
      await env.VOUCHERS.put(gsPendingKey(voucher), code);
    } else {
      await sendGiftMail(voucher, env);
      voucher.sent = true;
      await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(voucher));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Gutschein-Abruf für die Website                                  */
/* ------------------------------------------------------------------ */

async function handleVoucherLookup(url, env) {
  const sessionId = url.searchParams.get('session_id');
  const codeParam = (url.searchParams.get('code') || '').toUpperCase();
  const token = url.searchParams.get('t') || '';

  let code = null;
  if (sessionId) {
    code = await env.VOUCHERS.get(`session:${sessionId}`);
    if (!code) return json({ status: 'pending' }, 202); // Webhook noch nicht durch
  } else if (codeParam && token) {
    code = codeParam;
  } else {
    return json({ error: 'Fehlende Parameter.' }, 400);
  }

  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return json({ error: 'Gutschein nicht gefunden.' }, 404);
  const v = JSON.parse(raw);

  // Zugriff per Code nur mit passendem Token
  if (!sessionId && v.token !== token) return json({ error: 'Kein Zugriff.' }, 403);

  if (v.kind === 'karte') {
    return json({
      status: 'ready',
      kind: 'karte',
      code: v.code,
      token: v.token,
      label: v.label,
      sessions_total: v.sessions_total,
      sessions_used: v.sessions_used,
      sessions_left: v.sessions_total - v.sessions_used,
      unit_formatted: fmtEur(v.unit_cents),
      amount_formatted: fmtEur(v.amount_cents),
      buyer_name: v.buyer_name,
      created: v.created,
      expires: v.expires,
    });
  }

  return json({
    status: 'ready',
    code: v.code,
    token: v.token,
    amount: v.amount_cents / 100,
    amount_formatted: fmtEur(v.amount_cents),
    buyer_name: v.buyer_name,
    recipient_name: v.recipient_name,
    message: v.message,
    created: v.created,
    expires: v.expires,
    delivery: v.delivery,
    send_date: v.send_date, send_time: v.send_time || '', design: v.design || '',
  });
}

/* Gutschein als PDF zum Herunterladen: /api/voucher-pdf?code=FD-XXXX-XXXX&t=TOKEN
   Gleiche Prüfung wie beim Abruf (Code + Token), dasselbe PDF wie der Mail-Anhang. */
async function handleVoucherPdf(url, env) {
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const token = url.searchParams.get('t') || '';
  if (!code || !token) return json({ error: 'Fehlende Parameter.' }, 400);
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return json({ error: 'Gutschein nicht gefunden.' }, 404);
  const v = JSON.parse(raw);
  if (v.token !== token) return json({ error: 'Kein Zugriff.' }, 403);
  if (v.kind === 'karte') return json({ error: 'Für Karten gibt es kein PDF.' }, 400);
  let pdf;
  try { pdf = await xmPdf(v, env); } catch (e) { console.error('PDF fehlgeschlagen', e); return json({ error: 'Das PDF konnte gerade nicht erstellt werden.' }, 500); }
  let body = pdf;
  if (typeof pdf === 'string') { const bin = atob(pdf); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); body = a; }
  return new Response(body, { status: 200, headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="Gutschein-Fitness-Donner-${v.code}.pdf"`,
    'Cache-Control': 'private, no-store',
  } });
}

/* ------------------------------------------------------------------ */
/* 4. Geplanter Versand (Cron)                                         */
/* ------------------------------------------------------------------ */

/* GS-ZEIT: Vormerkungen liegen unter pending:JJJJ-MM-TT[THH:MM]:CODE. Ältere Einträge ohne
   Uhrzeit gelten als 08:00. Verschickt wird alles, dessen Zeitpunkt (deutsche Zeit) erreicht
   oder überschritten ist – auch Liegengebliebenes von Vortagen. */
const GS_STANDARDZEIT = '08:00';

function gsBerlinNow(ms) {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms == null ? Date.now() : ms));
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

function gsPendingKey(v) {
  return `pending:${v.send_date}${v.send_time ? 'T' + v.send_time : ''}:${v.code}`;
}

/* Merkt sich, dass der Viertelstunden-Cron läuft (höchstens alle 6 Stunden ein Schreibvorgang). */
async function gsTaktMerken(env) {
  try {
    const alt = Number(await env.VOUCHERS.get('gs:takt')) || 0;
    if (Date.now() - alt > 6 * 3600e3) await env.VOUCHERS.put('gs:takt', String(Date.now()));
  } catch (e) { /* nur ein Merker */ }
}
async function gsTaktAktiv(env) {
  try { return Date.now() - (Number(await env.VOUCHERS.get('gs:takt')) || 0) < 13 * 3600e3; } catch (e) { return true; }
}

async function sendScheduledVouchers(env, opts) {
  const jetzt = gsBerlinNow();
  if (opts && opts.takt) await gsTaktMerken(env);
  const list = await env.VOUCHERS.list({ prefix: 'pending:' });
  for (const key of list.keys) {
    const rest = key.name.slice(8);
    const date = rest.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const time = rest[10] === 'T' ? rest.slice(11, 16) : GS_STANDARDZEIT;
    if (date > jetzt.date || (date === jetzt.date && time > jetzt.time)) continue;   // noch nicht fällig
    const code = await env.VOUCHERS.get(key.name);
    if (!code) continue;
    const raw = await env.VOUCHERS.get(`voucher:${code}`);
    if (!raw) continue;
    const v = JSON.parse(raw);
    if (v.sent) { await env.VOUCHERS.delete(key.name); continue; }
    try {
      await sendGiftMail(v, env);
      v.sent = true;
      await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(v));
      await env.VOUCHERS.delete(key.name);
    } catch (e) {
      console.error('Geplanter Versand fehlgeschlagen für', code, e);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5. E-Mails                                                          */
/* ------------------------------------------------------------------ */

function voucherLink(v, env) {
  const cfg = config(env);
  return `${cfg.siteOrigin}/gutschein-danke.html?code=${encodeURIComponent(v.code)}&t=${encodeURIComponent(v.token)}`;
}

function auspackLink(v, env) {
  const cfg = config(env);
  return `${cfg.siteOrigin}/auspacken.html?code=${encodeURIComponent(v.code)}&t=${encodeURIComponent(v.token)}`;
}

async function sendBuyerMail(v, env) {
  const cfg = config(env);
  const selbst = v.delivery === 'buyer';
  const intro = selbst
    ? `<p>vielen Dank für deinen Kauf! Dein Gutschein ist unten – du kannst ihn ausdrucken oder einfach weiterleiten.${v.pdf ? ' Als PDF-Datei h&auml;ngt er au&szlig;erdem an dieser Mail.' : ''}${v.bastel ? ' Die Bastelkarte zum Selbstdrucken findest du ebenfalls im Anhang (1 Blatt, 2 Seiten). Im Druckdialog &bdquo;Seiten 1&ndash;2&ldquo;, A4 quer, beidseitig und &bdquo;an der kurzen Kante wenden&ldquo; w&auml;hlen, dann in der Mitte falten. Ohne Duplex-Druck: erst Seite 1 drucken, das Blatt wenden und wieder einlegen, dann Seite 2 drucken.' : ''}</p>`
    : `<p>vielen Dank für deinen Kauf! Der Gutschein geht ${v.send_date
        ? `am <b>${fmtDate(v.send_date)}</b>${v.send_time ? ` um <b>${esc(v.send_time)} Uhr</b>` : ''}`
        : `<b>gleich</b>`} an <b>${esc(v.gift_email)}</b>. Hier ist deine Kopie:</p>`;
  const auspackTipp = selbst
    ? `<p style="font-size:14px;color:#C9CCD3">Zum &Uuml;berreichen: Schick der beschenkten Person diesen Link, dann packt sie den Gutschein am Bildschirm selbst aus: <a href="${esc(auspackLink(v, env))}" style="color:#EFB92E">Geschenk auspacken</a></p>`
    : '';

  await sendMail(env, {
    to: v.buyer_email,
    attachments: await xmAtt(v, env), subject: `Dein Gutschein über ${fmtEur(v.amount_cents)} – ${cfg.siteName}`,
    html: mailShell(
      `Hallo ${esc(firstName(v.buyer_name))},`,
      intro + voucherCardHtml(v, env) + auspackTipp + buyerFooterHtml(v, env),
      env
    ),
  });
}

async function sendGiftMail(v, env) {
  const cfg = config(env);
  const an = firstName(v.recipient_name);
  const von = firstName(v.buyer_name);
  const papier = v.design === 'nik' ? 'nik' : (v.design === 'xmas' ? 'xmas' : 'std');
  const link = auspackLink(v, env);
  await sendMail(env, {
    to: v.gift_email,
    subject: `${von || 'Jemand'} hat dir etwas eingepackt`,
    html: mailShell(
      an ? `${esc(an)}, da ist etwas für dich.` : 'Da ist etwas für dich.',
      `<p><b>${esc(v.buyer_name || 'Jemand')}</b> hat dir etwas eingepackt. Es sind keine Socken.</p>
       <table role="presentation" width="548" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:548px;margin:22px 0 10px;border-collapse:collapse"><tr><td style="padding:0;font-size:0;line-height:0"><a href="${esc(link)}" style="text-decoration:none"><img src="${esc(cfg.siteOrigin)}/mailbilder/geschenk-${papier}.jpg" width="548" alt="Ein eingepacktes Geschenk mit goldener Schleife" style="display:block;width:100%;max-width:548px;height:auto;border:0"></a></td></tr></table>
       <p><a href="${esc(link)}" style="display:inline-block;background:#EFB92E;color:#15171C;font-weight:700;text-decoration:none;padding:14px 26px;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Geschenk auspacken</a></p>
       <p style="font-size:14px;color:#C9CCD3">Der Button &ouml;ffnet dein Geschenk im Browser. Dort ${v.message ? `warten dein Gutschein und eine Nachricht${von ? ' von ' + esc(von) : ''}` : 'wartet dein Gutschein'}, und du kannst direkt einen Termin buchen.</p>
       ${whatsappBlockHtml(null, env, { text: `Hallo ${firstName(cfg.ownerName) || 'Niklas'}, ich habe einen Gutschein bekommen (Code ${v.code}) und eine Frage`, intro: 'Bei Fragen oder Problemen schreib mir einfach direkt per WhatsApp:' })}
       <p>Ich freue mich auf dich!<br>${esc(cfg.ownerName)}</p>`,
      env,
      'Es sind keine Socken. Versprochen.',
      { ohneFragen: true }
    ),
  });
}

function bookingListHtml(bookings, env) {
  if (!bookings || !bookings.length) return '';
  const rows = bookings
    .slice()
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map((b) => `<tr><td style="padding:7px 0;font-size:14px;color:#ECE9E2">${esc(fmtDate(b.date))}, ${esc(b.start)}–${esc(b.end)} Uhr</td>
      <td style="padding:7px 0;font-size:14px;text-align:right;color:#9AA0AB">${esc(b.city)}${env && b.id
        ? ` &middot; <a href="${esc(moveLink(b, env))}" style="color:#EFB92E">verschieben</a>` : ''}</td></tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:22px">${rows}</table>`;
}

async function sendCardMail(c, env, bookings) {
  const cfg = config(env);
  const link = `${cfg.siteOrigin}/termin-buchen.html?art=training&code=${encodeURIComponent(c.code)}`;
  const booked = (bookings || []).length;
  const left = c.sessions_total - c.sessions_used;
  const rows =
    row('Karte', `${c.label} · ${c.sessions_total} Einheiten`) +
    row('Preis pro Einheit', fmtEur(c.unit_cents)) +
    row('Bezahlt', fmtEur(c.amount_cents)) +
    row('Einlösbar bis', fmtDate(c.expires));

  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(c.buyer_name))},</p>
    <p style="margin:0 0 22px">deine ${esc(c.label)} ist aktiv.${booked
      ? ` ${booked === 1 ? 'Ein Termin steht' : booked + ' Termine stehen'} schon fest:`
      : ' Du kannst deine Termine jetzt einzeln buchen, wann immer es dir passt – du musst nicht alle auf einmal festlegen.'}</p>
    ${bookingListHtml(bookings, env)}
    ${booked ? `<p style="margin:0 0 22px;font-size:14px;color:#9AA0AB">Jeder Termin h&auml;ngt als eigene Kalenderdatei an dieser Mail &ndash; einmal antippen, dann steht er in deinem Kalender.</p>` : ''}
    <div style="border:1px solid #EFB92E;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#B8860B">Dein Code</div>
      <p style="margin:10px 0 0;font-size:26px;letter-spacing:.12em;font-weight:700;color:#ECE9E2">${esc(c.code)}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#9AA0AB">noch ${left} von ${c.sessions_total} Einheiten frei</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>
    <p style="margin:0 0 22px;text-align:center">
      ${left > 0 ? `<a href="${esc(link)}" style="display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;
        font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px">${booked ? 'Weitere Termine buchen' : 'Ersten Termin buchen'}</a>` : ''}
    </p>
    ${left > 0 ? cardHowToHtml(c.code, c.expires, left, c.sessions_total, link) : ''}
    ${whatsappBlockHtml(null, env, { text: `Hallo ${firstName(cfg.ownerName) || 'Niklas'}, ich habe eine Frage zu meiner ${c.label} (Code ${c.code})`, intro: 'Fragen zur Karte oder zu den Terminen? Schreib mir direkt:' })}
    ${moveHtml(null, env)}
    ${widerrufMailHtml(env)}`;

  // Gleich mitgebuchte Termine: je eine Kalenderdatei anhängen
  const attachments = [];
  for (const b of (bookings || []).slice().sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start))) {
    const a = icsAttachment(b, env)[0];
    a.filename = `Termin-${b.date}-${b.start.replace(':', '')}.ics`;
    attachments.push(a);
  }

  await sendMail(env, {
    to: c.buyer_email,
    subject: `Deine ${c.label} ist aktiv – Code ${c.code}`,
    html: mailShell(c.label + ' aktiv', inner, env),
    attachments,
  });
}

async function sendCardOwnerMail(c, env, bookings) {
  const cfg = config(env);
  const rows =
    row('Karte', `${c.label} · ${c.sessions_total} Einheiten`) +
    row('Code', c.code) +
    row('Name', c.buyer_name) +
    row('E-Mail', c.buyer_email) +
    row('Bezahlt', fmtEur(c.amount_cents)) +
    row('Termine gebucht', `${(bookings || []).length} von ${c.sessions_total}`) +
    row('Einlösbar bis', fmtDate(c.expires));

  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Karte verkauft: ${c.label} an ${c.buyer_name}`,
    html: mailShell('Karte verkauft',
      `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">${rows}</table>` + bookingListHtml(bookings),
      env),
  });
}

async function sendBookingMail(b, env, credit, alle) {
  const cfg = config(env);
  const rows =
    row('Termin', `${fmtDate(b.date)}, ${b.start}–${b.end} Uhr`) +
    row('Ort', `${b.place}, ${b.city}`) +
    row('Leistung', b.label) +
    (b.card_code ? row('Karte', `${b.card_code} · eine Einheit eingelöst`) : '') +
    (b.voucher_code && b.voucher_cents ? row('Gutschein', `${b.voucher_code} · ${fmtEur(b.voucher_cents)} angerechnet`) : '') +
    (b.promo_code ? row('Aktionscode', `${esc(b.promo_code)} · ${fmtEur(b.promo_cents)} Rabatt`) : '') +
    row('Bezahlt', b.open_cents > 0 ? fmtEur(b.open_cents) : 'bereits beglichen');

  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(b.name))},</p>
    <p style="margin:0 0 22px">dein Termin steht. Ich freue mich auf dich!</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>
    ${credit ? `
    <div style="border:1px solid #EFB92E;padding:18px 20px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#B8860B">
        Dein Probetraining wird angerechnet
      </div>
      <p style="margin:10px 0 0;font-size:15px">
        Wenn du danach weitermachst, ziehen wir die ${esc(fmtEur(credit.amount))} vom n&auml;chsten Training ab.
        Gib beim Buchen einfach diesen Code ein:
      </p>
      <p style="margin:12px 0 0;font-size:22px;letter-spacing:.1em;font-weight:700">${esc(credit.code)}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#9AA0AB">G&uuml;ltig bis ${esc(fmtDate(credit.expires))}</p>
    </div>` : ''}
    <p style="margin:0 0 18px;font-size:14px;color:#9AA0AB">
      Der Termin h&auml;ngt als Kalenderdatei an dieser Mail &ndash; einmal antippen, dann steht er
      in deinem Kalender und erinnert dich selbst noch mal am Vortag.
    </p>
    ${whatsappBlockHtml(b, env)}
    ${overviewHtml(alle, b)}
    ${moveHtml(b, env)}
    <p style="margin:0;font-size:12px;color:#9ca3af">
      Am Tag vor dem Termin schicke ich dir noch eine kurze Erinnerung. Magst du keine,
      antworte einfach auf diese Mail.
    </p>
    ${b.vorzeitig_at ? widerrufMailHtml(env) : ''}`;

  await sendMail(env, {
    to: b.email,
    subject: `Termin bestätigt: ${b.label} am ${fmtDate(b.date)}`,
    html: mailShell('Termin bestätigt', inner, env),
    attachments: icsAttachment(b, env),
  });
}

/** Eine Bestätigung für alle mit der Karte gebuchten Termine – mit je einer Kalenderdatei. */
async function sendCardBookingsMail(bookings, card, env, alle) {
  if (bookings.length === 1) return sendBookingMail(bookings[0], env, null, alle);
  const cfg = config(env);
  const left = Math.max(0, card.sessions_total - card.sessions_used);
  const link = `${cfg.siteOrigin}/termin-buchen.html?art=training&code=${encodeURIComponent(card.code)}`;
  const neu = new Set(bookings.map((b) => b.id));
  const sorted = bookings.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const weitere = (alle || []).filter((b) => !neu.has(b.id));

  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(sorted[0].name))},</p>
    <p style="margin:0 0 22px">deine ${bookings.length} Termine stehen. Ich freue mich auf dich!</p>
    ${bookingListHtml(sorted, env)}
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${row('Ort', `${sorted[0].place}, ${sorted[0].city}`)}
      ${row('Karte', `${card.label} · ${card.code}`)}
      ${row('Eingelöst', `${bookings.length} Einheiten`)}
      ${row('Noch frei', `${left} von ${card.sessions_total} Einheiten`)}
    </table>
    ${left > 0 ? `<p style="margin:0 0 22px;text-align:center">
      <a href="${esc(link)}" style="display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;
        font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px">Restliche Termine buchen</a>
    </p>
    ${cardHowToHtml(card.code, card.expires, left, card.sessions_total, link)}` : ''}
    <p style="margin:0 0 18px;font-size:14px;color:#9AA0AB">
      Jeder Termin h&auml;ngt als eigene Kalenderdatei an dieser Mail &ndash; einmal antippen, dann steht er
      in deinem Kalender und erinnert dich selbst noch mal am Vortag.
    </p>
    ${whatsappBlockHtml(sorted[0], env)}
    ${weitere.length ? overviewHtml(alle, null) : ''}
    ${moveHtml(null, env)}
    <p style="margin:0;font-size:12px;color:#9ca3af">
      Am Tag vor jedem Termin schicke ich dir noch eine kurze Erinnerung. Magst du keine,
      antworte einfach auf diese Mail.
    </p>`;

  const attachments = [];
  for (const b of sorted) {
    const a = icsAttachment(b, env)[0];
    a.filename = `Termin-${b.date}-${b.start.replace(':', '')}.ics`;
    attachments.push(a);
  }

  await sendMail(env, {
    to: sorted[0].email,
    subject: `${bookings.length} Termine bestätigt – ${card.label}`,
    html: mailShell(`${bookings.length} Termine bestätigt`, inner, env),
    attachments,
  });
}

async function sendCardBookingsOwnerMail(bookings, card, env) {
  if (bookings.length === 1) return sendBookingOwnerMail(bookings[0], env);
  const cfg = config(env);
  const b = bookings[0];
  const left = Math.max(0, card.sessions_total - card.sessions_used);
  const rows =
    row('Leistung', `${b.label} · ${bookings.length} Termine`) +
    row('Name', b.name) +
    row('E-Mail', b.email) +
    (b.phone ? row('Telefon', b.phone) : '') +
    (b.note ? row('Nachricht', b.note) : '') +
    row('Karte', `${card.code} · ${bookings.length} Einheiten eingelöst, ${left} frei`);

  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Neue Buchungen: ${bookings.length}× ${b.label} (${card.label}, ${b.name})`,
    html: mailShell('Neue Buchungen',
      `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">${rows}</table>` + bookingListHtml(bookings),
      env),
  });
}

async function sendBookingOwnerMail(b, env) {
  const cfg = config(env);
  const rows =
    row('Termin', `${fmtDate(b.date)}, ${b.start}–${b.end} Uhr`) +
    row('Ort', `${b.place}, ${b.city}`) +
    row('Leistung', b.label) +
    row('Name', b.name) +
    row('E-Mail', b.email) +
    (b.phone ? row('Telefon', b.phone) : '') +
    (b.note ? row('Nachricht', b.note) : '') +
    (b.card_code ? row('Karte', `${b.card_code} · eine Einheit`) : '') +
    (b.voucher_code && b.voucher_cents ? row('Gutschein', `${b.voucher_code} · ${fmtEur(b.voucher_cents)}`) : '') +
    row('Bezahlt', b.open_cents > 0 ? fmtEur(b.open_cents) : 'über Karte/Gutschein');

  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Neue Buchung: ${b.label}, ${fmtDate(b.date)} ${b.start} Uhr`,
    html: mailShell('Neue Buchung', `<table style="width:100%;border-collapse:collapse">${rows}</table>`, env),
  });
}

async function sendOwnerMail(v, env) {
  const cfg = config(env);
  const taktFehlt = v.delivery === 'gift' && v.send_time && !(await gsTaktAktiv(env));
  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Gutschein verkauft: ${fmtEur(v.amount_cents)} (${v.code})`,
    html: mailShell(
      'Neuer Gutscheinverkauf',
      `<table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Betrag', fmtEur(v.amount_cents))}
        ${row('Code', v.code)}
        ${row('Käufer', `${esc(v.buyer_name)} &lt;${esc(v.buyer_email)}&gt;`)}
        ${row('Beschenkt', esc(v.recipient_name) || '–')}
        ${row('Versand', v.delivery === 'gift' ? `direkt an ${esc(v.gift_email)}${v.send_date ? ` am ${fmtDate(v.send_date)}${v.send_time ? ` um ${esc(v.send_time)} Uhr` : ''}` : ' (sofort)'}` : 'an den Käufer')}
        ${row('Nachricht', esc(v.message) || '–')}
        ${row('Gültig bis', fmtDate(v.expires))}
      </table>
      ${taktFehlt ? '<p style="margin-top:20px;padding:12px 14px;border:1px solid #EFB92E;color:#EFB92E;font-size:14px">Achtung: Der Viertelstunden-Zeitplan (Cron */15 * * * *) ist in Cloudflare nicht aktiv. Ohne ihn geht dieser Gutschein nicht zur gew&auml;hlten Uhrzeit raus, sondern erst mit dem n&auml;chsten Morgenlauf.</p>' : ''}
      <p style="margin-top:20px"><a href="${voucherLink(v, env)}" style="color:#EFB92E">Gutschein ansehen</a></p>`,
      env
    ),
  });
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#9AA0AB;white-space:nowrap;vertical-align:top">${label}</td>
    <td style="padding:8px 0;color:#ECE9E2">${value}</td>
  </tr>`;
}

function buyerFooterHtml(v, env) {
  const cfg = config(env);
  return `<p style="margin-top:26px">Eingelöst wird der Gutschein online: Wer ihn hat, bucht auf
    <a href="${esc(cfg.siteOrigin)}/termin-buchen.html?art=training&code=${encodeURIComponent(v.code)}" style="color:#EFB92E">fitnessdonner.de</a>
    einen Termin, der Code ist dann schon eingetragen. Fragen gehen auch per WhatsApp unter ${esc(cfg.ownerPhone)}
    oder per Mail an <a href="mailto:${esc(cfg.ownerEmail)}" style="color:#EFB92E">${esc(cfg.ownerEmail)}</a>.</p>
    <p style="color:#9AA0AB;font-size:13px">Die Rechnung zu deinem Kauf kommt separat von Stripe.
    Als Kleinunternehmer im Sinne von § 19 UStG berechne ich keine Umsatzsteuer.</p>`;
}

function xmDesign(d) { d = String(d || ''); if (d !== 'nik' && d !== 'xmas') return ''; return (d === 'nik' && Date.now() > Date.UTC(new Date().getUTCFullYear(), 11, 6, 17, 0)) ? 'xmas' : d; } function xmTheme(h, v) { var g = v.design === 'nik', bg = g ? '#7E1A22' : '#17402F'; return h.replace('background:#1C1F26;border:1px solid #7A6220', 'background:' + bg + ';border:2px solid #F5D061').replace('<tr><td style="padding:32px">', '<tr><td height="10" style="background-color:' + (g ? '#F5D061' : '#C8323A') + ';font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:32px">').replace('>Geschenkgutschein</div>', '>' + (g ? 'Frohen Nikolaus' : 'Frohe Weihnachten') + ' &middot; Geschenkgutschein</div>').replace('border-top:1px solid #2E323B', 'border-top:1px solid #F5D061'); } function voucherCardHtml(v, env) { return v.design ? xmCard2(v, env) : voucherCardHtmlStd(v, env); } function xmCard2(v, env) { const cfg = config(env), c = xmPal(v.design), B = cfg.siteOrigin + '/mailbilder/' + c.p + '-'; const fuer = v.recipient_name ? 'F&uuml;r <b style="color:#FFFFFF">' + esc(v.recipient_name) + '</b> ' : ''; const von = v.buyer_name ? 'von ' + esc(v.buyer_name) : ''; const msg = v.message ? '<div style="border-left:2px solid #F5D061;padding:8px 0 8px 14px;margin:16px 0;font-style:italic;color:#F3E4D6;font-size:15px;line-height:1.5">&bdquo;' + esc(v.message) + '&ldquo;</div>' : ''; return '<table role="presentation" width="548" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:548px;margin:26px 0;border-collapse:separate;border-spacing:0">' + '<tr><td style="padding:0;font-size:0;line-height:0"><img src="' + B + 'kopf2.jpg" width="548" alt="' + c.lab + '" style="display:block;width:100%;max-width:548px;height:auto;border:0"></td></tr>' + '<tr><td bgcolor="' + c.mid + '" style="padding:0;background-color:' + c.mid + ';border-left:2px solid #F5D061;border-right:2px solid #F5D061;border-bottom:2px solid #F5D061">' + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + c.mid + '" style="width:100%;border-collapse:collapse;background-color:' + c.mid + '"><tr>' + '<td width="83%" valign="top" style="width:83.4%;padding:4px 8px 26px 24px;color:#FFFFFF">' + '<div style="font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#F5D061">' + c.lab + ' &middot; Geschenkgutschein</div>' + '<div style="font-size:30px;line-height:1.15;font-weight:800;color:#FFFFFF;letter-spacing:.02em;text-transform:uppercase;margin:12px 0 0">Personal Training<br>und Kurse</div>' + '<div style="font-size:42px;line-height:1.1;font-weight:800;color:#F5D061;margin:10px 0 6px">' + fmtEur(v.amount_cents) + '</div>' + '<div style="font-size:15px;color:#F3E4D6">' + fuer + von + '</div>' + msg + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid #C9A04A;margin-top:18px"><tr><td style="padding-top:14px">' + '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#F0DCCB">Gutschein-Code</div>' + '<div style="font-size:23px;font-weight:800;letter-spacing:.1em;color:#FFFFFF;margin-top:3px">' + esc(v.code) + '</div>' + '<div style="font-size:12px;color:#F0DCCB;margin-top:8px;line-height:1.6">G&uuml;ltig bis ' + fmtDate(v.expires) + ' &middot; <a href="' + esc(cfg.siteOrigin) + '" style="color:#F0DCCB;text-decoration:none">' + esc(cfg.siteOrigin.replace('https://', '')) + '</a></div>' + '</td></tr></table></td>' + '<td width="9%" valign="top" bgcolor="#F5D061" style="width:8.8%;padding:0;font-size:0;line-height:0;background-color:#F5D061"><img src="' + B + 'band2.jpg" width="48" alt="" style="display:block;width:100%;height:auto;border:0"></td>' + '<td width="8%" bgcolor="' + c.mid + '" style="width:7.8%;font-size:0;line-height:0;background-color:' + c.mid + '">&nbsp;</td>' + '</tr></table></td></tr></table>' + '<p><a href="' + voucherLink(v, env) + '" style="display:inline-block;background:#EFB92E;color:#15171C;font-weight:700;text-decoration:none;padding:14px 26px;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Gutschein &ouml;ffnen &amp; drucken</a></p>'; } async function xmInline(p, att) { const list = (att || []).slice(), seen = {}, want = []; p.html = String(p.html || '').replace(/<a href="([^"]*)" style="display:inline-block;background:#EFB92E;color:#15171C;[^"]*">([\s\S]*?)<\/a>/g, function (m, h, t) { return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;border-collapse:separate;margin:6px 0"><tr><td bgcolor="#EFB92E" style="background-color:#EFB92E;border:2px solid #F5D061;padding:0"><a href="' + h + '" style="display:inline-block;background-color:#EFB92E;color:#15171C;font-weight:800;text-decoration:none;padding:16px 30px;letter-spacing:.06em;text-transform:uppercase;font-size:15px;line-height:1.2;font-family:Helvetica,Arial,sans-serif">' + t + '</a></td></tr></table>'; }) .replace(/src="(https?:\/\/[^"]+\/mailbilder\/([a-z0-9-]+)\.jpg)"/g, function (m, u, n) { if (!seen[n]) { seen[n] = 1; want.push({ u: u, f: n + '.jpg', c: 'fd-' + n }); } return 'src="cid:fd-' + n + '"'; }); p.html = p.html.replace(/src="(https?:\/\/[^"]+\/whatsapp-weiss\.png)"/g, function (m, u) { if (!seen.wa) { seen.wa = 1; want.push({ u: u, f: 'whatsapp.png', c: 'fd-wa' }); } return 'src="cid:fd-wa"'; }); for (const w of want) { let b = ''; try { const r = await fetch(w.u); if (r.ok) { const a = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); b = btoa(s); } } catch (e) { console.error('Mailbild fehlt', w.u, e); } if (b) list.push({ content: b, filename: w.f, content_id: w.c }); else p.html = p.html.split('src="cid:' + w.c + '"').join('src="' + w.u + '"'); } if (list.length) p.attachments = list; } function xmPal(d) { return d === 'nik' ? { p: 'nik', mid: '#5E1119', lab: 'Frohen Nikolaus' } : { p: 'xmas', mid: '#123425', lab: 'Frohe Weihnachten' }; } async function xmAtt(v, env) { if (v.delivery !== 'buyer' || (!v.pdf && !v.bastel)) return undefined; const out = []; if (v.pdf) { try { out.push({ filename: 'Gutschein-Fitness-Donner-' + v.code + '.pdf', content: await xmPdf(v, env) }); } catch (e) { console.error('PDF fehlgeschlagen', e); } } if (v.bastel) { try { const b = await xmBastel(v, env); if (b) out.push({ filename: 'Bastelkarte-Fitness-Donner-' + v.code + '.pdf', content: b }); } catch (e) { console.error('Bastelkarte fehlgeschlagen', e); } } return out.length ? out : undefined; } async function xmBastel(v, env) { const cfg = config(env), d = v.design; if (d !== 'nik' && d !== 'xmas') return ''; const get = async (n) => { const r = await fetch(cfg.siteOrigin + '/mailbilder/bastel-' + d + '-' + n + '.jpg'); if (!r.ok) throw new Error('Bastelvorlage fehlt: ' + n); return new Uint8Array(await r.arrayBuffer()); }; const dim = (j) => { for (let i = 2; i < j.length - 9; ) { if (j[i] !== 255) { i++; continue; } const m = j[i + 1]; if (m === 192 || m === 193 || m === 194) return [j[i + 7] * 256 + j[i + 8], j[i + 5] * 256 + j[i + 6]]; i += 2 + j[i + 2] * 256 + j[i + 3]; } return [1754, 1240]; }; const ja = await get('aussen'), ji = await get('innen'), da = dim(ja), di = dim(ji); const K = 842 / 1123, X = (x) => (x * K).toFixed(2), Y = (y) => (595 - y * K).toFixed(2); const gold = '0.961 0.816 0.380', white = '1 1 1', soft = '0.953 0.894 0.839', ink = '0.2 0.22 0.26'; let s = ''; const tx = (f, sz, col, x, y, str, tc) => { s += 'BT /' + f + ' ' + sz + ' Tf ' + col + ' rg ' + (tc || 0) + ' Tc 1 0 0 1 ' + X(x) + ' ' + Y(y) + ' Tm (' + pdfEnc(str) + ') Tj ET\n'; }; const rows = []; if (v.recipient_name) rows.push(['F2', 'F\u00fcr ' + v.recipient_name]); const von = v.buyer_name ? 'von ' + v.buyer_name : ''; if (v.message) { const room = 10 - rows.length - (von ? 1 : 0); pdfWrap(v.message, 15, 275, 0.5).slice(0, room).forEach((l) => rows.push(['F3', l])); } rows.forEach((r, i) => tx(r[0], 15, ink, 104, 254 + 44 * i, r[1])); if (von) tx('F3', 15, ink, 104, v.message || v.recipient_name ? 254 + 44 * rows.length : 254 + 44 * 9, von); const L = 644.5; tx('F2', 48, gold, L, 372, fmtEur(v.amount_cents)); const fv = ((v.recipient_name ? 'F\u00fcr ' + v.recipient_name + ' ' : '') + (v.buyer_name ? 'von ' + v.buyer_name : '')).trim(); if (fv) tx('F1', 12, soft, L, 408, fv); tx('F2', 22, white, L, 513, v.code, 2); tx('F2', 12, white, L, 567, fmtDate(v.expires)); const parts = [], offs = []; let len = 0; const put = (b) => { if (typeof b === 'string') { const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i) & 255; b = u; } parts.push(b); len += b.length; }; const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); }; const img = (n, j, dm) => { offs[n] = len; put(n + ' 0 obj\n<</Type/XObject/Subtype/Image/Width ' + dm[0] + '/Height ' + dm[1] + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + j.length + '>>\nstream\n'); put(j); put('\nendstream\nendobj\n'); }; const c1 = 'q 842 0 0 595 0 0 cm /Im0 Do Q\n', c2 = 'q 842 0 0 595 0 0 cm /Im0 Do Q\n' + s; put('%PDF-1.4\n'); obj(1, '<</Type/Catalog/Pages 2 0 R/ViewerPreferences<</Duplex/DuplexFlipShortEdge/PrintScaling/None>>>>'); obj(2, '<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>'); obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Resources<</XObject<</Im0 8 0 R>>>>/Contents 10 0 R>>'); obj(4, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Resources<</Font<</F1 5 0 R/F2 6 0 R/F3 7 0 R>>/XObject<</Im0 9 0 R>>>>/Contents 11 0 R>>'); obj(5, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'); obj(6, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>'); obj(7, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Oblique/Encoding/WinAnsiEncoding>>'); img(8, ja, da); img(9, ji, di); obj(10, '<</Length ' + c1.length + '>>\nstream\n' + c1 + 'endstream'); obj(11, '<</Length ' + c2.length + '>>\nstream\n' + c2 + 'endstream'); const xr = len; put('xref\n0 12\n0000000000 65535 f \n'); for (let n = 1; n <= 11; n++) put(String(offs[n]).padStart(10, '0') + ' 00000 n \n'); put('trailer\n<</Size 12/Root 1 0 R>>\nstartxref\n' + xr + '\n%%EOF'); const all = new Uint8Array(len); let p = 0; for (const b of parts) { all.set(b, p); p += b.length; } let o = ''; for (let i = 0; i < all.length; i += 8192) o += String.fromCharCode.apply(null, all.subarray(i, i + 8192)); return btoa(o); } function xmCard(v, env) { const cfg = config(env), c = xmPal(v.design), B = cfg.siteOrigin + '/mailbilder/' + c.p + '-', bg = 'background-repeat:no-repeat;background-position:top center;background-size:100% auto;background-color:' + c.mid + ';background-image:url(' + B + 'koerper.jpg)'; const fuer = v.recipient_name ? 'F\u00fcr <b style="color:#FFFFFF">' + esc(v.recipient_name) + '</b> ' : ''; const von = v.buyer_name ? 'von ' + esc(v.buyer_name) : ''; const msg = v.message ? '<div style="border-left:2px solid #F5D061;padding:8px 0 8px 14px;margin:16px 0;font-style:italic;color:#F3E4D6;font-size:15px;line-height:1.5">\u201e' + esc(v.message) + '\u201c</div>' : ''; const link = '<p><a href="' + voucherLink(v, env) + '" style="display:inline-block;background:#EFB92E;color:#15171C;font-weight:700;text-decoration:none;padding:14px 26px;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Gutschein \u00f6ffnen &amp; drucken</a></p>'; return '<table role="presentation" width="548" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:548px;margin:26px 0;border-collapse:separate;border-spacing:0;background-color:#1C1F26">' + '<tr><td style="padding:0;font-size:0;line-height:0;background-color:#1C1F26"><img src="' + B + 'kopf.jpg" width="548" alt="' + c.lab + '" style="display:block;width:100%;max-width:548px;height:auto;border:0"></td></tr>' + '<tr><td style="padding:0;border-left:2px solid #F5D061;border-right:2px solid #F5D061;border-bottom:2px solid #F5D061;background-color:' + c.mid + '">' + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" background="' + B + 'koerper.jpg" bgcolor="' + c.mid + '" style="width:100%;border-collapse:collapse;' + bg + '"><tr>' + '<td width="83%" valign="top" style="width:83.4%;padding:20px 6px 24px 24px">' + '<div style="font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#F5D061">' + c.lab + ' &middot; Geschenkgutschein</div>' + '<div style="font-size:30px;line-height:1.15;font-weight:800;color:#FFFFFF;letter-spacing:.02em;text-transform:uppercase;margin:12px 0 0">Personal Training<br>und Kurse</div>' + '<div style="font-size:42px;line-height:1.1;font-weight:800;color:#F5D061;margin:10px 0 6px">' + fmtEur(v.amount_cents) + '</div>' + '<div style="font-size:15px;color:#F3E4D6">' + fuer + von + '</div>' + msg + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid #C9A04A;margin-top:18px"><tr><td style="padding-top:14px">' + '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#F0DCCB">Gutschein-Code</div>' + '<div style="font-size:23px;font-weight:800;letter-spacing:.1em;color:#FFFFFF;margin-top:3px">' + esc(v.code) + '</div>' + '<div style="font-size:12px;color:#F0DCCB;margin-top:8px;line-height:1.6">G\u00fcltig bis ' + fmtDate(v.expires) + ' &middot; ' + esc(cfg.siteOrigin.replace('https://', '')) + '</div>' + '</td></tr></table></td>' + '<td width="9%" valign="top" background="' + B + 'streifen.jpg" bgcolor="#F5D061" style="width:8.8%;padding:0;font-size:0;line-height:0;background-color:#F5D061;background-image:url(' + B + 'streifen.jpg);background-repeat:repeat-y;background-size:100% 8px"><img src="' + B + 'band.jpg" width="48" alt="" style="display:block;width:100%;height:auto;border:0"></td>' + '<td width="8%" style="width:7.8%;font-size:0;line-height:0">&nbsp;</td>' + '</tr></table></td></tr></table>' + link; } function pdfEnc(s) { const M = { '\u20ac': 128, '\u201e': 132, '\u201c': 147, '\u201d': 148, '\u2018': 145, '\u2019': 146, '\u2013': 150, '\u2014': 151, '\u2026': 133, '\u00b7': 183 }; let o = ''; for (const ch of String(s)) { let n = M[ch] !== undefined ? M[ch] : ch.charCodeAt(0); if (n > 255) n = 63; const q = String.fromCharCode(n); o += (q === '(' || q === ')' || q === '\\') ? '\\' + q : q; } return o; } function pdfWrap(t, size, w, f) { const out = []; let cur = ''; for (const wd of String(t).split(/\s+/)) { const nx = cur ? cur + ' ' + wd : wd; if (cur && nx.length * size * f > w) { out.push(cur); cur = wd; } else cur = nx; } if (cur) out.push(cur); return out; } async function xmPdf(v, env) { const cfg = config(env), d = v.design, c = d ? xmPal(d) : null, k = 495 / 548; let jpg = null, iw = 1096, ih = 964; if (d) { try { const r = await fetch(cfg.siteOrigin + '/mailbilder/' + c.p + '-full.jpg'); if (r.ok) jpg = new Uint8Array(await r.arrayBuffer()); } catch (e) {} } if (jpg) { for (let i = 2; i < jpg.length - 9; ) { if (jpg[i] !== 255) { i++; continue; } const m = jpg[i + 1]; if (m === 192 || m === 193 || m === 194) { ih = jpg[i + 5] * 256 + jpg[i + 6]; iw = jpg[i + 7] * 256 + jpg[i + 8]; break; } i += 2 + jpg[i + 2] * 256 + jpg[i + 3]; } } const X = (x) => (50 + x * k).toFixed(2), Y = (y) => (842 - 70 - y * k).toFixed(2); const T = d ? { gold: '0.961 0.816 0.380', white: '1 1 1', grey: '0.941 0.863 0.8', line: '0.788 0.627 0.29' } : { gold: '0.937 0.725 0.18', white: '0.925 0.914 0.886', grey: '0.604 0.627 0.671', line: '0.18 0.196 0.231' }; let s = '0.082 0.09 0.11 rg 0 0 595 842 re f\n'; if (jpg) s += 'q ' + (495).toFixed(2) + ' 0 0 ' + (482 * k).toFixed(2) + ' 50 ' + Y(482) + ' cm /Im0 Do Q\n'; else s += '0.11 0.122 0.149 rg 0.478 0.384 0.125 RG 1 w 50.5 ' + Y(482) + ' 494 ' + (420 * k).toFixed(2) + ' re B\n'; const tx = (f, sz, col, x, y, str, tc) => { s += 'BT /' + f + ' ' + sz + ' Tf ' + col + ' rg ' + (tc || 0) + ' Tc 1 0 0 1 ' + X(x) + ' ' + Y(y) + ' Tm (' + pdfEnc(str) + ') Tj ET\n'; }; tx('F2', 8.5, T.gold, 30, 132, (d ? c.lab + ' \u00b7 Geschenkgutschein' : 'Geschenkgutschein').toUpperCase(), 1.6); tx('F2', 23, T.white, 30, 176, 'PERSONAL TRAINING UND KURSE', 0.5); tx('F2', 42, T.gold, 30, 232, fmtEur(v.amount_cents)); const fv = ((v.recipient_name ? 'F\u00fcr ' + v.recipient_name + ' ' : '') + (v.buyer_name ? 'von ' + v.buyer_name : '')).trim(); if (fv) tx('F1', 12, T.grey, 30, 262, fv); let y = 292; if (v.message) { const ls = pdfWrap('\u201e' + v.message + '\u201c', 12, 360, 0.5).slice(0, 4); s += T.gold + ' RG 1.5 w ' + X(30) + ' ' + Y(y - 12) + ' m ' + X(30) + ' ' + Y(y + ls.length * 17 - 4) + ' l S\n'; ls.forEach((l, i) => tx('F3', 12, T.white, 40, y + i * 17, l)); } s += T.line + ' RG 0.8 w ' + X(30) + ' ' + Y(372) + ' m ' + X(440) + ' ' + Y(372) + ' l S\n'; tx('F1', 8, T.grey, 30, 396, 'GUTSCHEIN-CODE', 1.2); tx('F2', 21, T.white, 30, 424, v.code, 2); tx('F1', 9, T.grey, 30, 450, 'G\u00fcltig bis ' + fmtDate(v.expires) + ' \u00b7 ' + cfg.siteOrigin.replace('https://', '')); const base = 842 - 70 - 482 * k - 40; const tl = (f, sz, col, yy, str) => { s += 'BT /' + f + ' ' + sz + ' Tf ' + col + ' rg 1 0 0 1 50 ' + yy.toFixed(2) + ' Tm (' + pdfEnc(str) + ') Tj ET\n'; }; tl('F2', 14, T.white, base, 'So l\u00f6st du den Gutschein ein'); tl('F1', 11, T.grey, base - 22, 'Auf fitnessdonner.de einen Termin buchen \u2013 den Gutschein-Code tr\u00e4gst du dabei ein.'); const url = cfg.siteOrigin + '/termin-buchen.html?art=training&code=' + encodeURIComponent(v.code); tl('F2', 11, T.gold, base - 44, cfg.siteOrigin.replace('https://', '') + '/termin-buchen.html'); tl('F1', 10, T.grey, base - 76, 'Fragen? WhatsApp ' + cfg.ownerPhone + ' oder ' + cfg.ownerEmail); const parts = []; const offs = []; let len = 0; const put = (b) => { if (typeof b === 'string') { const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i) & 255; b = u; } parts.push(b); len += b.length; }; const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); }; put('%PDF-1.4\n'); obj(1, '<</Type/Catalog/Pages 2 0 R>>'); obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>'); obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R/F2 5 0 R/F3 6 0 R>>' + (jpg ? '/XObject<</Im0 7 0 R>>' : '') + '>>/Contents 8 0 R/Annots[9 0 R]>>'); obj(4, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'); obj(5, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>'); obj(6, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Oblique/Encoding/WinAnsiEncoding>>'); if (jpg) { offs[7] = len; put('7 0 obj\n<</Type/XObject/Subtype/Image/Width ' + iw + '/Height ' + ih + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpg.length + '>>\nstream\n'); put(jpg); put('\nendstream\nendobj\n'); } else obj(7, 'null'); obj(8, '<</Length ' + s.length + '>>\nstream\n' + s + 'endstream'); obj(9, '<</Type/Annot/Subtype/Link/Rect[50 ' + (base - 48).toFixed(2) + ' 330 ' + (base - 36).toFixed(2) + ']/Border[0 0 0]/A<</S/URI/URI(' + pdfEnc(url) + ')>>>>'); const xr = len; put('xref\n0 10\n0000000000 65535 f \n'); for (let n = 1; n <= 9; n++) put(String(offs[n]).padStart(10, '0') + ' 00000 n \n'); put('trailer\n<</Size 10/Root 1 0 R>>\nstartxref\n' + xr + '\n%%EOF'); const all = new Uint8Array(len); let p = 0; for (const b of parts) { all.set(b, p); p += b.length; } let o = ''; for (let i = 0; i < all.length; i += 8192) o += String.fromCharCode.apply(null, all.subarray(i, i + 8192)); return btoa(o); } function voucherCardHtmlStd(v, env) {
  const cfg = config(env);
  const fuer = v.recipient_name ? `Für <b style="color:#ECE9E2">${esc(v.recipient_name)}</b>` : '';
  const von = v.buyer_name ? `von ${esc(v.buyer_name)}` : '';
  return `
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#1C1F26;border:1px solid #7A6220;margin:26px 0">
    <tr><td style="padding:32px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#EFB92E">Geschenkgutschein</div>
      <div style="font-size:34px;font-weight:800;color:#ECE9E2;letter-spacing:.02em;text-transform:uppercase;margin:14px 0 0">Personal Training<br>und Kurse</div>
      <div style="font-size:44px;font-weight:800;color:#EFB92E;margin:12px 0 4px">${fmtEur(v.amount_cents)}</div>
      <div style="font-size:15px;color:#9AA0AB">${fuer} ${von}</div>
      ${v.message ? `<div style="border-left:2px solid #EFB92E;padding:10px 0 10px 16px;margin:22px 0;font-style:italic;color:#c9cbd0">„${esc(v.message)}“</div>` : ''}
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #2E323B;margin-top:22px">
        <tr>
          <td style="padding-top:18px;vertical-align:top">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9AA0AB">Gutschein-Code</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:.12em;color:#ECE9E2;margin-top:4px">${esc(v.code)}</div>
          </td>
          <td style="padding-top:18px;text-align:right;font-size:12px;color:#9AA0AB;line-height:1.7;vertical-align:top">
            Gültig bis ${fmtDate(v.expires)}<br>${esc(cfg.siteOrigin.replace('https://', ''))}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
  <p><a href="${voucherLink(v, env)}" style="display:inline-block;background:#EFB92E;color:#15171C;font-weight:700;text-decoration:none;padding:14px 26px;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Gutschein öffnen &amp; drucken</a></p>`;
}

function mailShell(headline, inner, env, vorschau, opt) {
  const cfg = config(env);
  const host = cfg.siteOrigin.replace('https://', '');
  /* Fuer E-Mail-Clients gelten andere Regeln als fuers Web:
     - keine rgba()-Farben, Outlook rendert sie nicht (deshalb ueberall Hex)
     - Tabellen brauchen width/cellpadding/cellspacing als Attribut, nicht nur im CSS
     - die Vorschauzeile steht versteckt ganz oben, sonst zieht sich der Client
       den ersten sichtbaren Text aus dem Layout. */
  return `<!DOCTYPE html>
<html lang="de" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#15171C;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${esc(vorschau || headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#15171C">
  <tr><td align="center" style="padding:28px 14px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#ECE9E2;font-size:16px;line-height:1.6">

      <tr><td style="padding:0 0 24px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td>
            <div style="font-size:11px;letter-spacing:.46em;color:#ECE9E2;font-weight:600">FITNESS</div>
            <div style="font-size:30px;letter-spacing:.04em;color:#ECE9E2;font-weight:800;line-height:1.1">DONNER</div>
            <div style="font-size:0;line-height:0">&nbsp;</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td height="4" width="118" style="background-color:#EFB92E;font-size:0;line-height:0">&nbsp;</td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background-color:#1C1F26;border-top:3px solid #EFB92E;padding:28px 26px 30px">
        <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:800;color:#ECE9E2">${headline}</h1>
        ${inner}
      </td></tr>

      ${opt && opt.ohneFragen ? '' : `<tr><td style="padding:22px 26px 0;color:#9AA0AB;font-size:13px;line-height:1.7">
        Fragen? Ruf einfach an: <a href="tel:+491776311404" style="color:#EFB92E;text-decoration:none">${esc(cfg.ownerPhone)}</a>
        &nbsp;oder antworte direkt auf diese Mail.
      </td></tr>`}

      <tr><td style="padding:20px 26px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td height="1" style="background-color:#2E323B;font-size:0;line-height:0">&nbsp;</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:16px 26px 0;color:#767C87;font-size:12px;line-height:1.8">
        ${esc(cfg.ownerName)} &middot; <a href="${cfg.siteOrigin}" style="color:#767C87">${esc(host)}</a><br>
        <a href="${cfg.siteOrigin}/impressum.html" style="color:#767C87">Impressum</a> &middot;
        <a href="${cfg.siteOrigin}/datenschutz.html" style="color:#767C87">Datenschutz</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/* Die Vorlagen sind mit Entitaeten geschrieben (&auml; und Co.), damit sie in jedem
   Mailclient ankommen. Fuer die Textfassung muessen sie zurueckuebersetzt werden -
   ein pauschales Wegwerfen wuerde aus "bestaetigt" ein "besttigt" machen. */
const ENTITAETEN = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  auml: '\u00e4', ouml: '\u00f6', uuml: '\u00fc',
  Auml: '\u00c4', Ouml: '\u00d6', Uuml: '\u00dc',
  szlig: '\u00df', euro: '\u20ac', sect: '\u00a7', deg: '\u00b0',
  middot: '\u00b7', bull: '\u2022', hellip: '\u2026',
  ndash: '\u2013', mdash: '\u2014', shy: '',
  laquo: '\u00ab', raquo: '\u00bb', bdquo: '\u201e', ldquo: '\u201c', rdquo: '\u201d',
  sbquo: '\u201a', lsquo: '\u2018', rsquo: '\u2019', times: '\u00d7',
};

/* Aus dem fertigen HTML eine brauchbare Textfassung bauen.
   Reine HTML-Mails ohne Textteil sind ein bekanntes Spam-Merkmal, und eine
   Textfassung je Mail von Hand zu pflegen haelt auf Dauer niemand durch. */
function mailText(html) {
  let t = String(html)
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, '')
    // Die versteckte Vorschauzeile gehoert nicht in den Text
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, url, text) => {
      const klar = text.replace(/<[^>]+>/g, '').trim();
      if (!url || url.startsWith('mailto:') || url.startsWith('tel:')) return klar;
      return klar && klar !== url ? `${klar}: ${url}` : url;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITAETEN[name] !== undefined ? ENTITAETEN[name] : m))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/* Rechnung als eigene Mail, kurz nach der Bestaetigung.
   Stripe erzeugt die Rechnung erst nach Abschluss der Zahlung - deshalb haengt das
   hier am Ereignis "invoice.paid" und nicht an "checkout.session.completed".
   Ohne dieses Ereignis im Stripe-Dashboard passiert an dieser Stelle schlicht nichts. */
async function sendInvoiceMail(invoice, env) {
  const cfg = config(env);
  const to = invoice.customer_email
    || (invoice.customer_details && invoice.customer_details.email)
    || '';
  if (!to) {
    console.error('Rechnungsmail ohne Empfaenger', invoice.id);
    return;
  }
  if (!invoice.hosted_invoice_url && !invoice.invoice_pdf) {
    console.error('Rechnung ohne Dokument', invoice.id);
    return;
  }

  const nummer = invoice.number || invoice.id;
  const betrag = fmtEur(invoice.amount_paid != null ? invoice.amount_paid : invoice.total);
  const was = (invoice.lines && invoice.lines.data && invoice.lines.data[0]
               && invoice.lines.data[0].description) || 'Personal Training';

  const inner = `
    <p style="margin:0 0 18px;color:#c9cbd0">Danke f&uuml;r deine Buchung. Hier ist deine Rechnung zum Ablegen &ndash;
    bezahlt ist bereits alles, du musst nichts weiter tun.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#22262F;margin:0 0 22px">
      <tr><td style="padding:18px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:15px;color:#c9cbd0">
          <tr>
            <td style="padding:0 0 8px">Rechnungsnummer</td>
            <td align="right" style="padding:0 0 8px;color:#ECE9E2;font-weight:700">${esc(nummer)}</td>
          </tr>
          <tr>
            <td style="padding:0 0 8px">Leistung</td>
            <td align="right" style="padding:0 0 8px;color:#ECE9E2">${esc(was)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0 0;border-top:1px solid #2E323B;font-weight:700;color:#ECE9E2">Bezahlt</td>
            <td align="right" style="padding:8px 0 0;border-top:1px solid #2E323B;font-weight:800;color:#EFB92E;font-size:19px">${betrag}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    ${invoice.hosted_invoice_url ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>
      <td align="center" style="background-color:#EFB92E">
        <a href="${invoice.hosted_invoice_url}" style="display:inline-block;padding:14px 28px;color:#15171C;font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-decoration:none">Rechnung ansehen</a>
      </td></tr></table>` : ''}

    <p style="margin:0;color:#9AA0AB;font-size:13.5px;line-height:1.7">${esc(invoice.footer || INVOICE_FOOTER_SERVICE)}</p>`;

  const anhang = [];
  if (invoice.invoice_pdf) {
    anhang.push({ path: invoice.invoice_pdf, filename: `Rechnung-${String(nummer).replace(/[^A-Za-z0-9_-]/g, '')}.pdf` });
  }

  await sendMail(env, {
    to,
    subject: `Deine Rechnung ${nummer} \u2013 ${cfg.siteName}`,
    html: mailShell('Deine Rechnung', inner, env, `${betrag} \u00b7 bezahlt \u00b7 nichts weiter zu tun`),
    attachments: anhang,
  });
}

async function sendMail(env, { to, subject, html, text, attachments, headers }) {
  const cfg = config(env);
  if (env.__testTo) { to = env.__testTo; subject = (env.__testPrefix || '') + subject; }   // WV-HOOK: Mailtest
  const payload = {
    from: cfg.fromEmail,
    to: [to],
    reply_to: cfg.ownerEmail,
    subject,
    html,
    // Ohne Textteil stufen viele Filter eine Mail als verdaechtig ein
    text: text || mailText(html),
  };
  if (attachments && attachments.length) payload.attachments = attachments;
  await xmInline(payload, attachments); if (headers && Object.keys(headers).length) payload.headers = headers;   // WV-HOOK: List-Unsubscribe

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Mailversand fehlgeschlagen', res.status, text);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  const sent = await res.json();
  await kundenMailLog(env, { to, subject, html, from: payload.from, attachments, headers, resend_id: sent && sent.id });   // KUNDEN-HOOK
  if (String(to).toLowerCase() === String(cfg.ownerEmail || '').toLowerCase()) await pushAusMail(env, subject);   // PUSH-HOOK
  return sent;
}

/* ------------------------------------------------------------------ */
/* 6. Stripe-Helfer                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Zahlungsarten, Reservierungen, Freigabe                             */
/* ------------------------------------------------------------------ */

// Apple Pay und Google Pay laufen bei Stripe über "card" und erscheinen automatisch.
const PAY_TYPES = ['card', 'sepa_debit', 'paypal'];
// Gutscheine: Der Code geht sofort raus – ohne Lastschrift, die erst Tage später platzen kann
const PAY_TYPES_GIFT = ['card', 'paypal'];

// Die Stripe-Zahlseite schließt nach 31 Minuten (Stripe-Minimum: 30).
// Die Reservierung im KV hält etwas länger, damit nie bezahlt wird, was schon frei ist.
const CHECKOUT_MINUTES = 31;
const RESERVE_TTL = 40 * 60;

/**
 * Checkout-Session mit fester Liste an Zahlungsarten anlegen.
 * Ist eine Zahlungsart in Stripe (noch) nicht freigeschaltet, lehnt Stripe die ganze
 * Session ab – dann ohne diese Zahlungsart erneut versuchen, statt die Buchung scheitern zu lassen.
 */
async function createCheckoutSession(env, params, types) {
  const versuche = [types];
  for (const t of types) if (t !== 'card') versuche.push(types.filter((x) => x !== t));
  versuche.push(['card']);
  const seen = new Set();
  for (const list of versuche) {
    const k = list.join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    const p = new URLSearchParams(params);
    p.delete('payment_method_types[]');
    for (const t of list) p.append('payment_method_types[]', t);
    // KARTE-HOOK: Bei Lastschrift das SEPA-Mandat fürs nächste Mal speichern (nur Training und Karten)
    if (list.indexOf('sepa_debit') !== -1 && p.get('mode') === 'payment' && ['booking', 'karte'].indexOf(p.get('metadata[kind]')) !== -1) {
      p.set('payment_method_options[sepa_debit][setup_future_usage]', 'off_session');
    }
    const res = await stripeCall(env, 'POST', 'checkout/sessions', p);
    if (res.ok) {
      if (list.length < types.length) console.warn('Checkout ohne', types.filter((t) => list.indexOf(t) === -1).join(', '));
      return res.data;
    }
    // Nur bei Problemen mit einer Zahlungsart weiter probieren
    if (!/payment_method/i.test(JSON.stringify(res.data || {}))) return null;
  }
  return null;
}

function holdId(v) {
  const s = String(v || '');
  return /^[A-Za-z0-9_-]{12,64}$/.test(s) ? s : '';
}

/** Merkt sich zu einer Zahlung, welche Termine dafür reserviert sind. */
async function rememberReservation(hold, bookings, sessionId, pending, env) {
  const keys = bookings.map((b) => `booking:${b.date}:${b.slot_id}`);
  // Session-ID in die Reservierung schreiben – damit kann die Verwaltung sie sauber freigeben
  for (const b of bookings) {
    b.stripe_session = sessionId;
    b.hold = hold || '';
    if (pending) b.pending = pending;
    await env.VOUCHERS.put(`booking:${b.date}:${b.slot_id}`, JSON.stringify(b), { expirationTtl: RESERVE_TTL });
  }
  if (!hold) return;
  await env.VOUCHERS.put(`hold:${hold}`, JSON.stringify({
    keys, ids: bookings.map((b) => b.id), session: sessionId, pending: pending || '',
  }), { expirationTtl: RESERVE_TTL });
}

/** POST /api/release – die Buchungsseite meldet: Kunde ist ohne Zahlung zurück. */
async function handleRelease(request, env) {
  const body = await request.json().catch(() => ({}));
  const hold = holdId(body.hold);
  if (!hold) return json({ ok: true, released: 0 });
  const r = await releaseHold(hold, env);
  return json({ ok: true, released: r.released, paid: !!r.paid });
}

async function releaseHold(hold, env) {
  const raw = await env.VOUCHERS.get(`hold:${hold}`);
  if (!raw) return { released: 0 };
  const r = JSON.parse(raw);
  const res = await releaseReservation(r, env, false);
  if (!res.paid) await env.VOUCHERS.delete(`hold:${hold}`);
  return res;
}

/**
 * Reservierung auflösen. Erst wird die Stripe-Zahlseite geschlossen – nur wenn das
 * klappt, werden die Termine frei. So kann niemand mehr für einen Termin bezahlen,
 * der inzwischen jemand anderem gehört.
 */
async function releaseReservation(r, env, force, collect) {
  if (r.session) {
    const st = await expireCheckout(r.session, env);
    if (st === 'complete') return { released: 0, paid: true };
    if (st !== 'expired' && !force) return { released: 0, failed: true };
  }
  const freed = [];
  for (const key of r.keys || []) {
    const raw = await env.VOUCHERS.get(key);
    if (!raw) { freed.push(key); continue; }
    const b = JSON.parse(raw);
    if (b.status !== 'pending') continue;                       // feste Buchungen nie anfassen
    if (r.ids && r.ids.length && r.ids.indexOf(b.id) === -1) continue;
    await env.VOUCHERS.delete(key);
    freed.push(key);
  }
  if (r.pending) await env.VOUCHERS.delete(`kartepending:${r.pending}`);
  if (collect) collect.push(...freed);
  else await markFree(freed, env);
  return { released: freed.length };
}

/** Stripe-Zahlseite schließen. Liefert 'expired', 'complete', 'open' oder 'unknown'. */
async function expireCheckout(sessionId, env) {
  const id = encodeURIComponent(sessionId);
  const res = await stripeCall(env, 'POST', `checkout/sessions/${id}/expire`, new URLSearchParams());
  if (res.ok) return 'expired';
  const look = await stripeCall(env, 'GET', `checkout/sessions/${id}`);
  if (look.ok && look.data && look.data.status) return look.data.status;
  return 'unknown';
}

/* Gerade freigegebene Termine. Die Schlüsselliste des KV zeigt gelöschte Einträge noch
   bis zu 60 Sekunden lang an – so lange zählen sie hierüber trotzdem als frei. */
const FREED_KEY = 'freigegeben';

async function readFreed(env) {
  const raw = await env.VOUCHERS.get(FREED_KEY);
  let m = {};
  try { m = raw ? JSON.parse(raw) : {}; } catch (e) { m = {}; }
  const now = Date.now();
  for (const k of Object.keys(m)) if (m[k] < now) delete m[k];
  return m;
}

async function markFree(keys, env) {
  if (!keys.length) return;
  const m = await readFreed(env);
  for (const k of keys) m[k] = Date.now() + 150e3;
  try {
    await env.VOUCHERS.put(FREED_KEY, JSON.stringify(m), { expirationTtl: 300 });
  } catch (err) {
    // KV erlaubt nur einen Schreibvorgang pro Sekunde und Schlüssel – dann kurz warten, nochmal
    await new Promise((r) => setTimeout(r, 1100));
    try { await env.VOUCHERS.put(FREED_KEY, JSON.stringify(m), { expirationTtl: 300 }); }
    catch (e) { console.error('Freigabe-Liste nicht gespeichert', e); }
  }
}


/* ---- Lastschrift: Zahlstatus nachtragen ---- */

async function sessionTargets(session, env) {
  const m = session.metadata || {};
  const out = { bookings: [], card: null, voucher: null };
  if (m.kind === 'booking' && m.booking_key) {
    const raw = await env.VOUCHERS.get(m.booking_key);
    if (raw) {
      const b = JSON.parse(raw);
      if (!m.booking_id || b.id === m.booking_id) out.bookings.push({ key: m.booking_key, b });
    }
    return out;
  }
  const code = await env.VOUCHERS.get(`session:${session.id}`);
  if (!code) return out;
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return out;
  const v = JSON.parse(raw);
  if (v.kind === 'karte') {
    out.card = v;
    for (const r of v.redemptions || []) {
      const list = await env.VOUCHERS.list({ prefix: `booking:${r.date}:` });
      for (const k of list.keys) {
        const bRaw = await env.VOUCHERS.get(k.name);
        if (!bRaw) continue;
        const b = JSON.parse(bRaw);
        if (b.id === r.booking_id && b.session_id === session.id) out.bookings.push({ key: k.name, b });
      }
    }
  } else {
    out.voucher = v;
  }
  return out;
}

async function setPayStatus(session, status, env) {
  const t = await sessionTargets(session, env);
  for (const { key, b } of t.bookings) {
    b.pay_status = status;
    await env.VOUCHERS.put(key, JSON.stringify(b));
  }
  const v = t.card || t.voucher;
  if (v) {
    v.pay_status = status;
    await env.VOUCHERS.put(`voucher:${v.code}`, JSON.stringify(v));
  }
  return t;
}

/** Lastschrift geplatzt: Termin bleibt stehen, Niklas bekommt eine Mail und klärt es selbst. */
async function handleDebitFailed(session, env) {
  const cfg = config(env);
  const t = await setPayStatus(session, 'failed', env);
  const m = session.metadata || {};
  const first = t.bookings[0] ? t.bookings[0].b : null;
  const name = (first && first.name) || (t.card && t.card.buyer_name) || (t.voucher && t.voucher.buyer_name) || m.buyer_name || '';
  const email = (first && first.email) || session.customer_details?.email || session.customer_email || '';
  const phone = first && first.phone ? first.phone : '';

  let was = '';
  if (t.card) was = `${t.card.label} · Code ${t.card.code}`;
  else if (t.voucher) was = `Gutschein · Code ${t.voucher.code}`;
  else if (first) was = first.label;

  const termine = t.bookings
    .map(({ b }) => `${fmtDate(b.date)}, ${b.start}–${b.end} Uhr (${esc(b.city)})`)
    .join('<br>');

  const rows =
    row('Kunde', esc(name) || '–') +
    row('E-Mail', esc(email) || '–') +
    (phone ? row('Telefon', esc(phone)) : '') +
    row('Betrag', fmtEur(session.amount_total || 0)) +
    (was ? row('Gekauft', esc(was)) : '') +
    (termine ? row(t.bookings.length > 1 ? 'Termine' : 'Termin', termine) : '');

  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Lastschrift geplatzt: ${name || email} – ${fmtEur(session.amount_total || 0)}`,
    html: mailShell(
      'Lastschrift geplatzt',
      `<p style="margin:0 0 16px">Die Bank hat die Lastschrift zurückgegeben. Der Termin steht weiterhin –
        kläre die Zahlung direkt mit dem Kunden. Absagen kannst du in der Verwaltung.</p>
       <table style="width:100%;border-collapse:collapse">${rows}</table>`,
      env
    ),
  });
}

function payLabel(b) {
  let base = b.open_cents > 0 ? fmtEur(b.open_cents) : (b.card_code ? 'Karte' : b.voucher_code ? 'Gutschein' : (b.manuell ? 'von Hand (bar/privat)' : '0 €'));
  if (b.pay_status === 'unpaid') base += ' · Lastschrift läuft';
  if (b.pay_status === 'failed') base += ' · LASTSCHRIFT GEPLATZT';
  return base;
}

/* ---- Verwaltung: hängende Reservierungen freigeben ---- */

async function adminRelease(body, env) {
  let keys = [];
  if (body.all) {
    const list = await env.VOUCHERS.list({ prefix: 'booking:' });
    keys = list.keys.map((k) => k.name);
  } else {
    const date = String(body.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !body.slotId) return json({ error: 'Termin fehlt.' }, 400);
    keys = [`booking:${date}:${body.slotId}`];
  }

  // Reservierungen einer Zahlung gehören zusammen (Karte mit mehreren Terminen)
  const groups = new Map();
  const freed = [];
  for (const key of keys) {
    const raw = await env.VOUCHERS.get(key);
    if (!raw) { if (!body.all) freed.push(key); continue; }
    const b = JSON.parse(raw);
    if (b.status !== 'pending') {
      if (!body.all) return json({ error: 'Das ist eine feste Buchung. Bitte über „Absagen“ entfernen.' }, 409);
      continue;
    }
    const g = b.stripe_session || `ohne:${key}`;
    if (!groups.has(g)) groups.set(g, { keys: [], ids: [], session: b.stripe_session || '', pending: b.pending || '', holds: new Set() });
    const grp = groups.get(g);
    grp.keys.push(key);
    grp.ids.push(b.id);
    if (b.hold) grp.holds.add(b.hold);
  }

  let paid = 0;
  for (const grp of groups.values()) {
    // force: Lässt sich die Zahlseite nicht prüfen, trotzdem freigeben – nur „bezahlt“ hält den Termin
    const res = await releaseReservation(grp, env, true, freed);
    if (res.paid) { paid++; continue; }
    for (const h of grp.holds) await env.VOUCHERS.delete(`hold:${h}`);
  }
  await markFree(freed, env);

  if (!body.all && paid) {
    return json({ error: 'Für diesen Termin ist gerade die Zahlung eingegangen – er wird gleich zur festen Buchung.' }, 409);
  }
  return json({ ok: true, released: freed.length, paid });
}

/* ------------------------------------------------------------------ */
/* Termin verschieben                                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Google-Bewertungen (Zahl + Schnitt) – Places API (New)               */
/* ------------------------------------------------------------------ */

const RATING_MAX_AGE = 3 * 3600e3;       // höchstens alle 3 Stunden bei Google nachfragen
const RATING_DAILY_CAP = 20;             // harte Obergrenze an Google-Abrufen pro Tag
const PLACE_QUERY = 'Fitness Donner – Kurse & Personal Training Solingen';

/** GET /api/bewertungen – liefert den gespeicherten Stand, frischt bei Bedarf im Hintergrund auf. */
async function handleRatings(env, ctx) {
  const raw = await env.VOUCHERS.get('grating');
  const cur = raw ? JSON.parse(raw) : null;
  const stale = !cur || Date.now() - cur.at > RATING_MAX_AGE;
  if (stale && env.GOOGLE_PLACES_KEY) {
    const job = refreshRating(env).catch((e) => console.error('Bewertungen', e));
    if (cur && ctx) ctx.waitUntil(job);   // alten Stand sofort zeigen, neu laden im Hintergrund
    else {
      const fresh = await job;
      if (fresh) return json({ rating: fresh.rating, count: fresh.count, updated: new Date(fresh.at).toISOString() });
    }
  }
  if (!cur) return json({ rating: null, count: null });
  return json({ rating: cur.rating, count: cur.count, updated: new Date(cur.at).toISOString() });
}

async function refreshRating(env) {
  if (!env.GOOGLE_PLACES_KEY) return null;
  const raw = await env.VOUCHERS.get('grating');
  const cur = raw ? JSON.parse(raw) : null;
  if (cur && Date.now() - cur.at < RATING_MAX_AGE) return cur;

  // Sperre gegen viele gleichzeitige Aufrufe + Tageslimit – damit nie Kosten entstehen
  if (await env.VOUCHERS.get('grating_lock')) return cur;
  await env.VOUCHERS.put('grating_lock', '1', { expirationTtl: 300 });
  const dayKey = `gcalls:${isoDate(new Date())}`;
  const calls = Number(await env.VOUCHERS.get(dayKey) || 0);
  if (calls >= RATING_DAILY_CAP) return cur;
  await env.VOUCHERS.put(dayKey, String(calls + 1), { expirationTtl: 2 * 86400 });

  const headers = { 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'Content-Type': 'application/json' };
  let placeId = env.GOOGLE_PLACE_ID || (await env.VOUCHERS.get('gplace_id'));
  let rating = null, count = null;

  if (!placeId) {
    // Einmalig: Profil über den Namen finden und die ID dauerhaft merken
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: Object.assign({ 'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount' }, headers),
      body: JSON.stringify({ textQuery: PLACE_QUERY, languageCode: 'de', regionCode: 'DE' }),
    });
    const data = await res.json().catch(() => ({}));
    const hit = (data.places || []).find((p) => /fitness donner/i.test((p.displayName && p.displayName.text) || ''));
    if (!hit) { console.error('Google-Profil nicht gefunden', JSON.stringify(data).slice(0, 300)); return cur; }
    placeId = hit.id;
    await env.VOUCHERS.put('gplace_id', placeId);
    rating = hit.rating; count = hit.userRatingCount;
  } else {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: Object.assign({ 'X-Goog-FieldMask': 'rating,userRatingCount' }, headers),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('Google-Bewertungen', res.status, JSON.stringify(data).slice(0, 300)); return cur; }
    rating = data.rating; count = data.userRatingCount;
  }

  if (!count) return cur;
  const next = { rating, count, at: Date.now() };
  await env.VOUCHERS.put('grating', JSON.stringify(next));
  return next;
}

// Rechnungen für Termine und Karten: ohne den Gutschein-Satz aus CONFIG.invoiceFooter
const INVOICE_FOOTER_SERVICE = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';
const PHONE_ERROR = 'Bitte gib deine Telefonnummer an – falls kurzfristig etwas ist, erreiche ich dich so am schnellsten.';
const CONSENT_ERROR = 'Bitte bestätige, dass das Training schon vor Ablauf der Widerrufsfrist beginnen darf.';
const MOVE_HOURS = 12;          // bis so viele Stunden vorher selbst verschieben
const MOVE_MONTHS_SINGLE = 3;   // Einzeltermin: bis 3 Monate nach dem ursprünglichen Termin

function moveLink(b, env) {
  return `${config(env).siteOrigin}/termin-verschieben.html?id=${encodeURIComponent(b.id)}`;
}

function moveHtml(b, env) {
  const cfg = config(env);
  return `
    <div style="border-top:1px solid #2E323B;margin-top:8px;padding-top:18px;margin-bottom:18px">
      <p style="margin:0 0 12px;font-size:14px;color:#9AA0AB">
        Du kannst doch nicht? Bis ${MOVE_HOURS} Stunden vorher verschiebst du ${b ? 'deinen Termin' : 'jeden Termin'} selbst
        ${b ? '' : '(Link neben dem Termin)'} und suchst dir direkt einen neuen aus. K&uuml;rzerfristig ruf mich bitte an:
        ${esc(cfg.ownerPhone)}.
      </p>
      ${b ? `<a href="${esc(moveLink(b, env))}" style="display:inline-block;border:1px solid #ECE9E2;color:#ECE9E2;padding:10px 18px;
        font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Termin verschieben</a>` : ''}
    </div>`;
}

async function indexBooking(b, env) {
  await env.VOUCHERS.put(`bid:${b.id}`, `booking:${b.date}:${b.slot_id}`, { expirationTtl: 60 * 60 * 24 * 400 });
}

async function findBooking(id, env) {
  if (!/^[a-z0-9]{12,40}$/.test(String(id || ''))) return null;
  const key = await env.VOUCHERS.get(`bid:${id}`);
  if (key) {
    const raw = await env.VOUCHERS.get(key);
    if (raw) {
      const b = JSON.parse(raw);
      if (b.id === id) return { key, b };
    }
  }
  // Ältere Buchungen ohne Verweis: einmal durchsuchen und den Verweis nachtragen
  const list = await env.VOUCHERS.list({ prefix: 'booking:' });
  for (const k of list.keys) {
    const raw = await env.VOUCHERS.get(k.name);
    if (!raw) continue;
    const b = JSON.parse(raw);
    if (b.id === id) {
      await indexBooking(b, env);
      return { key: k.name, b };
    }
  }
  return null;
}

function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d, 12));
  return isoDate(dt);
}

/** Was darf mit diesem Termin noch passieren? */
async function moveRules(b, env) {
  const startsAt = berlinToUtc(b.date, b.start).getTime();
  const deadline = startsAt - MOVE_HOURS * 3600e3;
  let maxDate = addMonths(b.orig_date || b.date, MOVE_MONTHS_SINGLE);
  if (b.card_code) {
    const raw = await env.VOUCHERS.get(`voucher:${b.card_code}`);
    if (raw) maxDate = JSON.parse(raw).expires || maxDate;
  }
  let reason = '';
  if (b.status !== 'confirmed') reason = 'Dieser Termin ist nicht (mehr) gebucht.';
  else if (Date.now() > startsAt) reason = 'Dieser Termin liegt schon in der Vergangenheit.';
  else if (Date.now() > deadline) reason = `Der Termin beginnt in weniger als ${MOVE_HOURS} Stunden. Bitte ruf mich kurz an, dann finden wir eine Lösung.`;
  return { canMove: !reason, reason, deadline, maxDate };
}

/** GET /api/termin?id= – Termindaten für die Verschieben-Seite */
async function handleTerminInfo(url, env) {
  const cfg = config(env);
  const hit = await findBooking(url.searchParams.get('id'), env);
  if (!hit) return json({ error: 'Diesen Termin habe ich nicht gefunden. Bitte nutz den Link aus deiner Bestätigungsmail.' }, 404);
  const b = hit.b;
  const r = await moveRules(b, env);
  return json({
    ok: true,
    label: b.label, first_name: firstName(b.name),
    date: b.date, start: b.start, end: b.end, city: b.city, place: b.place, slot_id: b.slot_id,
    card: !!b.card_code,
    can_move: r.canMove, reason: r.reason,
    deadline: new Date(r.deadline).toISOString(),
    max_date: r.maxDate,
    phone: cfg.ownerPhone,
  });
}

/** POST /api/verschieben { id, date, slotId } */
async function handleMove(request, env) {
  const cfg = await liveConfig(env);
  const body = await request.json().catch(() => ({}));
  const hit = await findBooking(body.id, env);
  if (!hit) return json({ error: 'Diesen Termin habe ich nicht gefunden.' }, 404);
  const { key: oldKey, b } = hit;

  const r = await moveRules(b, env);
  if (!r.canMove) return json({ error: r.reason }, 409);

  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Bitte einen neuen Termin auswählen.' }, 400);
  const slot = slotsForDate(date).find((s) => s.slotId === body.slotId);
  if (!slot) return json({ error: 'Diesen Termin gibt es an diesem Tag nicht.' }, 400);
  if (date === b.date && slot.slotId === b.slot_id) return json({ error: 'Das ist dein bisheriger Termin.' }, 400);
  if (date > r.maxDate) {
    return json({ error: `Verschieben geht bis zum ${fmtDate(r.maxDate)}. Für einen späteren Termin ruf mich bitte an.` }, 400);
  }
  const startsAt = berlinToUtc(date, slot.start).getTime();
  if (startsAt < Date.now() + cfg.bookingLeadHours * 3600e3) {
    return json({ error: `Der neue Termin liegt zu kurzfristig. Bitte ruf mich an: ${cfg.ownerPhone}.` }, 400);
  }
  if (startsAt > Date.now() + cfg.bookingHorizonDays * 864e5) {
    return json({ error: 'Der neue Termin liegt zu weit in der Zukunft.' }, 400);
  }

  const taken = await takenState(env, date, date);
  if (taken.blocked.has(date)) return json({ error: 'An diesem Tag sind leider keine Termine möglich.' }, 409);
  let busy = taken.busy.get(date) || [];
  if (date === b.date) {
    // der eigene alte Termin zählt nicht als Hindernis
    const of = toMinutes(b.start), ot = toMinutes(b.end);
    let skipped = false;
    busy = busy.filter(([f, t]) => (!skipped && f === of && t === ot) ? ((skipped = true), false) : true);
  }
  if (overlapsAny(slot, busy) || (await env.VOUCHERS.get(`booking:${slot.date}:${slot.slotId}`))) {
    return json({ error: 'Dieser Termin ist gerade vergeben worden. Bitte wähl einen anderen.' }, 409);
  }

  const nb = Object.assign({}, b, {
    date: slot.date, slot_id: slot.slotId, start: slot.start, end: slot.end,
    minutes: slot.minutes, city: slot.city, place: slot.place,
    orig_date: b.orig_date || b.date,
    moves: (b.moves || 0) + 1,
    moved_at: new Date().toISOString(),
    moved_from: `${b.date} ${b.start}`,
    reminded: false,
  });
  delete nb.gcal_id;
  const newKey = `booking:${nb.date}:${nb.slot_id}`;

  await env.VOUCHERS.put(newKey, JSON.stringify(nb));
  await env.VOUCHERS.delete(oldKey);
  await indexBooking(nb, env);
  await markFree([oldKey], env);

  // Karte: Datum der eingelösten Einheit nachziehen
  if (nb.card_code) {
    const raw = await env.VOUCHERS.get(`voucher:${nb.card_code}`);
    if (raw) {
      const v = JSON.parse(raw);
      for (const red of v.redemptions || []) if (red.booking_id === nb.id) red.date = nb.date;
      await env.VOUCHERS.put(`voucher:${nb.card_code}`, JSON.stringify(v));
    }
  }

  try {
    await calendarRemove(b, env);
    await calendarInsert(nb, env);
  } catch (err) { console.error('Kalender beim Verschieben', err); }
  try { await sendMovedMail(nb, b, env); } catch (err) { console.error('Mail Verschieben (Kunde)', err); }
  try { await sendMovedOwnerMail(nb, b, env); } catch (err) { console.error('Mail Verschieben (Inhaber)', err); }

  return json({ ok: true, date: nb.date, start: nb.start, end: nb.end, city: nb.city, place: nb.place, label: nb.label });
}

/**
 * Aufräumen nach den Fristen aus der Datenschutzerklärung:
 * Buchungen bis Ende des Folgejahres nach dem Termin, Widerrufe drei Jahre ab Ende des Eingangsjahres.
 * (Rechnungen liegen bei Stripe und sind davon nicht betroffen.)
 */
async function cleanupOldData(env) {
  try {
    const year = Number(isoDate(new Date()).slice(0, 4));
    const bookings = await env.VOUCHERS.list({ prefix: 'booking:' });
    for (const k of bookings.keys) {
      const y = Number(k.name.slice(8, 12));
      if (y && y < year - 1) await env.VOUCHERS.delete(k.name);
    }
    const widerrufe = await env.VOUCHERS.list({ prefix: 'widerruf:' });
    for (const k of widerrufe.keys) {
      const y = Number(k.name.slice(9, 13));
      if (y && y < year - 3) await env.VOUCHERS.delete(k.name);
    }
  } catch (err) {
    console.error('Aufräumen fehlgeschlagen', err);
  }
}

async function sendMovedMail(nb, old, env) {
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(nb.name))},</p>
    <p style="margin:0 0 22px">dein Termin ist verschoben. Hier die neuen Daten:</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${row('Neu', `<b>${fmtDate(nb.date)}, ${nb.start}–${nb.end} Uhr</b>`)}
      ${row('Ort', `${esc(nb.place)}, ${esc(nb.city)}`)}
      ${row('Bisher', `<s>${fmtDate(old.date)}, ${old.start} Uhr</s>`)}
      ${row('Leistung', esc(nb.label))}
    </table>
    <p style="margin:0 0 18px;font-size:14px;color:#9AA0AB">
      Die angeh&auml;ngte Kalenderdatei ersetzt den alten Eintrag &ndash; einmal antippen, dann steht der neue Termin in deinem Kalender.
    </p>
    ${moveHtml(nb, env)}`;
  await sendMail(env, {
    to: nb.email,
    subject: `Termin verschoben: ${nb.label} am ${fmtDate(nb.date)}, ${nb.start} Uhr`,
    html: mailShell('Termin verschoben', inner, env),
    attachments: icsAttachment(nb, env),
  });
}

async function sendMovedOwnerMail(nb, old, env) {
  const cfg = config(env);
  const rows =
    row('Neu', `${fmtDate(nb.date)}, ${nb.start}–${nb.end} Uhr (${esc(nb.city)})`) +
    row('Bisher', `${fmtDate(old.date)}, ${old.start}–${old.end} Uhr`) +
    row('Name', esc(nb.name)) +
    row('Telefon', esc(nb.phone || '–')) +
    row('E-Mail', esc(nb.email)) +
    row('Leistung', esc(nb.label)) +
    row('Verschoben', `${nb.moves}. Mal`);
  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Verschoben: ${nb.name} → ${fmtDate(nb.date)} ${nb.start} Uhr`,
    html: mailShell('Termin verschoben', `<table style="width:100%;border-collapse:collapse">${rows}</table>`, env),
  });
}

/* ------------------------------------------------------------------ */
/* Widerruf (Widerrufsbutton nach § 356a BGB)                           */
/* ------------------------------------------------------------------ */

function berlinStamp(d) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d) + ' Uhr';
}

/** POST /api/widerruf { name, email, vertrag, nachricht } */
async function handleWiderruf(request, env) {
  const cfg = config(env);
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true });   // Honigtopf für Bots

  const name = clean(body.name, 100);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const vertrag = clean(body.vertrag, 300);
  const nachricht = clean(body.nachricht, 1000);
  if (!name) return json({ error: 'Bitte deinen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte die E-Mail-Adresse angeben, an die die Eingangsbestätigung gehen soll.' }, 400);
  if (!vertrag) return json({ error: 'Bitte gib an, welchen Vertrag du widerrufen möchtest (z. B. Code, Termin oder Kaufdatum).' }, 400);

  const ip = request.headers.get('cf-connecting-ip') || 'unbekannt';
  const rlKey = `wrl:${ip}`;
  const count = Number(await env.VOUCHERS.get(rlKey) || 0);
  if (count >= 10) return json({ error: `Zu viele Versuche. Schreib mir bitte direkt an ${cfg.ownerEmail}.` }, 429);
  await env.VOUCHERS.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  const now = new Date();
  const id = randomToken(10);
  const rec = { id, name, email, vertrag, nachricht, received: now.toISOString() };
  await env.VOUCHERS.put(`widerruf:${now.toISOString()}:${id}`, JSON.stringify(rec));

  const rows =
    row('Eingegangen am', berlinStamp(now)) +
    row('Name', esc(name)) +
    row('E-Mail', esc(email)) +
    row('Vertrag', esc(vertrag)) +
    (nachricht ? row('Nachricht', esc(nachricht)) : '');

  await sendMail(env, {
    to: email,
    subject: 'Eingangsbestätigung deines Widerrufs',
    html: mailShell('Widerruf eingegangen', `
      <p style="margin:0 0 18px">Hallo ${esc(firstName(name))},</p>
      <p style="margin:0 0 22px">hiermit best&auml;tige ich den Eingang deiner Widerrufserkl&auml;rung mit folgendem Inhalt:</p>
      <p style="margin:0 0 22px;padding:14px 16px;border-left:3px solid #EFB92E;background:#f9fafb">
        Hiermit widerrufe ich den folgenden Vertrag: ${esc(vertrag)}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">${rows}</table>
      <p style="margin:0 0 14px;font-size:14px;color:#9AA0AB">
        Das ist eine automatische Eingangsbest&auml;tigung. Ob der Widerruf wirksam ist, habe ich damit noch nicht gepr&uuml;ft.
        Ich melde mich pers&ouml;nlich bei dir &ndash; eine R&uuml;ckzahlung erfolgt sp&auml;testens 14 Tage nach Eingang.
      </p>`, env),
  });
  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Widerruf eingegangen: ${name}`,
    html: mailShell('Widerruf eingegangen', `
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${rows}</table>
      <p style="margin:0;font-size:14px">Bitte innerhalb von 14 Tagen pr&uuml;fen und gegebenenfalls in Stripe erstatten
        (bei bereits erbrachten Trainings anteilig).</p>`, env),
  });

  return json({ ok: true, received: now.toISOString(), received_text: berlinStamp(now) });
}

/** Widerrufsbelehrung + Bestätigung der Zustimmung – gehört in die Bestätigungsmail (dauerhafter Datenträger). */
function widerrufMailHtml(env) {
  const cfg = config(env);
  const p = 'margin:0 0 10px;font-size:12px;line-height:1.55;color:#9AA0AB';
  return `
    <div style="border-top:1px solid #2E323B;margin-top:26px;padding-top:18px">
      <p style="${p}"><b style="color:#ECE9E2">Deine Zustimmung:</b> Du hast ausdr&uuml;cklich verlangt, dass ich vor Ablauf der
        Widerrufsfrist mit dem Training beginne. Dir ist bekannt, dass du bei einem Widerruf f&uuml;r bereits erbrachte Trainings
        Wertersatz leistest und dein Widerrufsrecht erlischt, sobald alle Trainings erbracht sind.</p>
      <p style="${p}"><b style="color:#ECE9E2">Widerrufsbelehrung &ndash; Widerrufsrecht:</b> Du hast das Recht, binnen vierzehn Tagen
        ohne Angabe von Gr&uuml;nden diesen Vertrag zu widerrufen. Die Widerrufsfrist betr&auml;gt vierzehn Tage ab dem Tag des
        Vertragsabschlusses. Um dein Widerrufsrecht auszu&uuml;ben, musst du mich (Niklas Donner &ndash; Fitness Donner,
        Prinzenstra&szlig;e 2a, 42697 Solingen, Telefon ${esc(cfg.ownerPhone)}, E-Mail ${esc(cfg.ownerEmail)}) mittels einer eindeutigen
        Erkl&auml;rung (z.&nbsp;B. ein mit der Post versandter Brief oder eine E-Mail) &uuml;ber deinen Entschluss, diesen Vertrag zu
        widerrufen, informieren. Du kannst daf&uuml;r das Muster-Widerrufsformular unter ${esc(cfg.siteOrigin)}/buchungsbedingungen.html#widerruf
        verwenden, das jedoch nicht vorgeschrieben ist. Du kannst den Widerruf auch &uuml;ber die Schaltfl&auml;che
        &bdquo;Vertrag widerrufen&ldquo; auf ${esc(cfg.siteOrigin)}/widerruf.html erkl&auml;ren. Zur Wahrung der Widerrufsfrist reicht es aus,
        dass du die Mitteilung &uuml;ber die Aus&uuml;bung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.</p>
      <p style="${p}"><b style="color:#ECE9E2">Folgen des Widerrufs:</b> Wenn du diesen Vertrag widerrufst, habe ich dir alle Zahlungen,
        die ich von dir erhalten habe, unverz&uuml;glich und sp&auml;testens binnen vierzehn Tagen ab dem Tag zur&uuml;ckzuzahlen, an dem
        die Mitteilung &uuml;ber deinen Widerruf dieses Vertrags bei mir eingegangen ist. F&uuml;r diese R&uuml;ckzahlung verwende ich
        dasselbe Zahlungsmittel, das du bei der urspr&uuml;nglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde
        ausdr&uuml;cklich etwas anderes vereinbart; in keinem Fall werden dir wegen dieser R&uuml;ckzahlung Entgelte berechnet.
        Hast du verlangt, dass die Dienstleistungen w&auml;hrend der Widerrufsfrist beginnen sollen, so hast du mir einen angemessenen
        Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem du mich von der Aus&uuml;bung des Widerrufsrechts
        hinsichtlich dieses Vertrags unterrichtest, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag
        vorgesehenen Dienstleistungen entspricht.</p>
      <p style="${p}">Es gelten meine Buchungsbedingungen: ${esc(cfg.siteOrigin)}/buchungsbedingungen.html</p>
    </div>`;
}

async function stripeCall(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : (params || new URLSearchParams()).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('Stripe-Fehler', method, path, res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

async function stripe(env, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Stripe-Fehler', res.status, JSON.stringify(data));
    return null;
  }
  return data;
}

async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Replay-Schutz: maximal 5 Minuten alt
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* 7. Kleinkram                                                        */
/* ------------------------------------------------------------------ */

/**
 * Live-Einstellungen: CONFIG plus alles, was im Backend geändert wurde.
 * Wird überall dort benutzt, wo Preise oder Fristen eine Rolle spielen.
 */
async function liveConfig(env) {
  const base = config(env);
  try {
    const raw = await env.VOUCHERS.get('settings');
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base,
      trainingCents: num(s.trainingCents, base.trainingCents),
      probeCents: num(s.probeCents, base.probeCents),
      bookingLeadHours: num(s.bookingLeadHours, base.bookingLeadHours),
      bookingHorizonDays: num(s.bookingHorizonDays, base.bookingHorizonDays),
    };
  } catch (err) {
    console.error('Einstellungen unlesbar', err);
    return base;
  }
}

async function liveCards(env) {
  const out = JSON.parse(JSON.stringify(CARDS));
  try {
    const raw = await env.VOUCHERS.get('settings');
    const s = raw ? JSON.parse(raw) : {};
    for (const key of Object.keys(out)) {
      const o = (s.cards || {})[key] || {};
      out[key].unitCents = num(o.unitCents, out[key].unitCents);
      out[key].totalCents = num(o.totalCents, out[key].unitCents * out[key].sessions);
    }
  } catch (err) {
    console.error('Karteneinstellungen unlesbar', err);
  }
  return out;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function config(env) {
  return {
    ...CONFIG,
    siteOrigin: env.SITE_ORIGIN || CONFIG.siteOrigin,
    ownerEmail: env.OWNER_EMAIL || CONFIG.ownerEmail,
    fromEmail: env.FROM_EMAIL || CONFIG.fromEmail,
  };
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I, O, 0, 1

function randomChars(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function randomToken(n) {
  return randomChars(n).toLowerCase();
}

async function uniqueCode(env) {
  for (let i = 0; i < 6; i++) {
    const code = `FD-${randomChars(4)}-${randomChars(4)}`;
    const exists = await env.VOUCHERS.get(`voucher:${code}`);
    if (!exists) return code;
  }
  return `FD-${randomChars(6)}-${randomChars(6)}`;
}

function expiryDate(from, years) {
  // Gesetzliche Regelverjährung: 3 Jahre, gerechnet ab Ende des Kaufjahres
  return `${from.getUTCFullYear() + years}-12-31`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** "10:45" -> 645 */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** 645 -> "10:45" */
function fromMinutes(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Deutsche Ortszeit -> UTC. Berücksichtigt Sommer-/Winterzeit,
 * damit ein 10:45-Slot im Juli und im Januar gleich richtig liegt.
 */
function berlinToUtc(date, hhmm) {
  const asUtc = new Date(`${date}T${hhmm}:00Z`);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'longOffset',
  })
    .formatToParts(asUtc)
    .find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return asUtc;
  const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return new Date(asUtc.getTime() - offset * 60000);
}

function fmtDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function fmtEur(cents) {
  const v = (cents / 100).toFixed(2).replace('.', ',');
  return `${v.endsWith(',00') ? v.slice(0, -3) : v} €`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cors(res, request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', allow);
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  // Authorization wird fürs Backend gebraucht – ohne das scheitert der Preflight
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

/* Nur für die Tests: Zugriff auf die Innereien der Terminlogik. */
export const __test = { slotsForDate, overlapsAny, AVAILABILITY, LOCATIONS, toMinutes, fromMinutes, mailShell, mailText, CONFIG };

/* ================================================================== */
/* Kursmodul: config.js                                            */
/* ================================================================== */

/**
 * Kursmodul – Anbieterinnen, Voreinstellungen, KV-Schlüssel.
 *
 * Alle neuen KV-Schlüssel beginnen mit "kurs:<anbieterin>:" (Ausnahme: "kurs:hold:<id>",
 * das ist nur ein Zeiger auf eine Bestellung). Bestehende Schlüssel werden nie umgeschrieben,
 * nur gelesen (booking:…, voucher:…) bzw. beim Einlösen eines Gutscheins wie bisher fortgeschrieben.
 */

/** Stündlicher Cron. In Cloudflare unter Einstellungen → Trigger zusätzlich eintragen (optional). */
const KURS_CRON = '17 * * * *';
const GS_CRON = '*/15 * * * *';   // GS-ZEIT: Gutscheine zur Wunsch-Uhrzeit

/** Welche Anbieterin besitzt die Personal-Training-Slots dieses Workers? Nur ihre Kurse blockieren sie. */
const KURS_PT_PROVIDER = 'niklas';

/**
 * Anbieterinnen. Öffentlich sichtbar sind nur name, kurzname und die Kontaktdaten.
 *   stripe.modus  'plattform'  = über das Stripe-Konto dieses Workers (Niklas)
 *                 'connect'    = Stripe Connect, Standard-Konto, Direct Charges (später Katharina)
 *   stripe.konto  acct_… des verbundenen Kontos (nur bei 'connect')
 */
const KURS_PROVIDERS = {
  niklas: {
    id: 'niklas',
    name: 'Niklas Donner',
    marke: 'Fitness Donner',
    email: 'info@fitnessdonner.de',
    telefon: '0177 6311404',
    anschrift: 'Prinzenstraße 2a, 42697 Solingen',
    site: 'https://fitnessdonner.de',
    aktiv: true,
    stripe: { modus: 'plattform', konto: '' },
    // Kontoauszug: Stripe hängt das an den Kontotext an ("FITDONNER* KURS NIKLAS"), max. 22 Zeichen gesamt
    kontoauszug: 'KURS NIKLAS',
    rechnung_fuss: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    absender: '',   // leer = Absender des Workers (FROM_EMAIL)
  },
  katharina: {
    id: 'katharina',
    name: 'Katharina (Platzhalter)',
    marke: '',
    email: '',
    telefon: '',
    anschrift: '',
    site: 'https://fitnessdonner.de',
    aktiv: false,   // erst einschalten, wenn Stripe Connect und Absender eingerichtet sind
    stripe: { modus: 'connect', konto: '' },
    kontoauszug: 'KURS KATHARINA',
    rechnung_fuss: '',
    absender: '',
  },
};

const KURS_PRODUKTE = ['karte5', 'karte10', 'tageskarte'];

/** Voreinstellungen je Anbieterin. Alles hier ist im Admin änderbar (KV kurs:<p>:einstellungen). */
const KURS_DEFAULTS = {
  tageskarte_cents: 1800,
  // Platzhalterpreise – bitte im Admin festlegen
  karten: {
    karte5: { label: '5er-Karte', termine: 5, cents: 8000 },
    karte10: { label: '10er-Karte', termine: 10, cents: 14000 },
  },
  freischalt_tage: 7,          // so viele Tage vorher werden freie Plätze als Tageskarte freigegeben
  usc_aktiv: true,             // Liste „Freie Plätze für Urban Sports melden“ im Admin
  usc_gemeinsam: true,         // USC-Plätze gehen vom selben Restkontingent ab wie Tageskarten
  warteliste_stunden: 12,      // Zeitfenster zum Bestätigen beim Nachrücken
  buchungsschluss_min: 60,     // bis so viele Minuten vor Beginn online buchbar
  serie_vorlauf_wochen: 10,    // Startdaten für Karten: so viele Wochen im Voraus (= Länge des Kursplans)
  tageskarte_vorlauf_tage: 7,  // (Anzeige) – Tageskarten gibt es ohnehin erst ab Freischaltung
  gueltig_monate: 12,          // Karten: Rahmen für Ersatztermine
  inklusiv: { karte4: 0, karte8: 0 },   // Kurse bei PT-Karten: aus (Stand 24.10.2026 – PT und Kurse getrennt). >0 schaltet es wieder ein
  ics_token: '',               // geheimer Teil des Kalender-Abos (leer = Abo aus)
  usc_mail: true,              // Mail an die Anbieterin, sobald Plätze für USC gemeldet werden können
};

const KURS_LABEL = {
  karte: 'Karte',
  karte5: '5er-Karte',
  karte10: '10er-Karte',
  tageskarte: 'Einzelticket',
  inklusiv: 'Inklusive (Personal-Training-Karte)',
  kartebuchung: 'Buchung mit Kurskarte',
  manuell: 'Manuell eingetragen',
  ersatz: 'Ersatztermin',
  warteliste: 'Warteliste',
};

/* ---------------- KV-Schlüssel ---------------- */

const K = {
  kurse: (p) => `kurs:${p}:kurse`,
  einstellungen: (p) => `kurs:${p}:einstellungen`,
  termin: (p, kurs, datum) => `kurs:${p}:termin:${kurs}:${datum}`,
  terminPrefix: (p) => `kurs:${p}:termin:`,
  bestellung: (p, id) => `kurs:${p}:bestellung:${id}`,
  bestellungPrefix: (p) => `kurs:${p}:bestellung:`,
  session: (p, cs) => `kurs:${p}:session:${cs}`,
  kunde: (p, email) => `kurs:${p}:kunde:${email}`,
  kundePrefix: (p) => `kurs:${p}:kunde:`,
  offen: (p) => `kurs:${p}:offen`,
  inklusiv: (p, code) => `kurs:${p}:inklusiv:${code}`,
  kurskarte: (p, norm) => `kurs:${p}:kurskarte:${norm}`,
  kurskartePrefix: (p) => `kurs:${p}:kurskarte:`,
  sperre: (p, kurs) => `kurs:${p}:sperre:${kurs}`,
  warte: (p, token) => `kurs:${p}:angebot:${token}`,
  hold: (h) => `kurs:hold:${h}`,
};

/* ---------------- Anbieterin ---------------- */

function kursProvider(id) {
  const p = KURS_PROVIDERS[String(id || '').toLowerCase()];
  return p || null;
}

/** Öffentliche Sicht – nichts über Konten, Rollen oder Verwaltung. */
function kursProviderPublic(p) {
  return { id: p.id, name: p.name, marke: p.marke || '', email: p.email, telefon: p.telefon };
}

/** Einstellungen einer Anbieterin: Voreinstellung + Änderungen aus dem Admin. */
async function kursSettings(env, p) {
  const base = JSON.parse(JSON.stringify(KURS_DEFAULTS));
  try {
    const raw = await env.VOUCHERS.get(K.einstellungen(p));
    if (!raw) return base;
    const s = JSON.parse(raw);
    const out = { ...base, ...pick(s, Object.keys(base).filter((k) => k !== 'karten' && k !== 'inklusiv')) };
    for (const k of Object.keys(base.karten)) {
      const o = (s.karten || {})[k] || {};
      out.karten[k] = { ...base.karten[k], cents: num(o.cents, base.karten[k].cents) };
    }
    out.inklusiv = { ...base.inklusiv, ...(s.inklusiv || {}) };
    for (const k of ['tageskarte_cents', 'freischalt_tage', 'warteliste_stunden', 'buchungsschluss_min',
      'serie_vorlauf_wochen', 'gueltig_monate']) out[k] = num(out[k], base[k]);
    return out;
  } catch (err) {
    console.error('Kurseinstellungen unlesbar', err);
    return base;
  }
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  return out;
}

/** Werte, die pro Kurs überschrieben werden können. */
function kursEffektiv(kurs, s) {
  const pr = kurs.preise || {};
  return {
    freischalt_tage: kurs.freischalt_tage != null && kurs.freischalt_tage !== '' ? num(kurs.freischalt_tage, s.freischalt_tage) : s.freischalt_tage,
    usc_gemeinsam: typeof kurs.usc_gemeinsam === 'boolean' ? kurs.usc_gemeinsam : s.usc_gemeinsam,
    tageskarte_cents: pr.tageskarte_cents != null ? num(pr.tageskarte_cents, s.tageskarte_cents) : s.tageskarte_cents,
    karten: {
      karte5: { ...s.karten.karte5, cents: pr.karte5_cents != null ? num(pr.karte5_cents, s.karten.karte5.cents) : s.karten.karte5.cents },
      karte10: { ...s.karten.karte10, cents: pr.karte10_cents != null ? num(pr.karte10_cents, s.karten.karte10.cents) : s.karten.karte10.cents },
    },
    buchungsschluss_min: s.buchungsschluss_min,
    gueltig_monate: s.gueltig_monate,
  };
}

/** Produkt eines Kurses: aktiv? Widerruf ausgeschlossen? Standard: alles an. */
function kursProdukt(kurs, art) {
  const p = (kurs.produkte || {})[art] || {};
  return {
    aktiv: p.aktiv !== false,
    widerruf_ausgeschlossen: p.widerruf_ausgeschlossen !== false,
  };
}

/** Absender und Antwortadresse für Mails einer Anbieterin. */
function kursMailFrom(env, p) {
  const cfg = config(env);
  return {
    from: p.absender || cfg.fromEmail,
    reply_to: p.email || cfg.ownerEmail,
  };
}

/** Erlaubte Herkunft für eingebettete Widgets: Website + KURS_ORIGINS (kommagetrennt, Variable). */
function kursOrigins(env) {
  const extra = String(env.KURS_ORIGINS || '').split(',').map((s) => clean(s, 200)).filter(Boolean);
  return ['https://fitnessdonner.de', 'https://www.fitnessdonner.de'].concat(extra);
}

/* ================================================================== */
/* Kursmodul: texte.js                                             */
/* ================================================================== */

/**
 * Kursmodul – alle rechtlich relevanten Kundentexte an EINER Stelle.
 *
 * ENTWURF. Diese Formulierungen sind Vorschläge und müssen vom Rechtstextdienst
 * geprüft werden, bevor das Modul live geht (siehe RECHT-TODO.md). Die Website
 * (kurs-buchen.html) holt sich dieselben Texte über GET /api/kurse – so steht vor
 * dem Kauf, in Stripe und in der Mail garantiert derselbe Wortlaut.
 */

const KURS_TEXTE = {
  version: 'entwurf-2026-10-22',

  // Vor dem Kauf (Kurs mit konkreten Terminen, Schalter widerruf_ausgeschlossen = an)
  widerruf_aus_vorher:
    'Kein Widerrufsrecht: Bei Kursen mit festen Terminen handelt es sich um Dienstleistungen im Zusammenhang ' +
    'mit Freizeitbetätigungen, für die ein spezifischer Termin vorgesehen ist. Nach § 312g Abs. 2 Nr. 9 BGB ' +
    'besteht dafür kein Widerrufsrecht. Deine Buchung ist mit dem Kauf verbindlich.',

  widerruf_aus_check:
    'Ich habe zur Kenntnis genommen, dass für diese Kursbuchung mit festen Terminen kein Widerrufsrecht besteht.',

  // In Stripe (kurz, max. 1.200 Zeichen zusammen mit den Terminen)
  widerruf_aus_stripe:
    'Kein Widerrufsrecht (§ 312g Abs. 2 Nr. 9 BGB – Freizeitbetätigung mit festen Terminen).',

  // Wenn der Schalter aus ist: Zustimmung zum vorzeitigen Beginn wie beim Personal Training
  widerruf_an_check:
    'Ich verlange ausdrücklich, dass der Kurs schon vor Ablauf der 14-tägigen Widerrufsfrist beginnt. Mir ist ' +
    'bekannt, dass ich bei einem Widerruf für bereits erbrachte Termine Wertersatz leiste.',

  regeln: [
    'Verpasste Termine verfallen. Ein Nachholen ist nicht möglich.',
    'Sagst du selbst ab, gibt es keine Erstattung. Du kannst deinen Platz aber freigeben, damit jemand von der Warteliste nachrücken kann.',
    'Fällt ein Termin von Seiten der Trainerin aus (z. B. Krankheit), bekommst du einen Ersatztermin oder den anteiligen Preis zurück. Passt dir der Ersatztermin nicht, kannst du stattdessen die Erstattung wählen.',
    'Karten gelten 12 Monate ab Kauf. In diesem Zeitraum liegen auch mögliche Ersatztermine.',
    'Mit einer 5er- oder 10er-Karte buchst du Kurse frei nach Wahl. Sagst du bis 24 Stunden vor Kursbeginn ab, wird die Einheit gutgeschrieben, danach verfällt sie. Ausnahmen sind nach Absprache möglich.',
  ],

  warteliste_info:
    'Wird ein Platz frei, bekommst du eine Mail und hast dann ein festes Zeitfenster, um ihn verbindlich zu buchen. ' +
    'Danach geht das Angebot an die nächste Person. Deine Angaben auf der Warteliste löschen wir nach dem Termin.',
};

/* ================================================================== */
/* Kursmodul: speicher.js                                          */
/* ================================================================== */

/**
 * Kursmodul – Lesen und Schreiben im KV.
 *
 * Belegung eines Termins steht in EINEM Dokument (kurs:<p>:termin:<kurs>:<datum>), damit
 * das Zählen der Plätze ohne list() auskommt (list ist im Free-Tarif auf 1.000/Tag begrenzt
 * und hinkt bis zu 60 s hinterher). Schreibzugriffe auf die Termine eines Kurses laufen
 * unter einer kurzen Sperre, damit sich zwei gleichzeitige Käufe nicht gegenseitig überschreiben.
 */

/* ---------------- Kurse (Register je Anbieterin) ---------------- */

async function kursLoadKurse(env, p) {
  const raw = await env.VOUCHERS.get(K.kurse(p));
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return Array.isArray(d.kurse) ? d.kurse : [];
  } catch (err) {
    console.error('Kursregister unlesbar', p, err);
    return [];
  }
}

async function kursSaveKurse(env, p, kurse) {
  await kursPut(env, K.kurse(p), JSON.stringify({ kurse, updated: new Date().toISOString() }));
}

async function kursFind(env, p, id) {
  return (await kursLoadKurse(env, p)).find((k) => k.id === id) || null;
}

/* ---------------- Termin-Dokument ---------------- */

function kursLeererTermin(kurs, datum) {
  return { kurs, datum, plaetze: [], usc: { plaetze: 0, verlauf: [] }, warteliste: [], absage: null, usc_gemeldet: false };
}

async function kursGetTermin(env, p, kurs, datum) {
  const raw = await env.VOUCHERS.get(K.termin(p, kurs, datum));
  if (!raw) return kursLeererTermin(kurs, datum);
  try {
    const d = JSON.parse(raw);
    return { ...kursLeererTermin(kurs, datum), ...d };
  } catch (err) {
    console.error('Termin unlesbar', kurs, datum, err);
    return kursLeererTermin(kurs, datum);
  }
}

async function kursPutTermin(env, p, doc) {
  // Abgelaufene Reservierungen nicht ewig mitschleppen
  const now = Date.now();
  doc.plaetze = (doc.plaetze || []).filter((s) => !(s.status === 'reserviert' && s.bis && s.bis < now - 3600e3));
  doc.updated = new Date().toISOString();
  await kursPut(env, K.termin(p, doc.kurs, doc.datum), JSON.stringify(doc));
}

/* ---------------- Sperre ---------------- */

/**
 * Führt fn unter einer Sperre je Kurs aus. KV ist keine Datenbank mit Transaktionen –
 * die Sperre verhindert aber zuverlässig, dass zwei Käufe im selben Moment dieselben
 * Termin-Dokumente lesen und sich beim Schreiben gegenseitig die Plätze löschen.
 * Kurze Laufzeit: KV-TTL ist mindestens 60 s; wir geben die Sperre selbst wieder frei.
 */
async function kursMitSperre(env, p, kurs, fn) {
  const key = K.sperre(p, kurs);
  const me = randomToken(12);
  const until = Date.now() + 6000;
  for (;;) {
    const cur = await env.VOUCHERS.get(key);
    let frei = !cur;
    if (cur) {
      try { frei = JSON.parse(cur).bis < Date.now(); } catch (e) { frei = true; }
    }
    if (frei) {
      await kursPut(env, key, JSON.stringify({ id: me, bis: Date.now() + 15000 }), { expirationTtl: 60 });
      const check = await env.VOUCHERS.get(key);
      if (check && JSON.parse(check).id === me) break;
    }
    if (Date.now() > until) {
      const e = new Error('Gerade buchen mehrere Leute gleichzeitig. Bitte versuch es in ein paar Sekunden noch einmal.');
      e.status = 409;
      throw e;
    }
    await kursSleep(250 + Math.random() * 250);
  }
  try {
    return await fn();
  } finally {
    try { await env.VOUCHERS.delete(key); } catch (e) { /* läuft nach 60 s von selbst ab */ }
  }
}

function kursSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** KV erlaubt einen Schreibvorgang pro Sekunde und Schlüssel – bei Ablehnung kurz warten, nochmal. */
async function kursPut(env, key, value, opts) {
  for (let i = 0; i < 3; i++) {
    try {
      return await env.VOUCHERS.put(key, value, opts);
    } catch (err) {
      if (i === 2) throw err;
      await kursSleep(1100);
    }
  }
}

/* ---------------- Bestellungen ---------------- */

async function kursGetBestellung(env, p, id) {
  if (!/^[a-z0-9]{8,40}$/.test(String(id || ''))) return null;
  const raw = await env.VOUCHERS.get(K.bestellung(p, id));
  return raw ? JSON.parse(raw) : null;
}

async function kursPutBestellung(env, p, o) {
  o.updated = new Date().toISOString();
  await kursPut(env, K.bestellung(p, o.id), JSON.stringify(o));
}

/* ---------------- Kundenprofil je Anbieterin ---------------- */

async function kursKundeMerken(env, p, kunde, bestellId) {
  const email = String(kunde.email || '').toLowerCase();
  if (!email) return;
  const key = K.kunde(p, email);
  const raw = await env.VOUCHERS.get(key);
  const k = raw ? JSON.parse(raw) : { email, created: new Date().toISOString(), bestellungen: [] };
  k.name = kunde.name || k.name || '';
  k.telefon = kunde.phone || k.telefon || '';
  if (bestellId && k.bestellungen.indexOf(bestellId) === -1) k.bestellungen.push(bestellId);
  k.updated = new Date().toISOString();
  await kursPut(env, key, JSON.stringify(k));
}

/* ---------------- Offene Vorgänge (Erstattungen) ---------------- */

async function kursGetOffen(env, p) {
  const raw = await env.VOUCHERS.get(K.offen(p));
  const d = raw ? JSON.parse(raw) : {};
  return { erstattungen: d.erstattungen || [] };
}

async function kursPutOffen(env, p, d) {
  // Erledigte nach 90 Tagen aus der Liste nehmen (in der Bestellung bleiben sie stehen)
  const grenze = Date.now() - 90 * 864e5;
  d.erstattungen = d.erstattungen.filter((e) => e.status !== 'erledigt' || new Date(e.erledigt_at || 0).getTime() > grenze);
  await kursPut(env, K.offen(p), JSON.stringify(d));
}

/* ================================================================== */
/* Kursmodul: zeit.js                                              */
/* ================================================================== */

/**
 * Kursmodul – Termine aus der Wochenregel erzeugen, Fristen, Kalenderkopplung.
 */

const KURS_WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const KURS_WT_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Heutiges Datum in Deutschland (nicht UTC – kurz nach Mitternacht macht das einen Tag aus). */
function kursHeute(now) {
  return berlinParts(now ? new Date(now) : new Date()).date;
}

function kursAddDays(date, n) {
  return isoDate(new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5));
}

function kursWochentag(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function kursDatumLang(date) {
  return `${KURS_WT_KURZ[kursWochentag(date)]}, ${fmtDate(date)}`;
}

function kursDatumKurz(date) {
  const [, m, d] = String(date).split('-');
  return `${KURS_WT_KURZ[kursWochentag(date)]} ${d}.${m}.`;
}

function kursEnde(start, minuten) {
  return fromMinutes(Math.min(24 * 60 - 1, toMinutes(start) + Number(minuten || 60)));
}

/**
 * Alle Termine eines Kurses zwischen from und to (jeweils einschließlich).
 * Liefert { kurs, datum, start, ende, minuten, extra, ausfall } – sortiert.
 */
function kursTermine(kurs, from, to) {
  const out = [];
  if (!kurs || !from || !to || from > to) return out;
  const ausfall = new Map((kurs.ausfall || []).map((a) => [a.datum, a]));
  const extraTage = new Set((kurs.extra || []).map((e) => e.datum));

  let start = kurs.start_datum && kurs.start_datum > from ? kurs.start_datum : from;
  const ende = kurs.end_datum && kurs.end_datum < to ? kurs.end_datum : to;
  // auf den richtigen Wochentag vorrücken
  const wt = Number(kurs.wochentag);
  for (let i = 0; i < 7 && kursWochentag(start) !== wt; i++) start = kursAddDays(start, 1);

  for (let d = start; d <= ende; d = kursAddDays(d, 7)) {
    if (extraTage.has(d)) continue;   // an diesem Tag gilt die Sonderzeit
    out.push({
      kurs: kurs.id, datum: d, start: kurs.start, minuten: Number(kurs.minuten || 60),
      ende: kursEnde(kurs.start, kurs.minuten), extra: false, ausfall: ausfall.get(d) || null,
    });
  }
  for (const e of kurs.extra || []) {
    if (e.datum < from || e.datum > to) continue;
    out.push({
      kurs: kurs.id, datum: e.datum, start: e.start, minuten: Number(e.minuten || kurs.minuten || 60),
      ende: kursEnde(e.start, e.minuten || kurs.minuten), extra: true, grund: e.grund || '',
      ausfall: ausfall.get(e.datum) || null,
    });
  }
  return out.sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));
}

/** Ein einzelner Termin eines Kurses an einem Datum – oder null. */
function kursTerminAm(kurs, datum) {
  return kursTermine(kurs, datum, datum)[0] || null;
}

function kursStartMs(t) {
  return berlinToUtc(t.datum, t.start).getTime();
}

/** Ab wann gibt es für diesen Termin Tageskarten (und die USC-Liste)? 00:00 Uhr, X Tage vorher. */
function kursFreischaltMs(t, tage) {
  return berlinToUtc(kursAddDays(t.datum, -Number(tage || 0)), '00:00').getTime();
}

/** Ist der Termin online noch buchbar (Buchungsschluss vor Beginn)? */
function kursBuchbar(t, schlussMin, now) {
  return kursStartMs(t) - Number(schlussMin || 0) * 60e3 > (now || Date.now());
}

/**
 * KURSE-HOOK aus takenState(): Kurszeiten der Personal-Trainerin als belegt melden.
 * Ohne Kurse im KV liefert das eine leere Liste – das bestehende System merkt dann nichts.
 */
async function kursBusy(env, fromDate, toDate) {
  try {
    const from = fromDate || kursHeute();
    const to = toDate || kursAddDays(from, 200);
    const kurse = await kursLoadKurse(env, KURS_PT_PROVIDER);
    const out = [];
    for (const k of kurse) {
      if (!k.aktiv || k.blockiert_pt === false) continue;
      const puffer = Number(k.puffer_min || 0);
      for (const t of kursTermine(k, from, to)) {
        if (t.ausfall && t.ausfall.pt_frei) continue;   // abgesagt und ausdrücklich für Personal Training freigegeben
        const s = toMinutes(t.start);
        out.push({ date: t.datum, from: Math.max(0, s - puffer), to: Math.min(24 * 60, s + t.minuten + puffer) });
      }
    }
    return out;
  } catch (err) {
    // Die Kurse dürfen das Personal Training nie lahmlegen
    console.error('Kursabgleich fehlgeschlagen', err);
    return [];
  }
}

/* ================================================================== */
/* Kursmodul: kapazitaet.js                                        */
/* ================================================================== */

/**
 * Kursmodul – Plätze zählen, Tageskarten-Freischaltung, Kartenreihen.
 *
 * Regeln:
 *  - Alle Plätze stehen zuerst Kartenkunden (5er/10er, Inklusiv-Kurse) offen.
 *  - Ab X Tagen vor dem Termin (00:00 Uhr) gibt es die noch freien Plätze als Tageskarte.
 *  - Zum selben Zeitpunkt erscheint der Termin in der USC-Liste im Admin.
 *  - usc_gemeinsam: gemeldete USC-Plätze zählen zur Kapazität (gemeinsames Restkontingent
 *    mit den Tageskarten). Aus: USC-Plätze kommen obendrauf und belegen nichts.
 */

const KURS_ZAEHLT = (s, now) => s.status === 'gebucht' || (s.status === 'reserviert' && (s.bis || 0) > now);

function kursBelegung(doc, kurs, eff, now) {
  now = now || Date.now();
  const kap = Number(kurs.kapazitaet || 12);
  const quelle = {};
  let gebucht = 0;
  let reserviert = 0;
  for (const s of doc.plaetze || []) {
    if (!KURS_ZAEHLT(s, now)) continue;
    if (s.status === 'gebucht') gebucht++; else reserviert++;
    quelle[s.quelle] = (quelle[s.quelle] || 0) + 1;
  }
  const usc = Number((doc.usc && doc.usc.plaetze) || 0);
  const belegt = gebucht + reserviert + (eff.usc_gemeinsam ? usc : 0);
  return { kap, gebucht, reserviert, quelle, usc, belegt, frei: Math.max(0, kap - belegt), ueberbucht: belegt > kap };
}

/** Status eines Termins für die Kundenseite – ohne interne Zahlen (USC, Warteliste). */
function kursTerminStatus(t, doc, kurs, eff, schlussMin, now) {
  now = now || Date.now();
  const b = kursBelegung(doc, kurs, eff, now);
  const ab = kursFreischaltMs(t, eff.freischalt_tage);
  const abgesagt = !!(t.ausfall || doc.absage);
  return {
    abgesagt,
    buchbar: !abgesagt && kursBuchbar(t, schlussMin, now),
    frei: abgesagt ? 0 : b.frei,
    tageskarte_ab: ab,
    tageskarte_offen: now >= ab,
    belegung: b,
  };
}

/**
 * Die konkreten Termine einer Karte ab einem Startdatum: die nächsten n stattfindenden
 * Wochentermine desselben Kurses. Bereits abgesagte Termine (z. B. Ferien) werden übersprungen.
 * Liefert { termine } oder { error }.
 */
function kursReihe(kurs, start, n, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const bis = kursAddDays(start, 7 * (n + 26));   // genug Puffer für übersprungene Termine
  const alle = kursTermine(kurs, start, bis).filter((t) => !t.extra);
  if (!alle.length || alle[0].datum !== start) return { error: 'An diesem Datum findet der Kurs nicht statt.' };
  if (!kursBuchbar(alle[0], o.schlussMin, now)) return { error: 'Für dieses Startdatum ist die Anmeldung schon geschlossen.' };
  const termine = alle.filter((t) => !t.ausfall).slice(0, n);
  if (termine.length < n) {
    return { error: kurs.end_datum
      ? `Ab diesem Datum finden bis zum Kursende nur noch ${termine.length} Termine statt.`
      : 'Ab diesem Datum lassen sich nicht genug Termine planen.' };
  }
  if (o.gueltigBis && termine[termine.length - 1].datum > o.gueltigBis) {
    return { error: 'Die Termine reichen über die Gültigkeit der Karte hinaus.' };
  }
  return { termine };
}

/** Mögliche Startdaten für eine Karte (die nächsten Wochen). */
function kursStartdaten(kurs, wochen, now) {
  const heute = kursHeute(now);
  return kursTermine(kurs, heute, kursAddDays(heute, 7 * Number(wochen || 8)))
    .filter((t) => !t.extra && !t.ausfall);
}

/* ================================================================== */
/* Kursmodul: mails.js                                             */
/* ================================================================== */

/**
 * Kursmodul – E-Mails. Jede Mail nennt die Anbieterin.
 */

const KM_BTN = 'display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;font-weight:700;' +
  'text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px';
const KM_BTN2 = 'display:inline-block;border:1px solid #ECE9E2;color:#ECE9E2;padding:12px 20px;font-weight:700;' +
  'text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:13px';
const KM_KLEIN = 'margin:0 0 14px;font-size:13px;line-height:1.6;color:#9AA0AB';

function kursLink(p, o) {
  return `${p.site}/kurs-buchung.html?p=${encodeURIComponent(p.id)}&o=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`;
}

/** Mail-Rahmen: bei Niklas das Fitness-Donner-Layout, sonst neutral mit Namen der Anbieterin. */
function kursShell(env, p, headline, inner, vorschau) {
  if (p.id === 'niklas') return mailShell(headline, inner, env, vorschau);
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(headline)}</title></head>
<body style="margin:0;padding:0;background-color:#15171C">
<div style="display:none;max-height:0;overflow:hidden">${esc(vorschau || headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#15171C"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:Helvetica,Arial,sans-serif;color:#ECE9E2;font-size:16px;line-height:1.6">
<tr><td style="padding:0 0 18px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#9AA0AB">Kurse im New Forge Solingen &middot; ${esc(p.name)}</td></tr>
<tr><td style="background-color:#1C1F26;border-top:3px solid #EFB92E;padding:28px 26px 30px">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:800">${headline}</h1>${inner}</td></tr>
<tr><td style="padding:18px 26px 0;color:#767C87;font-size:12px;line-height:1.8">${esc(p.name)}${p.anschrift ? ' &middot; ' + esc(p.anschrift) : ''}${p.email ? ' &middot; ' + esc(p.email) : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

async function kursSendMail(env, p, { to, subject, html, attachments }) {
  if (env.__testTo) { to = env.__testTo; subject = (env.__testPrefix || '') + subject; }   // WV-HOOK: Mailtest
  const f = kursMailFrom(env, p);
  const payload = { from: f.from, to: [to], reply_to: f.reply_to, subject, html, text: mailText(html) };
  if (attachments && attachments.length) payload.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Kurs-Mail fehlgeschlagen', res.status, text);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  const sent = await res.json();
  if (p.id === KUNDEN_ANBIETERIN) await kundenMailLog(env, { to, subject, html, from: payload.from, attachments, resend_id: sent && sent.id });   // KUNDEN-HOOK
  if (p.id === KUNDEN_ANBIETERIN && String(to).toLowerCase() === String(p.email || config(env).ownerEmail || '').toLowerCase()) await pushAusMail(env, subject);   // PUSH-HOOK
  return sent;
}

/** Link „In Google Kalender eintragen“ für einen Termin (Ortszeit Berlin). */
function kursGoogleLink(p, kurs, t) {
  const z = (d, hm) => d.replace(/-/g, '') + 'T' + String(hm || '00:00').replace(':', '') + '00';
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${kurs.titel} mit ${p.name}`,
    dates: `${z(t.datum, t.start)}/${z(t.datum, t.ende)}`,
    ctz: 'Europe/Berlin',
    location: kurs.ort + (kurs.adresse ? ', ' + kurs.adresse : ''),
    details: `Kurs bei ${p.name}. Bitte 10 Minuten vorher da sein.`,
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

/** Eine .ics-Datei mit allen Terminen der Bestellung (als Text). */
function kursIcsText(p, kurs, termine, uidBase) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const e = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/[;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fitness Donner//Kurse//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const t of termine) {
    lines.push('BEGIN:VEVENT',
      `UID:${uidBase}-${t.datum}@fitnessdonner.de`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(berlinToUtc(t.datum, t.start))}`,
      `DTEND:${stamp(berlinToUtc(t.datum, t.ende))}`,
      `SUMMARY:${e(`${kurs.titel} mit ${p.name}`)}`,
      `LOCATION:${e(kurs.ort + (kurs.adresse ? ', ' + kurs.adresse : ''))}`,
      `DESCRIPTION:${e(`Kurs bei ${p.name}. Bitte 10 Minuten vorher da sein.`)}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', `DESCRIPTION:${e(kurs.titel + ' heute um ' + t.start + ' Uhr')}`, 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Dieselbe Datei als Mail-Anhang. */
function kursIcs(env, p, kurs, termine, uidBase) {
  const bytes = new TextEncoder().encode(kursIcsText(p, kurs, termine, uidBase));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { filename: 'Kurstermine.ics', content: btoa(bin), content_type: 'text/calendar; charset=utf-8; method=PUBLISH' };
}

function kursTerminTabelle(kurs, termine, p) {
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 22px">${termine.map((t) => `<tr>
    <td style="padding:7px 0;font-size:15px;border-bottom:1px solid #2E323B">${esc(kursDatumLang(t.datum))}</td>
    <td style="padding:7px 0;font-size:15px;text-align:right;border-bottom:1px solid #2E323B">${esc(t.start)}&ndash;${esc(t.ende)} Uhr</td>
    ${p ? `<td style="padding:7px 0 7px 12px;font-size:12px;text-align:right;border-bottom:1px solid #2E323B;white-space:nowrap"><a href="${esc(kursGoogleLink(p, kurs, t))}" style="color:#EFB92E">+ Google</a></td>` : ''}
  </tr>`).join('')}</table>`;
}

function kursRegelnHtml() {
  return `<div style="border-top:1px solid #2E323B;margin-top:22px;padding-top:16px">
    <p style="${KM_KLEIN};font-weight:700;color:#ECE9E2">So läuft es</p>
    ${KURS_TEXTE.regeln.map((r) => `<p style="${KM_KLEIN}">&ndash; ${esc(r)}</p>`).join('')}
  </div>`;
}

function kursWiderrufHtml(env, p, o) {
  if (o.widerruf_ausgeschlossen) {
    return `<div style="border-top:1px solid #2E323B;margin-top:10px;padding-top:16px">
      <p style="${KM_KLEIN}"><b style="color:#ECE9E2">Hinweis zum Widerrufsrecht:</b> ${esc(KURS_TEXTE.widerruf_aus_vorher)}
      ${o.widerruf_hinweis_at ? `Diesen Hinweis hast du vor dem Kauf bestätigt (${esc(berlinStamp(new Date(o.widerruf_hinweis_at)))}).` : ''}</p>
    </div>`;
  }
  // Ohne Ausschluss: die bestehende Widerrufsbelehrung (gilt für Niklas; für andere Anbieterinnen eigene Fassung nötig)
  return p.id === 'niklas' ? widerrufMailHtml(env) : '';
}

function kursTermineDerBestellung(kurs, o) {
  return (o.termine || []).map((d) => kursTerminAm(kurs, d) || { datum: d, start: kurs.start, ende: '' });
}

/* ---------------- Bestätigung ---------------- */

async function kursMailBestaetigung(env, p, kurs, o) {
  const termine = kursTermineDerBestellung(kurs, o);
  const karte = o.art === 'karte5' || o.art === 'karte10';
  const rows =
    row('Kurs', esc(kurs.titel)) +
    row('Anbieterin', esc(p.name)) +
    row('Ort', esc(kurs.ort + (kurs.adresse ? ', ' + kurs.adresse : ''))) +
    row('Gebucht', esc(o.label || KURS_LABEL[o.art] || o.art)) +
    (o.gutschein && o.gutschein.cents ? row('Gutschein', `${esc(o.gutschein.code)} &middot; ${fmtEur(o.gutschein.cents)} angerechnet`) : '') +
    row('Bezahlt', o.offen_cents > 0 ? fmtEur(o.offen_cents) : (o.art === 'inklusiv' ? 'inklusive (Personal-Training-Karte)' : o.art === 'kartebuchung' ? 'mit deiner Karte ' + esc(o.karte_code) : 'bereits beglichen')) +
    (karte ? row('Gültig bis', fmtDate(o.gueltig_bis)) : '');

  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(o.kunde.name))},</p>
    <p style="margin:0 0 20px">${termine.length > 1 ? `deine ${termine.length} Kurstermine stehen fest` : 'dein Kurstermin steht fest'}. Ich freue mich auf dich!</p>
    ${kursTerminTabelle(kurs, termine, p)}
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px">${rows}</table>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(kursLink(p, o))}" style="${KM_BTN}">Meine Kursbuchung</a></p>
    <p style="${KM_KLEIN}"><b style="color:#ECE9E2">In deinen Kalender:</b> Alle Termine hängen als Kalenderdatei an dieser Mail – einmal antippen, dann stehen sie im iPhone-, Android- oder Outlook-Kalender. Für Google Kalender tippst du neben einem Termin auf „+ Google“ oder holst dir unter „Meine Kursbuchung“ alle auf einmal.</p>
    <p style="${KM_KLEIN}">Am Tag vor jedem Termin bekommst du eine kurze Erinnerung. ${o.art === 'kartebuchung' ? 'Kannst du nicht? Über „Meine Kursbuchung“ oder im Mitgliederbereich sagst du ab. Bis ' + KARTE_ABSAGE_H + ' Stunden vor Kursbeginn wird die Einheit gutgeschrieben, danach verfällt sie.' : 'Kannst du an einem Termin nicht? Über „Meine Kursbuchung“ gibst du deinen Platz frei – eine Erstattung gibt es dafür nicht, aber jemand von der Warteliste freut sich.'}</p>
    ${kursRegelnHtml()}
    ${kursWiderrufHtml(env, p, o)}`;

  await kursSendMail(env, p, {
    to: o.kunde.email,
    subject: `Kurs bestätigt: ${kurs.titel} (${termine.length > 1 ? termine.length + ' Termine ab ' + fmtDate(termine[0].datum) : fmtDate(termine[0].datum)})`,
    html: kursShell(env, p, 'Kurs gebucht', inner, `${kurs.titel} · ${p.name}`),
    attachments: [kursIcs(env, p, kurs, termine, o.id)],
  });
}

async function kursMailInhaber(env, p, kurs, o, titel) {
  const termine = kursTermineDerBestellung(kurs, o);
  const rows =
    row('Kurs', esc(kurs.titel)) +
    row('Was', esc(o.label || KURS_LABEL[o.art])) +
    row('Name', esc(o.kunde.name)) +
    row('E-Mail', esc(o.kunde.email)) +
    (o.kunde.phone ? row('Telefon', esc(o.kunde.phone)) : '') +
    row('Bezahlt', o.offen_cents > 0 ? fmtEur(o.offen_cents) + (o.pay_status === 'unpaid' ? ' · Lastschrift läuft' : '') : '0 €') +
    (o.gutschein && o.gutschein.cents ? row('Gutschein', `${esc(o.gutschein.code)} · ${fmtEur(o.gutschein.cents)}`) : '') +
    row('Termine', termine.map((t) => esc(kursDatumLang(t.datum))).join('<br>'));
  await kursSendMail(env, p, {
    to: p.email || config(env).ownerEmail,
    subject: `${titel || 'Kurs gebucht'}: ${kurs.titel} – ${o.kunde.name}`,
    html: kursShell(env, p, titel || 'Kurs gebucht', `<table style="width:100%;border-collapse:collapse">${rows}</table>`),
  });
}

/* ---------------- Absage durch die Trainerin ---------------- */

async function kursMailAbsage(env, p, kurs, o, datum, absage, ersatzTermin) {
  const t = kursTerminAm(kurs, datum) || { datum, start: kurs.start };
  const link = kursLink(p, o);
  const ersatz = absage.modus === 'ersatz' && ersatzTermin;
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(o.kunde.name))},</p>
    <p style="margin:0 0 18px">der Kurs <b>${esc(kurs.titel)}</b> am <b>${esc(kursDatumLang(datum))} um ${esc(t.start)} Uhr</b>
      muss leider ausfallen.${absage.grund ? ' ' + esc(absage.grund) : ''}</p>
    ${ersatz ? `
    <p style="margin:0 0 14px">Als Ersatz habe ich dir einen Platz am <b>${esc(kursDatumLang(ersatzTermin.datum))}, ${esc(ersatzTermin.start)}&ndash;${esc(ersatzTermin.ende)} Uhr</b> reserviert.</p>
    <p style="margin:0 0 20px">Passt dir das nicht, kannst du stattdessen die Erstattung für diesen Termin wählen &ndash; bis zum Beginn des Ersatztermins.</p>
    <p style="margin:0 0 12px;text-align:center"><a href="${esc(link)}&aktion=ersatz&d=${esc(datum)}" style="${KM_BTN}">Ersatztermin passt</a></p>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(link)}&aktion=erstattung&d=${esc(datum)}" style="${KM_BTN2}">Lieber Geld zurück</a></p>
    <p style="${KM_KLEIN}">Meldest du dich nicht, bleibt dein Platz am Ersatztermin für dich reserviert.</p>`
    : `
    <p style="margin:0 0 22px">Den Anteil für diesen Termin bekommst du zurück${o.gutschein && o.gutschein.cents ? ' – was mit Gutschein bezahlt war, geht zurück auf den Gutschein' : ''}. Du musst dafür nichts tun.</p>`}
    <p style="${KM_KLEIN}">Fragen? ${esc(p.telefon || '')} ${p.email ? '&middot; ' + esc(p.email) : ''}</p>`;
  await kursSendMail(env, p, {
    to: o.kunde.email,
    subject: `Kurs am ${fmtDate(datum)} fällt aus – ${ersatz ? 'Ersatztermin für dich' : 'Erstattung'}`,
    html: kursShell(env, p, 'Kurstermin fällt aus', inner),
  });
}

async function kursMailErstattungAngefordert(env, p, kurs, o, e) {
  await kursSendMail(env, p, {
    to: p.email || config(env).ownerEmail,
    subject: `Erstattung angefordert: ${o.kunde.name} – ${kurs.titel} ${fmtDate(e.datum)}`,
    html: kursShell(env, p, 'Erstattung angefordert', `<table style="width:100%;border-collapse:collapse">
      ${row('Kunde', esc(o.kunde.name) + ' &lt;' + esc(o.kunde.email) + '&gt;')}
      ${row('Termin', esc(kursDatumLang(e.datum)))}
      ${row('Betrag', fmtEur(e.cents_bar) + (e.cents_gutschein ? ' + ' + fmtEur(e.cents_gutschein) + ' zurück auf Gutschein' : ''))}
    </table><p style="margin:18px 0 0">In der Verwaltung unter Kurse → Erstattungen auslösen.</p>`),
  });
}

async function kursMailErstattet(env, p, kurs, o, e) {
  await kursSendMail(env, p, {
    to: o.kunde.email,
    subject: `Erstattung für ${kurs.titel} am ${fmtDate(e.datum)}`,
    html: kursShell(env, p, 'Erstattung veranlasst', `
      <p style="margin:0 0 18px">Hallo ${esc(firstName(o.kunde.name))},</p>
      <p style="margin:0 0 18px">für den ausgefallenen Termin am <b>${esc(kursDatumLang(e.datum))}</b> ist die Erstattung veranlasst:</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
        ${e.cents_bar ? row('Zurück aufs Zahlungsmittel', fmtEur(e.cents_bar)) : ''}
        ${e.cents_gutschein ? row('Zurück auf den Gutschein', `${fmtEur(e.cents_gutschein)} (${esc(o.gutschein.code)})`) : ''}
      </table>
      <p style="${KM_KLEIN}">Je nach Bank dauert die Gutschrift ein paar Tage. Anbieterin: ${esc(p.name)}.</p>`),
  });
}

/* ---------------- Warteliste ---------------- */

async function kursMailWarteliste(env, p, kurs, t, w) {
  await kursSendMail(env, p, {
    to: w.email,
    subject: `Warteliste: ${kurs.titel} am ${fmtDate(t.datum)}`,
    html: kursShell(env, p, 'Du stehst auf der Warteliste', `
      <p style="margin:0 0 18px">Hallo ${esc(firstName(w.name))},</p>
      <p style="margin:0 0 18px">du stehst auf der Warteliste für <b>${esc(kurs.titel)}</b> am <b>${esc(kursDatumLang(t.datum))} um ${esc(t.start)} Uhr</b> (Anbieterin: ${esc(p.name)}).</p>
      <p style="${KM_KLEIN}">${esc(KURS_TEXTE.warteliste_info)}</p>
      <p style="${KM_KLEIN}">Doch kein Interesse mehr? <a href="${esc(p.site)}/kurs-buchung.html?p=${esc(p.id)}&w=${esc(w.token)}" style="color:#EFB92E">Von der Warteliste austragen</a></p>`),
  });
}

async function kursMailAngebot(env, p, kurs, t, w, preisCents) {
  const link = `${p.site}/kurs-buchen.html?p=${encodeURIComponent(p.id)}&k=${encodeURIComponent(kurs.id)}&d=${encodeURIComponent(t.datum)}&angebot=${encodeURIComponent(w.token)}`;
  const bis = new Date(w.angebot_bis);
  await kursSendMail(env, p, {
    to: w.email,
    subject: `Platz frei: ${kurs.titel} am ${fmtDate(t.datum)} – bis ${berlinStamp(bis).slice(0, -7)} Uhr sichern`,
    html: kursShell(env, p, 'Ein Platz ist frei geworden', `
      <p style="margin:0 0 18px">Hallo ${esc(firstName(w.name))},</p>
      <p style="margin:0 0 18px">für <b>${esc(kurs.titel)}</b> am <b>${esc(kursDatumLang(t.datum))} um ${esc(t.start)} Uhr</b> ist ein Platz frei geworden.
        Ich halte ihn für dich bis <b>${esc(berlinStamp(bis))}</b>.</p>
      <p style="margin:0 0 22px;text-align:center"><a href="${esc(link)}" style="${KM_BTN}">Platz buchen &middot; ${fmtEur(preisCents)}</a></p>
      <p style="${KM_KLEIN}">Danach geht der Platz an die nächste Person auf der Warteliste. Anbieterin: ${esc(p.name)}.</p>`),
  });
}

/* ---------------- Für die Anbieterin ---------------- */

async function kursMailUsc(env, p, liste) {
  if (!liste.length) return;
  const rows = liste.map((x) => row(esc(kursDatumLang(x.datum)) + ' ' + esc(x.start), `${esc(x.titel)} &middot; <b>${x.frei} frei</b>`)).join('');
  await kursSendMail(env, p, {
    to: p.email || config(env).ownerEmail,
    subject: `Freie Kursplätze für Urban Sports melden (${liste.length} ${liste.length === 1 ? 'Termin' : 'Termine'})`,
    html: kursShell(env, p, 'Plätze für Urban Sports melden', `
      <p style="margin:0 0 16px">Ab heute gibt es für diese Termine Tageskarten. Die noch freien Plätze kannst du jetzt bei Urban Sports Club melden und anschließend in der Verwaltung eintragen:</p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>`),
  });
}

async function kursMailLastschrift(env, p, kurs, o) {
  await kursSendMail(env, p, {
    to: p.email || config(env).ownerEmail,
    subject: `Lastschrift geplatzt: ${o.kunde.name} – ${kurs ? kurs.titel : 'Kurs'}`,
    html: kursShell(env, p, 'Lastschrift geplatzt', `
      <p style="margin:0 0 16px">Die Bank hat die Lastschrift zurückgegeben. Die Plätze stehen weiterhin – kläre die Zahlung direkt.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row('Kunde', esc(o.kunde.name) + ' &lt;' + esc(o.kunde.email) + '&gt;')}
        ${o.kunde.phone ? row('Telefon', esc(o.kunde.phone)) : ''}
        ${row('Betrag', fmtEur(o.offen_cents))}
        ${row('Termine', (o.termine || []).map((d) => esc(kursDatumLang(d))).join('<br>'))}
      </table>`),
  });
}


/* ---------------- Erinnerung am Vortag ---------------- */

async function kursMailErinnerung(env, p, kurs, t, seat, o) {
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(seat.name))},</p>
    <p style="margin:0 0 20px">kurze Erinnerung: <b>morgen</b> ist Kurs. Ich freue mich auf dich!</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
      ${row('Wann', `${esc(kursDatumLang(t.datum))}, ${esc(t.start)}&ndash;${esc(t.ende)} Uhr`)}
      ${row('Was', esc(kurs.titel))}
      ${row('Wo', esc(kurs.ort + (kurs.adresse ? ', ' + kurs.adresse : '')))}
      ${row('Mitbringen', 'Hallenschuhe, Handtuch, Trinkflasche')}
    </table>
    <p style="${KM_KLEIN}">Bitte sei etwa 10 Minuten vorher da.</p>
    ${o ? `<p style="${KM_KLEIN}">Du kannst doch nicht? Gib deinen Platz über <a href="${esc(kursLink(p, o))}" style="color:#EFB92E">Meine Kursbuchung</a> frei, dann kann jemand von der Warteliste nachrücken. Eine Erstattung gibt es dafür nicht.</p>` : ''}
    <p style="${KM_KLEIN};font-size:12px">Diese Erinnerung gehört zu deiner Kursbuchung bei ${esc(p.name)}. Magst du keine Erinnerungen, antworte kurz auf diese Mail.</p>`;
  await kursSendMail(env, p, {
    to: seat.email,
    subject: `Morgen ${t.start} Uhr: ${kurs.titel}`,
    html: kursShell(env, p, 'Morgen ist Kurs', inner, `${kurs.titel} · ${kursDatumLang(t.datum)} · ${t.start} Uhr`),
  });
}

/* ================================================================== */
/* Kursmodul: zahlung.js                                           */
/* ================================================================== */

/**
 * Kursmodul – Stripe und Gutscheine.
 *
 * Heute: alles läuft über das Stripe-Konto des Workers (Niklas).
 * Vorbereitet: Anbieterinnen mit stripe.modus = 'connect' bekommen später Direct Charges auf
 * ihrem eigenen Standard-Konto (Header Stripe-Account). Das Geld läuft dann nie über Niklas.
 */

/** Stripe-Aufruf im Namen einer Anbieterin. */
async function kursStripe(env, p, method, path, params) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (p.stripe && p.stripe.modus === 'connect') {
    if (!p.stripe.konto) return { ok: false, status: 503, data: { error: { message: 'Stripe Connect für diese Anbieterin ist noch nicht eingerichtet.' } } };
    headers['Stripe-Account'] = p.stripe.konto;
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers, body: method === 'GET' ? undefined : (params || new URLSearchParams()).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('Stripe-Fehler (Kurse)', method, path, res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

function kursZahlungBereit(p) {
  if (!p.stripe || p.stripe.modus === 'plattform') return true;
  return p.stripe.modus === 'connect' && !!p.stripe.konto;
}

/**
 * Checkout-Session anlegen. Wie beim Personal Training: Lehnt Stripe eine Zahlungsart ab,
 * wird ohne sie neu versucht. Zusätzlich: Lehnt Stripe den Kontoauszugs-Zusatz ab, ohne ihn.
 */
async function kursCheckout(env, p, params, types) {
  const versuche = [types];
  for (const t of types) if (t !== 'card') versuche.push(types.filter((x) => x !== t));
  versuche.push(['card']);
  const seen = new Set();
  let ohneZusatz = false;
  for (let i = 0; i < versuche.length; i++) {
    const list = versuche[i];
    const k = list.join(',') + (ohneZusatz ? '-oz' : '');
    if (seen.has(k)) continue;
    seen.add(k);
    const q = new URLSearchParams(params);
    q.delete('payment_method_types[]');
    for (const t of list) q.append('payment_method_types[]', t);
    if (ohneZusatz) q.delete('payment_intent_data[statement_descriptor_suffix]');
    const res = await kursStripe(env, p, 'POST', 'checkout/sessions', q);
    if (res.ok) return res.data;
    const msg = JSON.stringify(res.data || {});
    if (!ohneZusatz && /statement_descriptor/i.test(msg)) { ohneZusatz = true; i--; continue; }
    if (!/payment_method/i.test(msg)) return null;
  }
  return null;
}

/* ---------------- Gutscheine ---------------- */

/**
 * Prüft einen Euro-Gutschein für einen Kurs. Gutscheine gehören der ausstellenden Anbieterin:
 * alte Gutscheine ohne Feld "provider" sind Niklas' Gutscheine.
 */
async function kursGutscheinPruefen(env, p, code, preisCents) {
  const v = await loadVoucher(code, env);
  if (v.error) return { error: v.error };
  if (v.kind === 'karte') {
    return { error: `Das ist eine ${v.voucher.label || 'Personal-Training-Karte'}. Kurse, die bei deiner Karte inklusive sind, buchst du über „Mit meiner Personal-Training-Karte“.` };
  }
  if (v.voucher.origin === 'probetraining') return { error: 'Die Gutschrift aus dem Probetraining gilt nur für Personal Training.' };
  if ((v.voucher.provider || 'niklas') !== p.id) return { error: 'Dieser Gutschein gilt nicht für Kurse dieser Anbieterin.' };
  const cents = Math.min(v.remaining, preisCents);
  return { code: v.voucher.code, rest_cents: v.remaining, cents, offen_cents: preisCents - cents };
}

/** Beim Bestätigen den Gutschein belasten – einmal pro Bestellung. */
async function kursGutscheinBelasten(env, o) {
  if (!o.gutschein || !o.gutschein.cents) return { ok: true, cents: 0 };
  const key = `voucher:${o.gutschein.code}`;
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return { ok: false, cents: 0 };
  const v = JSON.parse(raw);
  v.redemptions = v.redemptions || [];
  if (v.redemptions.some((r) => r.kurs_bestellung === o.id && !r.erstattung)) return { ok: true, cents: o.gutschein.cents };
  const rest = (v.amount_cents || 0) - (v.redeemed_cents || 0);
  const cents = Math.max(0, Math.min(rest, o.gutschein.cents));
  v.redeemed_cents = (v.redeemed_cents || 0) + cents;
  v.redemptions.push({ date: o.termine[0], kurs_bestellung: o.id, cents, anbieterin: o.provider });
  if (v.redeemed_cents >= v.amount_cents) v.status = 'redeemed';
  await env.VOUCHERS.put(key, JSON.stringify(v));
  return { ok: cents === o.gutschein.cents, cents };
}

/** Erstattung auf den Gutschein zurückbuchen. */
async function kursGutscheinZurueck(env, o, cents, datum) {
  if (!cents || !o.gutschein) return;
  const key = `voucher:${o.gutschein.code}`;
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return;
  const v = JSON.parse(raw);
  v.redeemed_cents = Math.max(0, (v.redeemed_cents || 0) - cents);
  if (v.status === 'redeemed') v.status = 'active';
  v.redemptions = v.redemptions || [];
  v.redemptions.push({ date: datum || isoDate(new Date()), kurs_bestellung: o.id, cents: -cents, erstattung: true });
  await env.VOUCHERS.put(key, JSON.stringify(v));
}

/** Teilerstattung über Stripe (auf das ursprüngliche Zahlungsmittel). */
async function kursStripeErstatten(env, p, o, cents, grund) {
  if (!cents) return { ok: true };
  if (!o.payment_intent) return { ok: false, error: 'Zu dieser Bestellung ist keine Stripe-Zahlung hinterlegt – bitte direkt in Stripe erstatten.' };
  const q = new URLSearchParams();
  q.set('payment_intent', o.payment_intent);
  q.set('amount', String(cents));
  q.set('reason', 'requested_by_customer');
  q.set('metadata[kurs_bestellung]', o.id);
  q.set('metadata[grund]', String(grund || '').slice(0, 200));
  const res = await kursStripe(env, p, 'POST', 'refunds', q);
  if (!res.ok) return { ok: false, error: (res.data && res.data.error && res.data.error.message) || `Stripe hat die Erstattung über ${fmtEur(cents)} abgelehnt.` };
  return { ok: true, id: res.data.id };
}

/* ================================================================== */
/* Kursmodul: belegung.js                                          */
/* ================================================================== */

/**
 * Kursmodul – Plätze reservieren, bestätigen, freigeben. Warteliste und Nachrücken.
 */

/** Preis auf n Plätze verteilen, Rest-Cent auf die ersten. */
function kursVerteilen(cents, n) {
  const base = Math.floor(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

function kursNeuerSitz(fields) {
  return { id: randomToken(12), created: new Date().toISOString(), ...fields };
}

/** Sitz einer Bestellung im Termin finden (aktive zuerst). */
function kursSitzDerBestellung(doc, orderId, nurAktiv) {
  const list = (doc.plaetze || []).filter((s) => s.order === orderId);
  if (nurAktiv) return list.find((s) => s.status === 'gebucht' || s.status === 'reserviert') || null;
  return list.find((s) => s.status === 'gebucht' || s.status === 'reserviert') || list[0] || null;
}

/**
 * Plätze einer (neuen) Bestellung in den Termin-Dokumenten eintragen.
 * opts.angebot: Token eines Wartelisten-Angebots – dessen gehaltener Platz wird übernommen.
 * Liefert { ok:true } oder { error, voll, datum }.
 */
async function kursPlaetzeReservieren(env, p, kurs, eff, termine, sitzFelder, opts) {
  const o = opts || {};
  return kursMitSperre(env, p.id, kurs.id, async () => {
    const now = Date.now();
    const docs = [];
    for (const t of termine) {
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      if (doc.absage) return { error: `Der Termin am ${t.datum.split('-').reverse().join('.')} fällt aus.`, datum: t.datum };
      let eigen = null;
      if (o.angebot) {
        eigen = (doc.plaetze || []).find((s) => s.angebot === o.angebot && s.status === 'reserviert' && (s.bis || 0) > now && !s.order);
        if (!eigen) return { error: 'Dein Angebot von der Warteliste ist abgelaufen oder schon genutzt.', datum: t.datum };
      }
      if (!eigen) {
        const b = kursBelegung(doc, kurs, eff, now);
        if (b.frei < 1) return { error: 'voll', voll: true, datum: t.datum };
      }
      docs.push({ t, doc, eigen });
    }
    docs.forEach(({ doc, eigen }, i) => {
      const f = sitzFelder[i];
      if (eigen) Object.assign(eigen, f, { angebot: eigen.angebot });
      else doc.plaetze.push(kursNeuerSitz(f));
    });
    for (const { doc } of docs) await kursPutTermin(env, p.id, doc);
    return { ok: true };
  });
}

/** Reservierte Plätze einer Bestellung wieder freigeben (Zahlung abgebrochen). */
async function kursPlaetzeFreigeben(env, p, kurs, o) {
  const frei = [];
  await kursMitSperre(env, p.id, kurs.id, async () => {
    for (const d of o.termine) {
      const doc = await kursGetTermin(env, p.id, kurs.id, d);
      let changed = false;
      for (const s of doc.plaetze) {
        if (s.order !== o.id || s.status !== 'reserviert') continue;
        changed = true;
        if (s.angebot) {
          // Wartelisten-Angebot: Platz geht zurück an die Person, solange ihr Zeitfenster läuft
          const w = (doc.warteliste || []).find((x) => x.token === s.angebot);
          if (w && w.status === 'angeboten' && w.angebot_bis > Date.now()) {
            s.order = ''; s.bis = w.angebot_bis; s.status = 'reserviert';
            continue;
          }
        }
        s.status = 'abgebrochen';
        frei.push(d);
      }
      if (changed) await kursPutTermin(env, p.id, doc);
    }
  });
  return frei;
}

/* ---------------- Warteliste ---------------- */

async function kursWartelisteEintragen(env, p, kurs, datum, person) {
  return kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    const email = person.email.toLowerCase();
    const schon = (doc.warteliste || []).find((w) => w.email === email && (w.status === 'wartet' || w.status === 'angeboten'));
    if (schon) return { ok: true, schon: true, eintrag: schon };
    const eintrag = {
      id: randomToken(10), token: randomToken(24), name: person.name, email, phone: person.phone || '',
      created: new Date().toISOString(), status: 'wartet',
    };
    doc.warteliste = doc.warteliste || [];
    doc.warteliste.push(eintrag);
    await kursPutTermin(env, p.id, doc);
    await kursPut(env, K.warte(p.id, eintrag.token), JSON.stringify({ kurs: kurs.id, datum }), { expirationTtl: 60 * 60 * 24 * 120 });
    return { ok: true, eintrag, position: doc.warteliste.filter((w) => w.status === 'wartet').length };
  });
}

async function kursWartelisteAustragen(env, p, token) {
  const raw = await env.VOUCHERS.get(K.warte(p.id, token));
  if (!raw) return { error: 'Diesen Eintrag gibt es nicht (mehr).' };
  const ref = JSON.parse(raw);
  let frei = false;
  await kursMitSperre(env, p.id, ref.kurs, async () => {
    const doc = await kursGetTermin(env, p.id, ref.kurs, ref.datum);
    const w = (doc.warteliste || []).find((x) => x.token === token);
    if (!w) return;
    if (w.status === 'angeboten') {
      const s = doc.plaetze.find((x) => x.angebot === token && x.status === 'reserviert' && !x.order);
      if (s) { s.status = 'abgebrochen'; frei = true; }
    }
    if (w.status === 'wartet' || w.status === 'angeboten') w.status = 'ausgetragen';
    await kursPutTermin(env, p.id, doc);
  });
  return { ok: true, kurs: ref.kurs, datum: ref.datum, frei };
}

/**
 * Nachrücken: Sind Plätze frei und ist die Tageskarten-Phase erreicht, bekommt die nächste
 * Person auf der Warteliste ein Angebot mit Zeitfenster. Ihr Platz wird so lange gehalten.
 * Abgelaufene Angebote verfallen dabei. Mails gehen erst nach dem Schreiben raus.
 */
async function kursNachruecken(env, p, kurs, eff, s, datum) {
  const t = kursTerminAm(kurs, datum);
  if (!t) return { angeboten: 0 };
  const angebote = [];
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    if (!doc.warteliste || !doc.warteliste.length) return;
    const now = Date.now();
    let changed = false;
    for (const w of doc.warteliste) {
      if (w.status === 'angeboten' && w.angebot_bis < now) { w.status = 'abgelaufen'; changed = true; }
    }
    if (doc.absage || t.ausfall || !kursBuchbar(t, s.buchungsschluss_min, now) || now < kursFreischaltMs(t, eff.freischalt_tage)) {
      if (changed) await kursPutTermin(env, p.id, doc);
      return;
    }
    const spaetestens = kursStartMs(t) - s.buchungsschluss_min * 60e3;
    let b = kursBelegung(doc, kurs, eff, now);
    for (const w of doc.warteliste) {
      if (b.frei < 1) break;
      if (w.status !== 'wartet') continue;
      const bis = Math.min(now + s.warteliste_stunden * 3600e3, spaetestens);
      if (bis - now < 15 * 60e3) break;   // zu knapp für ein faires Zeitfenster
      w.status = 'angeboten';
      w.angebot_bis = bis;
      w.angeboten_at = new Date(now).toISOString();
      doc.plaetze.push(kursNeuerSitz({
        quelle: 'warteliste', status: 'reserviert', bis, angebot: w.token, order: '',
        name: w.name, email: w.email, phone: w.phone,
      }));
      angebote.push(w);
      changed = true;
      b = kursBelegung(doc, kurs, eff, now);
    }
    if (changed) await kursPutTermin(env, p.id, doc);
  });
  for (const w of angebote) {
    try { await kursMailAngebot(env, p, kurs, t, w, eff.tageskarte_cents); }
    catch (err) { console.error('Angebotsmail', err); }
  }
  return { angeboten: angebote.length };
}

/** Bestellung laden und Zugriff per Token prüfen. */
async function kursBestellungMitToken(env, p, id, token) {
  const o = await kursGetBestellung(env, p.id, id);
  if (!o || !token || o.token !== token) return null;
  return o;
}

/* ================================================================== */
/* Kursmodul: oeffentlich.js                                       */
/* ================================================================== */

/**
 * Kursmodul – öffentliche Endpunkte (Kundenseite und eingebettetes Widget).
 *
 *   GET  /api/kurse?p=niklas            Kurse, Termine, Startdaten, Preise, Texte
 *   POST /api/kurse/checkout            Karte oder Tageskarte kaufen → Stripe oder sofort bestätigt
 *   POST /api/kurse/gutschein           Gutschein prüfen (Anbieterin!)
 *   POST /api/kurse/warteliste          auf die Warteliste
 *   POST /api/kurse/warteliste-austragen
 *   POST /api/kurse/release             zurück von der Zahlseite: Reservierung freigeben
 *   GET  /api/kurse/bestellung          Bestellung ansehen (?session_id= oder ?o=&t=)
 *   POST /api/kurse/aktion              Ersatz annehmen, Erstattung wählen, Platz freigeben
 *   POST /api/kurse/inklusiv-check      Personal-Training-Karte: wie viele Kurse sind noch drin?
 *   POST /api/kurse/inklusiv            Kurs mit Personal-Training-Karte buchen
 *   GET  /api/kurse/kalender.ics        Kalender-Abo (geheimer Link)
 */

const KURS_TERMINE_WOCHEN = 10;

function kursFehler(text, status) {
  return json({ error: text }, status || 400);
}

function kursPerson(body) {
  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  const phone = clean(body.phone, 40);
  if (!name) return { error: 'Bitte deinen Namen angeben.' };
  if (!isEmail(email)) return { error: 'Bitte eine gültige E-Mail-Adresse angeben.' };
  if (!phone) return { error: PHONE_ERROR };
  return { name, email, phone };
}

/** Anbieterin aus dem Request – nur aktive, nur bekannte. */
function kursProviderAus(v) {
  const p = kursProvider(v || 'niklas');
  return p && p.aktiv ? p : null;
}

/* ================================================================== */
/* GET /api/kurse                                                       */
/* ================================================================== */

async function kursListe(url, env) {
  const wunsch = String(url.searchParams.get('p') || 'niklas').toLowerCase();
  const ids = wunsch === 'alle' ? Object.keys(KURS_PROVIDERS) : wunsch.split(',');
  const providers = ids.map(kursProviderAus).filter(Boolean);
  if (!providers.length) return kursFehler('Diese Kurse gibt es hier nicht.', 404);
  const nurKurs = clean(url.searchParams.get('k'), 40);
  const now = Date.now();
  const heute = kursHeute(now);

  const out = [];
  let inklusiv = false;
  let first = null;
  for (const p of providers) {
    const s = await kursSettings(env, p.id);
    if (!first) first = { p, s };
    if (p.id === 'niklas' && s.inklusiv && Object.values(s.inklusiv).some((n) => Number(n) > 0)) inklusiv = true;
    const kurse = (await kursLoadKurse(env, p.id)).filter((k) => k.aktiv && (nurKurs ? k.id === nurKurs : k.sichtbar !== false));   // ?k= zeigt auch versteckte Kurse (Testlink)
    for (const kurs of kurse) out.push(await kursOeffentlich(env, p, s, kurs, heute, now));
  }
  out.sort((a, b) => (a.wochentag_sort - b.wochentag_sort) || a.start.localeCompare(b.start));

  return json({
    anbieterin: providers.length === 1 ? kursProviderPublic(providers[0]) : null,
    bereit: providers.every(kursZahlungBereit),
    texte: KURS_TEXTE,
    buchungsschluss_min: first.s.buchungsschluss_min,
    warteliste_stunden: first.s.warteliste_stunden,
    gueltig_monate: first.s.gueltig_monate,
    absage_stunden: KARTE_ABSAGE_H,
    inklusiv,
    kurse: out,
  });
}

async function kursOeffentlich(env, p, s, kurs, heute, now) {
  const eff = kursEffektiv(kurs, s);
  const horizont = kursAddDays(heute, 7 * (Math.max(KURS_TERMINE_WOCHEN, s.serie_vorlauf_wochen) + 12));
  const alle = kursTermine(kurs, heute, horizont);
  const docs = new Map();
  await Promise.all(alle.map(async (t) => docs.set(t.datum, await kursGetTermin(env, p.id, kurs.id, t.datum))));

  const termine = alle
    .filter((t) => t.datum <= kursAddDays(heute, 7 * KURS_TERMINE_WOCHEN))
    .map((t) => {
      const st = kursTerminStatus(t, docs.get(t.datum), kurs, eff, s.buchungsschluss_min, now);
      return {
        datum: t.datum, start: t.start, ende: t.ende, extra: t.extra,
        abgesagt: st.abgesagt, buchbar: st.buchbar,
        frei: st.buchbar ? st.frei : 0,
        tageskarte_offen: st.tageskarte_offen,
        tageskarte_ab: new Date(st.tageskarte_ab).toISOString(),
      };
    })
    .filter((t) => t.buchbar || t.abgesagt);

  const produkte = {};
  for (const art of ['karte5', 'karte10']) {
    const pr = kursProdukt(kurs, art);
    const c = eff.karten[art];
    produkte[art] = { aktiv: pr.aktiv, label: c.label, termine: c.termine, cents: c.cents, widerruf_ausgeschlossen: pr.widerruf_ausgeschlossen };
  }
  const tk = kursProdukt(kurs, 'tageskarte');
  produkte.tageskarte = { aktiv: tk.aktiv, label: 'Einzelticket', termine: 1, cents: eff.tageskarte_cents, widerruf_ausgeschlossen: tk.widerruf_ausgeschlossen, freischalt_tage: eff.freischalt_tage };

  // Startdaten für Karten: Reihe muss komplett in den freien Plätzen liegen
  const gueltigBis = addMonths(heute, s.gueltig_monate);
  const startdaten = kursStartdaten(kurs, s.serie_vorlauf_wochen, now)
    .filter((t) => kursBuchbar(t, s.buchungsschluss_min, now))
    .map((t) => {
      const r = { datum: t.datum };
      for (const art of ['karte5', 'karte10']) {
        if (!produkte[art].aktiv) continue;
        const reihe = kursReihe(kurs, t.datum, produkte[art].termine, { schlussMin: s.buchungsschluss_min, gueltigBis, now });
        if (reihe.error) { r[art] = { ok: false, grund: reihe.error }; continue; }
        const voll = reihe.termine.find((x) => kursBelegung(docs.get(x.datum) || { plaetze: [] }, kurs, eff, now).frei < 1);
        r[art] = voll
          ? { ok: false, grund: `Am ${kursDatumKurz(voll.datum)} ist der Kurs schon voll.` }
          : { ok: true, termine: reihe.termine.map((x) => x.datum), bis: reihe.termine[reihe.termine.length - 1].datum };
      }
      return r;
    });

  return {
    id: kurs.id,
    anbieterin_id: p.id,
    anbieterin: p.name,
    titel: kurs.titel,
    beschreibung: kurs.beschreibung || '',
    kategorie: kurs.kategorie || '',
    bild: kurs.bild || '',
    farbe: kurs.farbe || '',
    ort: kurs.ort || '',
    adresse: kurs.adresse || '',
    wochentag: Number(kurs.wochentag),
    wochentag_name: KURS_WOCHENTAGE[Number(kurs.wochentag)],
    wochentag_sort: (Number(kurs.wochentag) + 6) % 7,
    start: kurs.start,
    ende: alle[0] ? alle[0].ende : '',
    minuten: Number(kurs.minuten || 60),
    kapazitaet: Number(kurs.kapazitaet || 12),
    produkte,
    termine,
    startdaten,
  };
}

/* ================================================================== */
/* POST /api/kurse/gutschein                                            */
/* ================================================================== */

async function kursGutscheinCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const preis = Math.max(0, Math.round(Number(body.preis_cents) || 0));
  const g = await kursGutscheinPruefen(env, p, body.code, preis);
  if (g.error) return json({ ok: false, error: g.error });
  return json({ ok: true, code: g.code, discount_cents: g.cents, open_cents: g.offen_cents, rest_cents: g.rest_cents });
}

/* ================================================================== */
/* POST /api/kurse/checkout                                             */
/* ================================================================== */

async function kursCheckoutHandler(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  if (!kursZahlungBereit(p)) return kursFehler('Online-Buchung ist bei dieser Anbieterin noch nicht möglich.', 503);

  if (body.art === 'karte5' || body.art === 'karte10') return kursKarteCheckout(env, p, body);
  const kurs = await kursFind(env, p.id, clean(body.kurs, 40));
  if (!kurs || !kurs.aktiv) return kursFehler('Diesen Kurs gibt es nicht (mehr).', 404);
  const art = String(body.art || '');
  if (['karte5', 'karte10', 'tageskarte'].indexOf(art) === -1) return kursFehler('Bitte wähle eine Karte oder eine Tageskarte.');
  const produkt = kursProdukt(kurs, art);
  if (!produkt.aktiv) return kursFehler('Dieses Angebot gibt es für den Kurs gerade nicht.');

  const person = kursPerson(body);
  if (person.error) return kursFehler(person.error);
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  if (produkt.widerruf_ausgeschlossen && body.widerruf_ok !== true) {
    return kursFehler('Bitte bestätige den Hinweis zum Widerrufsrecht.');
  }
  if (!produkt.widerruf_ausgeschlossen && body.vorzeitig !== true) {
    return kursFehler('Bitte bestätige, dass der Kurs vor Ablauf der Widerrufsfrist beginnen darf.');
  }

  // Wer von der Zahlseite zurückkommt, gibt seine alte Reservierung zuerst frei
  const hold = holdId(body.hold);
  if (hold) await kursReleaseHold(env, hold);

  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  const heute = kursHeute(now);
  const gueltigBis = addMonths(heute, s.gueltig_monate);
  let termine;
  let preis;
  let label;
  const angebot = clean(body.angebot, 40);

  if (art === 'tageskarte') {
    const datum = String(body.datum || '').slice(0, 10);
    const t = kursTerminAm(kurs, datum);
    if (!t || t.ausfall) return kursFehler('An diesem Tag findet der Kurs nicht statt.');
    if (!kursBuchbar(t, s.buchungsschluss_min, now)) return kursFehler('Für diesen Termin ist die Anmeldung schon geschlossen.');
    if (!angebot && now < kursFreischaltMs(t, eff.freischalt_tage)) {
      return kursFehler(`Einzeltickets für diesen Termin gibt es ab ${fmtDate(kursAddDays(datum, -eff.freischalt_tage))}. Bis dahin sind die Plätze für Kartenkunden reserviert.`);
    }
    termine = [t];
    preis = eff.tageskarte_cents;
    label = 'Einzelticket';
  } else {
    const c = eff.karten[art];
    const r = kursReihe(kurs, String(body.start || '').slice(0, 10), c.termine, { schlussMin: s.buchungsschluss_min, gueltigBis, now });
    if (r.error) return kursFehler(r.error);
    termine = r.termine;
    preis = c.cents;
    label = c.label;
  }

  // Gutschein (nur Euro-Gutscheine der Anbieterin)
  let gutschein = null;
  if (body.gutschein) {
    const g = await kursGutscheinPruefen(env, p, body.gutschein, preis);
    if (g.error) return kursFehler(g.error);
    if (g.cents > 0) gutschein = { code: g.code, cents: g.cents };
  }
  const offen = preis - (gutschein ? gutschein.cents : 0);

  const o = {
    id: randomToken(16), token: randomToken(24), provider: p.id, art, label,
    kurs: kurs.id, kurs_titel: kurs.titel,
    termine: termine.map((t) => t.datum),
    preis_cents: preis, gutschein, offen_cents: offen,
    status: offen > 0 ? 'reserviert' : 'bestaetigt',
    kunde: person,
    created: stamp,
    gueltig_bis: art === 'tageskarte' ? termine[0].datum : gueltigBis,
    widerruf_ausgeschlossen: produkt.widerruf_ausgeschlossen,
    widerruf_hinweis_at: produkt.widerruf_ausgeschlossen ? stamp : '',
    vorzeitig_at: produkt.widerruf_ausgeschlossen ? '' : stamp,
    texte_version: KURS_TEXTE.version,
    hold: hold || '',
    angebot: angebot || '',
    erstattungen: [],
  };

  const werte = kursVerteilen(preis, termine.length);
  const gut = kursVerteilen(gutschein ? gutschein.cents : 0, termine.length);
  const quelle = art === 'tageskarte' ? (angebot ? 'warteliste' : 'tageskarte') : 'karte';
  const bis = now + RESERVE_TTL * 1000;
  const felder = termine.map((t, i) => ({
    order: o.id, quelle, status: offen > 0 ? 'reserviert' : 'gebucht', bis: offen > 0 ? bis : 0,
    name: person.name, email: person.email, phone: person.phone,
    wert_cents: werte[i], wert_gutschein_cents: gut[i],
  }));

  let res;
  try {
    res = await kursPlaetzeReservieren(env, p, kurs, eff, termine, felder, { angebot });
  } catch (err) {
    return kursFehler(err.message, err.status || 500);
  }
  if (res.error) {
    if (res.voll) {
      return json({
        error: termine.length > 1
          ? `Am ${kursDatumKurz(res.datum)} ist der Kurs inzwischen voll. Wähle bitte ein anderes Startdatum.`
          : 'Dieser Termin ist inzwischen ausgebucht. Du kannst dich auf die Warteliste setzen.',
        voll: true, datum: res.datum,
      }, 409);
    }
    return kursFehler(res.error, 409);
  }

  if (offen <= 0) {
    // Komplett mit Gutschein bezahlt – sofort fest
    o.bezahlt_at = stamp;
    await kursPutBestellung(env, p.id, o);
    await kursNachKauf(env, p, kurs, o);
    return json({ status: 'confirmed', o: o.id, t: o.token });
  }

  await kursPutBestellung(env, p.id, o);
  const session = await kursCheckout(env, p, kursStripeParams(p, kurs, o, termine), PAY_TYPES);
  if (!session || !session.url) {
    await kursPlaetzeFreigeben(env, p, kurs, o);
    o.status = 'abgebrochen';
    await kursPutBestellung(env, p.id, o);
    return kursFehler('Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.', 502);
  }
  o.stripe_session = session.id;
  await kursPutBestellung(env, p.id, o);
  if (hold) await kursPut(env, K.hold(hold), JSON.stringify({ p: p.id, o: o.id }), { expirationTtl: RESERVE_TTL });
  return json({ status: 'payment', url: session.url });
}

/** Stripe-Parameter: Termine im Checkout, Anbieterin auf Rechnung und Kontoauszug. */
function kursStripeParams(p, kurs, o, termine) {
  const liste = termine.map((t) => `${kursDatumKurz(t.datum)}${t.datum.slice(2, 4)} ${t.start}`);
  const kurzListe = termine.map((t) => t.datum.slice(8, 10) + '.' + t.datum.slice(5, 7) + '.').join(', ') + termine[0].datum.slice(0, 4);
  const q = new URLSearchParams();
  q.set('mode', 'payment');
  q.set('locale', 'de');
  q.set('submit_type', 'book');
  q.set('customer_email', o.kunde.email);
  q.set('success_url', `${p.site}/kurs-buchung.html?p=${p.id}&session_id={CHECKOUT_SESSION_ID}`);
  q.set('cancel_url', `${p.site}/kurs-buchen.html?p=${p.id}&k=${kurs.id}&abgebrochen=1`);
  q.set('line_items[0][quantity]', '1');
  q.set('line_items[0][price_data][currency]', 'eur');
  q.set('line_items[0][price_data][unit_amount]', String(o.offen_cents));
  q.set('line_items[0][price_data][product_data][name]', `${kurs.titel} · ${o.label} · ${p.name}`);
  q.set('line_items[0][price_data][product_data][description]',
    (`${termine.length === 1 ? 'Termin' : termine.length + ' Termine'}: ${liste.join(', ')} · ${kurs.ort}` +
      (o.gutschein ? ` · Gutschein ${o.gutschein.code} über ${fmtEur(o.gutschein.cents)} angerechnet` : '')).slice(0, 900));
  q.set('custom_text[submit][message]',
    (`Anbieterin: ${p.name}. ${termine.length === 1 ? 'Dein Termin' : 'Deine Termine'}: ${liste.join(' · ')}. ` +
      (o.widerruf_ausgeschlossen ? KURS_TEXTE.widerruf_aus_stripe : '')).slice(0, 1200));
  q.set('payment_intent_data[description]', `Kurs ${kurs.titel} – ${o.label} ab ${fmtDate(termine[0].datum)} (${p.name})`);
  if (p.kontoauszug) q.set('payment_intent_data[statement_descriptor_suffix]', p.kontoauszug.slice(0, 22));
  q.set('payment_intent_data[metadata][kind]', 'kurs');
  q.set('payment_intent_data[metadata][anbieterin]', p.id);
  q.set('invoice_creation[enabled]', 'true');
  q.set('customer_creation', 'always');
  q.set('billing_address_collection', 'required');
  q.set('invoice_creation[invoice_data][description]',
    `${kurs.titel} – ${o.label}, ${kurs.ort}. Anbieterin: ${p.name}. Termine: ${liste.join(', ')}`.slice(0, 1500));
  if (p.rechnung_fuss) q.set('invoice_creation[invoice_data][footer]', p.rechnung_fuss);
  q.set('invoice_creation[invoice_data][custom_fields][0][name]', 'Anbieterin');
  q.set('invoice_creation[invoice_data][custom_fields][0][value]', `${p.name}${p.marke ? ' – ' + p.marke : ''}`.slice(0, 140));
  q.set('invoice_creation[invoice_data][custom_fields][1][name]', 'Termine');
  q.set('invoice_creation[invoice_data][custom_fields][1][value]', kurzListe.slice(0, 140));
  if (o.art !== 'tageskarte') {
    q.set('invoice_creation[invoice_data][custom_fields][2][name]', 'Karte gültig bis');
    q.set('invoice_creation[invoice_data][custom_fields][2][value]', fmtDate(o.gueltig_bis));
  }
  q.set('metadata[kind]', 'kurs');
  q.set('metadata[provider]', p.id);
  q.set('metadata[order]', o.id);
  q.set('metadata[kurs]', kurs.id);
  q.set('metadata[buyer_name]', o.kunde.name);
  q.set('expires_at', String(Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60));
  return q;
}

/** Nach Zahlung (oder Vollzahlung mit Gutschein): Gutschein, Kundenprofil, Mails. */
async function kursNachKauf(env, p, kurs, o) {
  try {
    const g = await kursGutscheinBelasten(env, o);
    if (!g.ok) o.gutschein_problem = `Auf dem Gutschein waren nur noch ${fmtEur(g.cents)} statt ${fmtEur(o.gutschein.cents)}.`;
  } catch (err) { console.error('Gutschein belasten', err); }
  if (o.gutschein_problem) await kursPutBestellung(env, p.id, o);
  try { await kursKundeMerken(env, p.id, o.kunde, o.id); } catch (err) { console.error('Kundenprofil', err); }
  if (o.angebot) {
    try {
      await kursMitSperre(env, p.id, kurs.id, async () => {
        const doc = await kursGetTermin(env, p.id, kurs.id, o.termine[0]);
        const w = (doc.warteliste || []).find((x) => x.token === o.angebot);
        if (w) { w.status = 'gebucht'; await kursPutTermin(env, p.id, doc); }
      });
    } catch (err) { console.error('Warteliste nachtragen', err); }
  }
  try { await kursMailBestaetigung(env, p, kurs, o); } catch (err) { console.error('Kurs-Bestätigung', err); }
  try {
    await kursMailInhaber(env, p, kurs, o, o.ueberbucht && o.ueberbucht.length ? 'Kurs gebucht – ÜBERBUCHT' : 'Kurs gebucht');
  } catch (err) { console.error('Kurs-Inhabermail', err); }
}

/* ================================================================== */
/* Webhook                                                              */
/* ================================================================== */

async function kursConfirmFromSession(session, env) {
  const m = session.metadata || {};
  const p = kursProvider(m.provider);
  if (!p) { console.error('Kurs-Webhook: unbekannte Anbieterin', m.provider); return; }
  const o = await kursGetBestellung(env, p.id, m.order);
  if (!o) { console.error('Kurs-Webhook: Bestellung fehlt', m.order); return; }
  if (o.status === 'bestaetigt') return;
  if (o.flex) return kursKarteBezahlt(env, p, o, session);
  const kurs = await kursFind(env, p.id, o.kurs);
  if (!kurs) { console.error('Kurs-Webhook: Kurs fehlt', o.kurs); return; }
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);

  const ueberbucht = [];
  const nachAbsage = [];
  await kursMitSperre(env, p.id, kurs.id, async () => {
    for (let i = 0; i < o.termine.length; i++) {
      const d = o.termine[i];
      const doc = await kursGetTermin(env, p.id, kurs.id, d);
      let seat = doc.plaetze.find((x) => x.order === o.id && (x.status === 'reserviert' || x.status === 'gebucht'));
      if (seat && seat.status === 'reserviert' && (seat.bis || 0) < Date.now()) {
        // Reservierung war schon abgelaufen – ist der Platz inzwischen anderweitig vergeben?
        if (kursBelegung(doc, kurs, eff, Date.now()).frei < 1) ueberbucht.push(d);
      }
      if (!seat) {
        // Reservierung war abgelaufen – der Kunde hat trotzdem bezahlt: Platz nachtragen
        const b = kursBelegung(doc, kurs, eff, Date.now());
        if (b.frei < 1) ueberbucht.push(d);
        const werte = kursVerteilen(o.preis_cents, o.termine.length);
        const gut = kursVerteilen(o.gutschein ? o.gutschein.cents : 0, o.termine.length);
        seat = {
          id: randomToken(12), created: new Date().toISOString(), order: o.id,
          quelle: o.art === 'tageskarte' ? 'tageskarte' : 'karte', name: o.kunde.name, email: o.kunde.email,
          phone: o.kunde.phone, wert_cents: werte[i], wert_gutschein_cents: gut[i], nachgetragen: true,
        };
        doc.plaetze.push(seat);
      }
      seat.status = doc.absage ? 'abgesagt' : 'gebucht';
      seat.bis = 0;
      if (doc.absage) nachAbsage.push({ datum: d, seat });
      await kursPutTermin(env, p.id, doc);
    }
  });

  o.status = 'bestaetigt';
  o.bezahlt_at = new Date().toISOString();
  o.stripe_session = session.id;
  o.payment_intent = session.payment_intent || '';
  o.pay_status = session.payment_status || 'paid';
  if (ueberbucht.length) o.ueberbucht = ueberbucht;
  await kursPutBestellung(env, p.id, o);
  await kursPut(env, K.session(p.id, session.id), o.id, { expirationTtl: 60 * 60 * 24 * 90 });
  if (o.hold) { try { await env.VOUCHERS.delete(K.hold(o.hold)); } catch (e) { /* egal */ } }

  // Termin wurde während der Zahlung abgesagt: Erstattung gleich vormerken
  if (nachAbsage.length) {
    const offen = await kursGetOffen(env, p.id);
    for (const x of nachAbsage) {
      const e = kursErstattungAnlegen(o, x.datum, x.seat, 'Termin wurde während der Zahlung abgesagt');
      offen.erstattungen.push({ ...e, order: o.id, kurs: kurs.id, name: o.kunde.name });
    }
    await kursPutBestellung(env, p.id, o);
    await kursPutOffen(env, p.id, offen);
  }
  await kursNachKauf(env, p, kurs, o);
}

/** Erstattungsposten für einen Sitz anlegen (in der Bestellung). */
function kursErstattungAnlegen(o, datum, seat, grund) {
  const e = {
    id: randomToken(10), datum,
    cents_gutschein: Number(seat.wert_gutschein_cents || 0),
    cents_bar: Math.max(0, Number(seat.wert_cents || 0) - Number(seat.wert_gutschein_cents || 0)),
    status: 'offen', grund: grund || '', at: new Date().toISOString(),
  };
  o.erstattungen = o.erstattungen || [];
  o.erstattungen.push(e);
  seat.erstattung = e.id;
  return e;
}

async function kursPayStatus(session, type, env) {
  const m = session.metadata || {};
  const p = kursProvider(m.provider);
  if (!p) return;
  const o = await kursGetBestellung(env, p.id, m.order);
  if (!o) return;
  if (type === 'checkout.session.async_payment_succeeded') o.pay_status = 'paid';
  else if (type === 'checkout.session.async_payment_failed') o.pay_status = 'failed';
  else return;
  await kursPutBestellung(env, p.id, o);
  if (o.pay_status === 'failed') {
    const kurs = await kursFind(env, p.id, o.kurs);
    try { await kursMailLastschrift(env, p, kurs, o); } catch (err) { console.error('Lastschrift-Mail', err); }
  }
}

/* ================================================================== */
/* Zurück von der Zahlseite                                             */
/* ================================================================== */

async function kursReleaseHold(env, hold) {
  const raw = await env.VOUCHERS.get(K.hold(hold));
  if (!raw) return { released: 0 };
  const ref = JSON.parse(raw);
  const p = kursProvider(ref.p);
  if (!p) return { released: 0 };
  const o = await kursGetBestellung(env, p.id, ref.o);
  if (!o || o.status !== 'reserviert') { await env.VOUCHERS.delete(K.hold(hold)); return { released: 0 }; }
  if (o.stripe_session) {
    const st = await kursExpire(env, p, o.stripe_session);
    if (st === 'complete') return { released: 0, paid: true };
    if (st !== 'expired') return { released: 0, failed: true };
  }
  const kurs = await kursFind(env, p.id, o.kurs);
  const frei = kurs ? await kursPlaetzeFreigeben(env, p, kurs, o) : [];
  o.status = 'abgebrochen';
  await kursPutBestellung(env, p.id, o);
  await env.VOUCHERS.delete(K.hold(hold));
  return { released: frei.length, kurs, p, frei };
}

async function kursExpire(env, p, sessionId) {
  if (p.stripe && p.stripe.modus === 'connect') {
    const id = encodeURIComponent(sessionId);
    const r = await kursStripe(env, p, 'POST', `checkout/sessions/${id}/expire`, new URLSearchParams());
    if (r.ok) return 'expired';
    const l = await kursStripe(env, p, 'GET', `checkout/sessions/${id}`);
    return l.ok && l.data && l.data.status ? l.data.status : 'unknown';
  }
  return expireCheckout(sessionId, env);
}

async function kursRelease(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const hold = holdId(body.hold);
  if (!hold) return json({ ok: true, released: 0 });
  const r = await kursReleaseHold(env, hold);
  if (r.released && r.kurs && ctx) {
    const s = await kursSettings(env, r.p.id);
    const eff = kursEffektiv(r.kurs, s);
    for (const d of r.frei) ctx.waitUntil(kursNachruecken(env, r.p, r.kurs, eff, s, d).catch((e) => console.error(e)));
  }
  return json({ ok: true, released: r.released || 0, paid: !!r.paid });
}

/* ================================================================== */
/* Warteliste                                                           */
/* ================================================================== */

async function kursWarteliste(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const kurs = await kursFind(env, p.id, clean(body.kurs, 40));
  if (!kurs || !kurs.aktiv) return kursFehler('Diesen Kurs gibt es nicht (mehr).', 404);
  if (!kursProdukt(kurs, 'tageskarte').aktiv) return kursFehler('Für diesen Kurs gibt es keine Warteliste.');
  const person = kursPerson(body);
  if (person.error) return kursFehler(person.error);
  if (body.datenschutz_ok !== true) return kursFehler('Bitte bestätige den Hinweis zur Warteliste.');
  const datum = String(body.datum || '').slice(0, 10);
  const t = kursTerminAm(kurs, datum);
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  if (!t || t.ausfall || !kursBuchbar(t, s.buchungsschluss_min)) return kursFehler('Für diesen Termin geht das nicht mehr.');
  const doc = await kursGetTermin(env, p.id, kurs.id, datum);
  if (kursBelegung(doc, kurs, eff).frei > 0) return kursFehler('Für diesen Termin sind noch Plätze frei – du kannst direkt buchen.', 409);
  let r;
  try { r = await kursWartelisteEintragen(env, p, kurs, datum, person); }
  catch (err) { return kursFehler(err.message, err.status || 500); }
  if (!r.schon) {
    try { await kursMailWarteliste(env, p, kurs, t, r.eintrag); } catch (err) { console.error('Wartelisten-Mail', err); }
  }
  return json({ ok: true, schon: !!r.schon, position: r.position || null });
}

async function kursWartelisteRaus(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  let r;
  try { r = await kursWartelisteAustragen(env, p, clean(body.w, 40)); }
  catch (err) { return kursFehler(err.message, err.status || 500); }
  if (r.error) return kursFehler(r.error, 404);
  if (r.frei && ctx) {
    const kurs = await kursFind(env, p.id, r.kurs);
    const s = await kursSettings(env, p.id);
    if (kurs) ctx.waitUntil(kursNachruecken(env, p, kurs, kursEffektiv(kurs, s), s, r.datum).catch((e) => console.error(e)));
  }
  return json({ ok: true });
}

/* ================================================================== */
/* Bestellung ansehen und Aktionen                                      */
/* ================================================================== */

async function kursBestellungAnsehen(url, env) {
  const p = kursProviderAus(url.searchParams.get('p'));
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  let o;
  const sid = url.searchParams.get('session_id');
  if (sid) {
    const id = await env.VOUCHERS.get(K.session(p.id, sid));
    if (!id) return json({ status: 'pending' }, 202);
    o = await kursGetBestellung(env, p.id, id);
    if (!o) return json({ status: 'pending' }, 202);
  } else {
    o = await kursBestellungMitToken(env, p, url.searchParams.get('o'), url.searchParams.get('t'));
    if (!o) return kursFehler('Diese Buchung habe ich nicht gefunden. Bitte nutz den Link aus deiner Mail.', 404);
  }
  if (o.status !== 'bestaetigt') return json({ status: o.status === 'reserviert' ? 'pending' : o.status }, o.status === 'reserviert' ? 202 : 200);
  if (o.flex) return json(kursKarteBestellSicht(p, o));
  return json(await kursBestellungSicht(env, p, o));
}

async function kursBestellungSicht(env, p, o) {
  const kurs = await kursFind(env, p.id, o.kurs);
  const s = await kursSettings(env, p.id);
  const now = Date.now();
  const zeilen = [];
  const ersatzDaten = new Set();
  for (const d of o.termine) {
    const t = (kurs && kursTerminAm(kurs, d)) || { datum: d, start: '', ende: '' };
    const doc = kurs ? await kursGetTermin(env, p.id, kurs.id, d) : { plaetze: [] };
    const seat = kursSitzDerBestellung(doc, o.id, false) || {};
    const z = {
      datum: d, start: t.start, ende: t.ende, status: seat.status || 'unbekannt',
      vorbei: kursStartMs(t) < now,
      freigeben_moeglich: seat.status === 'gebucht' && kurs ? kursBuchbar(t, s.buchungsschluss_min, now) : false,
      gutschrift: o.art === 'kartebuchung' && seat.status === 'gebucht' && kurs ? kursStartMs(t) - now >= KARTE_ABSAGE_H * 3600e3 : false,
    };
    if (seat.status === 'abgesagt') {
      z.absage = { grund: (doc.absage && doc.absage.grund) || '', modus: (doc.absage && doc.absage.modus) || '' };
      const e = (o.erstattungen || []).find((x) => x.id === seat.erstattung);
      if (e) z.erstattung = { status: e.status, cents: e.cents_bar + e.cents_gutschein };
      if (seat.ersatz) {
        const et = kursTerminAm(kurs, seat.ersatz) || { datum: seat.ersatz, start: '' };
        const edoc = await kursGetTermin(env, p.id, kurs.id, seat.ersatz);
        const es = edoc.plaetze.find((x) => x.order === o.id && x.ersatz_fuer === d);
        z.ersatz = {
          datum: seat.ersatz, start: et.start, ende: et.ende, antwort: es ? es.antwort : 'erstattung',
          aktiv: !!es && es.status === 'gebucht',
          waehlbar: !!es && es.status === 'gebucht' && kursStartMs(et) > now,
        };
        ersatzDaten.add(seat.ersatz);
      }
    }
    zeilen.push(z);
  }
  // Was gerade wirklich gebucht ist (inkl. angenommener Ersatztermine) – für die Kalender-Knöpfe
  const kalender = [];
  for (const z of zeilen) {
    if (z.vorbei) continue;
    if (z.status === 'gebucht') kalender.push({ datum: z.datum, start: z.start, ende: z.ende });
    else if (z.ersatz && z.ersatz.aktiv) kalender.push({ datum: z.ersatz.datum, start: z.ersatz.start, ende: z.ersatz.ende });
  }
  const kk = kurs || { titel: o.kurs_titel, ort: '', adresse: '' };
  return {
    status: 'confirmed',
    o: o.id, t: o.token,
    kalender: kalender.map((x) => ({ ...x, google: kursGoogleLink(p, kk, x) })),
    anbieterin: kursProviderPublic(p),
    kurs: kurs ? { id: kurs.id, titel: kurs.titel, ort: kurs.ort, adresse: kurs.adresse || '' } : { titel: o.kurs_titel },
    art: o.art, label: o.label || KURS_LABEL[o.art],
    name: o.kunde.name,
    preis_cents: o.preis_cents, offen_cents: o.offen_cents,
    gutschein: o.gutschein ? { code: o.gutschein.code, cents: o.gutschein.cents } : null,
    gueltig_bis: o.gueltig_bis,
    karte_code: o.karte_code || '',
    widerruf_ausgeschlossen: !!o.widerruf_ausgeschlossen,
    termine: zeilen,
    regeln: KURS_TEXTE.regeln,
  };
}

async function kursAktion(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p) return kursFehler('Unbekannte Anbieterin.', 404);
  const o = await kursBestellungMitToken(env, p, clean(body.o, 40), clean(body.t, 40));
  if (!o || o.status !== 'bestaetigt') return kursFehler('Diese Buchung habe ich nicht gefunden.', 404);
  const kurs = await kursFind(env, p.id, o.kurs);
  if (!kurs) return kursFehler('Diesen Kurs gibt es nicht mehr.', 404);
  if (o.art === 'kartebuchung' && String(body.aktion || '') === 'freigeben') {
    const a = await kursKarteAbsagenIntern(env, p, kursKarteNorm(o.karte_code), o.id, ctx);
    if (a.fehler) return kursFehler(a.fehler, a.status || 409);
    return json({ ...(await kursBestellungSicht(env, p, o)), einheit_zurueck: a.mitGutschrift });
  }
  const datum = String(body.datum || '').slice(0, 10);
  if (o.termine.indexOf(datum) === -1) return kursFehler('Dieser Termin gehört nicht zu deiner Buchung.');
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  const now = Date.now();
  const aktion = String(body.aktion || '');
  let freiAm = null;
  let neueErstattung = null;
  let fehler = '';

  try {
    await kursMitSperre(env, p.id, kurs.id, async () => {
      const doc = await kursGetTermin(env, p.id, kurs.id, datum);
      const seat = kursSitzDerBestellung(doc, o.id, false);
      if (!seat) { fehler = 'Zu diesem Termin gibt es keinen Platz in deiner Buchung.'; return; }

      if (aktion === 'freigeben') {
        const t = kursTerminAm(kurs, datum);
        if (seat.status !== 'gebucht') { fehler = 'Dieser Platz ist nicht (mehr) gebucht.'; return; }
        if (!t || !kursBuchbar(t, s.buchungsschluss_min, now)) { fehler = 'Der Termin beginnt gleich – freigeben geht jetzt nicht mehr.'; return; }
        seat.status = 'freigegeben';
        seat.freigegeben_at = new Date(now).toISOString();
        await kursPutTermin(env, p.id, doc);
        freiAm = datum;
        return;
      }

      if (seat.status !== 'abgesagt' || !seat.ersatz) { fehler = 'Für diesen Termin gibt es nichts zu entscheiden.'; return; }
      const edoc = await kursGetTermin(env, p.id, kurs.id, seat.ersatz);
      const es = edoc.plaetze.find((x) => x.order === o.id && x.ersatz_fuer === datum && x.status === 'gebucht');
      const et = kursTerminAm(kurs, seat.ersatz);
      if (!es) { fehler = 'Für diesen Termin hast du schon die Erstattung gewählt.'; return; }
      if (!et || kursStartMs(et) <= now) { fehler = 'Der Ersatztermin hat schon stattgefunden.'; return; }

      if (aktion === 'ersatz') {
        es.antwort = 'angenommen';
        es.antwort_at = new Date(now).toISOString();
        await kursPutTermin(env, p.id, edoc);
        return;
      }
      if (aktion === 'erstattung') {
        es.status = 'freigegeben';
        es.antwort = 'erstattung';
        es.antwort_at = new Date(now).toISOString();
        await kursPutTermin(env, p.id, edoc);
        neueErstattung = kursErstattungAnlegen(o, datum, seat, 'Kundin/Kunde wählt Erstattung statt Ersatztermin');
        neueErstattung.status = 'angefordert';
        await kursPutTermin(env, p.id, doc);
        freiAm = seat.ersatz;
        return;
      }
      fehler = 'Unbekannte Aktion.';
    });
  } catch (err) {
    return kursFehler(err.message, err.status || 500);
  }
  if (fehler) return kursFehler(fehler, 409);

  if (neueErstattung) {
    await kursPutBestellung(env, p.id, o);
    const offen = await kursGetOffen(env, p.id);
    offen.erstattungen.push({ ...neueErstattung, order: o.id, kurs: kurs.id, name: o.kunde.name });
    await kursPutOffen(env, p.id, offen);
    try { await kursMailErstattungAngefordert(env, p, kurs, o, neueErstattung); } catch (err) { console.error(err); }
  }
  if (freiAm && ctx) ctx.waitUntil(kursNachruecken(env, p, kurs, eff, s, freiAm).catch((e) => console.error(e)));
  return json(await kursBestellungSicht(env, p, o));
}

/* ================================================================== */
/* Kurse inklusive bei Personal-Training-Karten (4er/8er)               */
/* ================================================================== */

async function kursInklusivStand(env, p, code, s) {
  const v = await loadVoucher(code, env);
  if (v.error && !/aufgebraucht/.test(v.error)) return { error: v.error };
  // Eine aufgebrauchte PT-Karte darf ihre Kurse trotzdem noch nutzen
  let card = v.voucher;
  if (!card) {
    const raw = await env.VOUCHERS.get(`voucher:${String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')}`);
    card = raw ? JSON.parse(raw) : null;
  }
  if (!card || card.kind !== 'karte') return { error: 'Das ist keine 4er- oder 8er-Karte. Euro-Gutscheine löst du beim Kauf einer Kurskarte ein.' };
  const anzahl = Number((s.inklusiv || {})[card.card] || 0);
  if (!anzahl) return { error: `Bei der ${card.label || 'Karte'} sind keine Kurse inklusive.` };
  const raw = await env.VOUCHERS.get(K.inklusiv(p.id, card.code));
  const st = raw ? JSON.parse(raw) : { genutzt: [] };
  const aktiv = st.genutzt.filter((g) => g.status !== 'storniert');
  return { card, anzahl, genutzt: aktiv.length, frei: Math.max(0, anzahl - aktiv.length), stand: st, bis: card.expires };
}

async function kursInklusivCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p || p.id !== 'niklas') return json({ ok: false, error: 'Das geht nur bei Kursen von Niklas.' });
  const s = await kursSettings(env, p.id);
  const r = await kursInklusivStand(env, p, body.code, s);
  if (r.error) return json({ ok: false, error: r.error });
  return json({ ok: true, code: r.card.code, label: r.card.label, anzahl: r.anzahl, frei: r.frei, bis: r.bis, name: r.card.buyer_name || '', email: r.card.buyer_email || '' });
}

async function kursInklusivBuchen(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = kursProviderAus(body.p);
  if (!p || p.id !== 'niklas') return kursFehler('Das geht nur bei Kursen von Niklas.');
  const person = kursPerson(body);
  if (person.error) return kursFehler(person.error);
  const s = await kursSettings(env, p.id);
  const kurs = await kursFind(env, p.id, clean(body.kurs, 40));
  if (!kurs || !kurs.aktiv) return kursFehler('Diesen Kurs gibt es nicht (mehr).', 404);
  const eff = kursEffektiv(kurs, s);
  const datum = String(body.datum || '').slice(0, 10);
  const t = kursTerminAm(kurs, datum);
  if (!t || t.ausfall || !kursBuchbar(t, s.buchungsschluss_min)) return kursFehler('Diesen Termin kann man nicht (mehr) buchen.');

  const st = await kursInklusivStand(env, p, body.code, s);
  if (st.error) return kursFehler(st.error);
  if (st.frei < 1) return kursFehler(`Alle ${st.anzahl} Kurse deiner ${st.card.label} sind schon gebucht.`);
  if (st.bis && datum > st.bis) return kursFehler(`Deine ${st.card.label} gilt bis ${fmtDate(st.bis)}.`);
  if (st.stand.genutzt.some((g) => g.kurs === kurs.id && g.datum === datum && g.status !== 'storniert')) {
    return kursFehler('Für diesen Termin hast du schon einen Platz.');
  }

  const now = new Date().toISOString();
  const o = {
    id: randomToken(16), token: randomToken(24), provider: p.id, art: 'inklusiv', label: `Inklusive · ${st.card.label} ${st.card.code}`,
    kurs: kurs.id, kurs_titel: kurs.titel, termine: [datum], preis_cents: 0, gutschein: null, offen_cents: 0,
    status: 'bestaetigt', kunde: person, created: now, bezahlt_at: now, gueltig_bis: datum,
    pt_karte: st.card.code, widerruf_ausgeschlossen: false, erstattungen: [],
  };
  let res;
  try {
    res = await kursPlaetzeReservieren(env, p, kurs, eff, [t], [{
      order: o.id, quelle: 'inklusiv', status: 'gebucht', bis: 0, name: person.name, email: person.email, phone: person.phone,
      wert_cents: 0, wert_gutschein_cents: 0, pt_karte: st.card.code,
    }], {});
  } catch (err) { return kursFehler(err.message, err.status || 500); }
  if (res.error) return kursFehler(res.voll ? 'Dieser Termin ist leider ausgebucht.' : res.error, 409);

  st.stand.genutzt.push({ bestellung: o.id, kurs: kurs.id, datum, at: now, status: 'gebucht' });
  await kursPut(env, K.inklusiv(p.id, st.card.code), JSON.stringify(st.stand));
  await kursPutBestellung(env, p.id, o);
  await kursNachKauf(env, p, kurs, o);
  return json({ status: 'confirmed', o: o.id, t: o.token, frei: st.frei - 1 });
}

/* ================================================================== */
/* Kalender-Abo                                                         */
/* ================================================================== */

async function kursKalenderAbo(url, env) {
  const p = kursProvider(url.searchParams.get('p'));
  if (!p) return new Response('Not found', { status: 404 });
  const s = await kursSettings(env, p.id);
  const k = String(url.searchParams.get('k') || '');
  if (!s.ics_token || k.length < 16 || k !== s.ics_token) return new Response('Not found', { status: 404 });
  const heute = kursHeute();
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fitness Donner//Kursplan//DE', 'X-WR-CALNAME:Kurse ' + p.name, 'CALSCALE:GREGORIAN'];
  for (const kurs of await kursLoadKurse(env, p.id)) {
    if (!kurs.aktiv) continue;
    const eff = kursEffektiv(kurs, s);
    for (const t of kursTermine(kurs, kursAddDays(heute, -7), kursAddDays(heute, 120))) {
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      const b = kursBelegung(doc, kurs, eff);
      lines.push('BEGIN:VEVENT', `UID:kurs-${kurs.id}-${t.datum}@fitnessdonner.de`, `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(berlinToUtc(t.datum, t.start))}`, `DTEND:${stamp(berlinToUtc(t.datum, t.ende))}`,
        `SUMMARY:${(t.ausfall ? 'ABGESAGT: ' : '') + kurs.titel} (${b.gebucht + b.reserviert}${b.usc ? '+' + b.usc + ' USC' : ''}/${b.kap})`,
        `LOCATION:${String(kurs.ort || '').replace(/[,;]/g, ' ')}`, 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=900' } });
}


/* ================================================================== */
/* Kalenderdatei einer Buchung (Knopf auf der Bestätigungsseite)        */
/* ================================================================== */

async function kursBestellungIcs(url, env) {
  const p = kursProviderAus(url.searchParams.get('p'));
  if (!p) return new Response('Not found', { status: 404 });
  const o = await kursBestellungMitToken(env, p, url.searchParams.get('o'), url.searchParams.get('t'));
  if (!o || o.status !== 'bestaetigt') return new Response('Not found', { status: 404 });
  const kurs = await kursFind(env, p.id, o.kurs);
  if (!kurs) return new Response('Not found', { status: 404 });
  const sicht = await kursBestellungSicht(env, p, o);
  const text = kursIcsText(p, kurs, sicht.kalender, o.id);
  return new Response(text, { headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${kurs.titel.replace(/[^A-Za-z0-9]+/g, '-')}-Termine.ics"`,
    'Cache-Control': 'no-store',
  } });
}

/* ================================================================== */
/* Kursmodul: admin.js                                             */
/* ================================================================== */

/**
 * Kursmodul – Verwaltung. Läuft hinter dem bestehenden Admin-Login (/api/admin/kurse/…).
 *
 * Rollenmodell (vorbereitet): Jede Anfrage bekommt einen Kontext { rolle, anbieter }.
 * Heute gibt es nur das Inhaber-Passwort → Rolle 'inhaber', sieht alle Anbieterinnen.
 * Später: eigener Login je Trainerin → Rolle 'trainerin', anbieter = [ihre id]. Jede Funktion
 * hier prüft schon heute über kursDarf(), ob die Anbieterin zum Kontext gehört.
 */

/** Wer fragt? Heute immer der Inhaber (das bestehende Admin-Passwort). */
function kursAdminKontext(request, env) {
  return { rolle: 'inhaber', anbieter: Object.keys(KURS_PROVIDERS) };
}

function kursDarf(ctx, pid) {
  return ctx.anbieter.indexOf(pid) !== -1;
}

function kursErr(text, status, extra) {
  return json({ error: text, ...(extra || {}) }, status || 400);
}

async function kursAdmin(path, url, request, env, body) {
  const ctx = kursAdminKontext(request, env);
  const pid = String((request.method === 'GET' ? url.searchParams.get('p') : body.p) || 'niklas').toLowerCase();
  const p = kursProvider(pid);
  if (!p) return kursErr('Unbekannte Anbieterin.', 404);
  if (!kursDarf(ctx, p.id)) return kursErr('Kein Zugriff auf diese Anbieterin.', 403);
  try {
    switch (path) {
      case 'state':              return await kursAdminState(env, ctx, p);
      case 'kurs':               return await kursAdminKurs(env, p, body);
      case 'einstellungen':      return await kursAdminEinstellungen(env, p, body);
      case 'usc':                return await kursAdminUsc(env, p, body);
      case 'absage':             return await kursAdminAbsage(env, p, body);
      case 'erstattung':         return await kursAdminErstattung(env, p, body);
      case 'teilnehmer':         return await kursAdminTeilnehmer(env, p, body);
      case 'teilnehmer-entfernen': return await kursAdminEntfernen(env, p, body);
      case 'warteliste-entfernen': return await kursAdminWarteRaus(env, p, body);
      case 'bestellungen':       return await kursAdminBestellungen(env, p, url);
      case 'karten':             return await kursAdminKarten(env, p);
      case 'karte-aktion':       return await kursAdminKarteAktion(env, p, body);
      default:                   return kursErr('Unbekannte Aktion.', 404);
    }
  } catch (err) {
    if (err && err.status) return kursErr(err.message, err.status);
    throw err;
  }
}

/* ---------------- Übersicht ---------------- */

async function kursAdminState(env, ctx, p) {
  const s = await kursSettings(env, p.id);
  const kurse = await kursLoadKurse(env, p.id);
  const now = Date.now();
  const heute = kursHeute(now);
  const bis = kursAddDays(heute, 7 * 8);
  const termine = [];
  const usc = [];
  for (const kurs of kurse) {
    const eff = kursEffektiv(kurs, s);
    for (const t of kursTermine(kurs, kursAddDays(heute, -1), bis)) {
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      const b = kursBelegung(doc, kurs, eff, now);
      const ab = kursFreischaltMs(t, eff.freischalt_tage);
      const vorbei = kursStartMs(t) < now;
      const x = {
        kurs: kurs.id, titel: kurs.titel, datum: t.datum, start: t.start, ende: t.ende, extra: t.extra,
        aktiv: !!kurs.aktiv, vorbei, abgesagt: !!(t.ausfall || doc.absage),
        absage: doc.absage || null,
        belegung: b, min_teilnehmer: kurs.min_teilnehmer || null,
        tageskarte_ab: new Date(ab).toISOString(), tageskarte_offen: now >= ab,
        usc_gemeinsam: eff.usc_gemeinsam,
        plaetze: (doc.plaetze || []).filter((z) => z.status !== 'abgebrochen' && (z.status !== 'reserviert' || (z.bis || 0) > now)).map((z) => ({
          id: z.id, order: z.order, quelle: z.quelle, quelle_label: KURS_LABEL[z.quelle] || z.quelle, status: z.status,
          name: z.name, email: z.email, phone: z.phone || '', antwort: z.antwort || '', ersatz: z.ersatz || '', ersatz_fuer: z.ersatz_fuer || '',
          bis: z.status === 'reserviert' ? new Date(z.bis).toISOString() : '', angebot: !!z.angebot, notiz: z.notiz || '',
        })),
        warteliste: (doc.warteliste || []).filter((w) => w.status === 'wartet' || w.status === 'angeboten')
          .map((w) => ({ id: w.id, name: w.name, email: w.email, phone: w.phone, status: w.status, angebot_bis: w.angebot_bis ? new Date(w.angebot_bis).toISOString() : '' })),
      };
      termine.push(x);
      if (s.usc_aktiv && kurs.aktiv && !x.abgesagt && !vorbei && x.tageskarte_offen) {
        const freiFuerUsc = eff.usc_gemeinsam ? b.frei + b.usc : Math.max(0, b.kap - b.gebucht - b.reserviert);
        usc.push({ kurs: kurs.id, titel: kurs.titel, datum: t.datum, start: t.start, gemeldet: b.usc, frei: b.frei, max: freiFuerUsc, gemeinsam: eff.usc_gemeinsam });
      }
    }
  }
  termine.sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));
  const offen = await kursGetOffen(env, p.id);
  return json({
    kontext: { rolle: ctx.rolle },
    anbieterinnen: ctx.anbieter.map((id) => ({ id, name: KURS_PROVIDERS[id].name, aktiv: KURS_PROVIDERS[id].aktiv, zahlung_bereit: kursZahlungBereit(KURS_PROVIDERS[id]) })),
    p: p.id,
    einstellungen: s,
    standard: KURS_DEFAULTS,
    kurse,
    termine,
    usc,
    erstattungen: offen.erstattungen.filter((e) => e.status !== 'erledigt'),
    erledigt: offen.erstattungen.filter((e) => e.status === 'erledigt').slice(-20),
    blockiert_pt: p.id === KURS_PT_PROVIDER,
  });
}

/* ---------------- Kurs anlegen / ändern ---------------- */

const KURS_ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const KURS_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function kursBool(v, def) {
  return typeof v === 'boolean' ? v : def;
}

function kursZahlOderNull(v, min, max) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

/** Bestehende Personal-Training-Buchungen, die mit Kurszeiten kollidieren. */
async function kursPtKonflikte(env, kurs, von, bis) {
  if (!kurs.aktiv || kurs.blockiert_pt === false || kurs.provider !== KURS_PT_PROVIDER) return [];
  const list = await env.VOUCHERS.list({ prefix: 'booking:' });
  const out = [];
  const termine = kursTermine(kurs, von, bis);
  const proTag = new Map(termine.map((t) => [t.datum, t]));
  for (const k of list.keys) {
    const m = /^booking:(\d{4}-\d{2}-\d{2}):[a-z]+-(\d{4})-(\d+)$/.exec(k.name);
    if (!m || !proTag.has(m[1])) continue;
    const t = proTag.get(m[1]);
    if (t.ausfall && t.ausfall.pt_frei) continue;
    const f = Number(m[2].slice(0, 2)) * 60 + Number(m[2].slice(2));
    const e = f + Number(m[3]);
    const kf = toMinutes(t.start) - Number(kurs.puffer_min || 0);
    const ke = toMinutes(t.start) + t.minuten + Number(kurs.puffer_min || 0);
    if (f < ke && kf < e) {
      const raw = await env.VOUCHERS.get(k.name);
      const b = raw ? JSON.parse(raw) : {};
      out.push({ datum: m[1], start: b.start || m[2].slice(0, 2) + ':' + m[2].slice(2), name: b.name || '', status: b.status || '' });
    }
  }
  return out;
}

async function kursAdminKurs(env, p, body) {
  const k = body.kurs || {};
  const kurse = await kursLoadKurse(env, p.id);
  const alt = k.id ? kurse.find((x) => x.id === k.id) : null;
  if (k.id && !alt) return kursErr('Diesen Kurs gibt es nicht.', 404);

  const titel = clean(k.titel, 80);
  if (!titel) return kursErr('Bitte einen Kursnamen angeben.');
  const wochentag = Number(k.wochentag);
  if (!(wochentag >= 0 && wochentag <= 6)) return kursErr('Bitte einen Wochentag wählen.');
  const start = String(k.start || '');
  if (!KURS_ZEIT.test(start)) return kursErr('Bitte die Uhrzeit als HH:MM angeben.');
  const minuten = kursZahlOderNull(k.minuten, 15, 240);
  if (!minuten) return kursErr('Dauer: 15 bis 240 Minuten.');
  if (toMinutes(start) + minuten > 24 * 60) return kursErr('Der Kurs darf nicht über Mitternacht gehen.');
  const kap = kursZahlOderNull(k.kapazitaet, 1, 100);
  if (!kap) return kursErr('Kapazität: 1 bis 100 Plätze.');
  const startDatum = String(k.start_datum || '');
  if (!KURS_DATUM.test(startDatum)) return kursErr('Bitte ein Startdatum angeben.');
  const endDatum = k.end_datum ? String(k.end_datum) : '';
  if (endDatum && (!KURS_DATUM.test(endDatum) || endDatum < startDatum)) return kursErr('Das Enddatum liegt vor dem Start.');
  const minTn = kursZahlOderNull(k.min_teilnehmer, 1, 100);
  const freischalt = kursZahlOderNull(k.freischalt_tage, 0, 60);
  if (freischalt === undefined) return kursErr('Freischaltung: 0 bis 60 Tage vorher.');
  const puffer = kursZahlOderNull(k.puffer_min, 0, 120);

  const preise = {};
  for (const f of ['tageskarte_cents', 'karte5_cents', 'karte10_cents']) {
    const v = kursZahlOderNull((k.preise || {})[f], 0, 100000);
    if (v === undefined) return kursErr('Ein Preis ist ungültig.');
    if (v !== null) preise[f] = v;
  }
  const produkte = {};
  for (const art of ['karte5', 'karte10', 'tageskarte']) {
    const pr = (k.produkte || {})[art] || {};
    const a = ((alt && alt.produkte) || {})[art] || {};
    produkte[art] = { aktiv: kursBool(pr.aktiv, a.aktiv !== false), widerruf_ausgeschlossen: kursBool(pr.widerruf_ausgeschlossen, a.widerruf_ausgeschlossen !== false) };
  }

  const neu = {
    ...(alt || {}),
    id: alt ? alt.id : 'k' + randomToken(7),
    provider: p.id,
    titel,
    beschreibung: clean(k.beschreibung, 400),
    kategorie: clean(k.kategorie, 40),
    // Bild: Dateiname auf der Website (z. B. newforge-kursraum.webp) oder https-Adresse; leer = Platzhalter
    bild: /^(https:\/\/[^\s"'<>]+|[A-Za-z0-9._\/-]+\.(webp|jpe?g|png|avif))$/.test(String(k.bild || '').trim()) ? String(k.bild).trim().slice(0, 300) : '',
    farbe: /^#[0-9a-fA-F]{6}$/.test(String(k.farbe || '')) ? String(k.farbe) : '',
    ort: clean(k.ort, 80) || 'New Forge Solingen',
    adresse: clean(k.adresse, 120) || 'Prinzenstraße 2a, 42697 Solingen',
    wochentag, start, minuten, kapazitaet: kap,
    min_teilnehmer: minTn || null,      // nur Feld – Logik folgt später
    start_datum: startDatum, end_datum: endDatum,
    freischalt_tage: freischalt,        // null = Standard der Anbieterin
    usc_gemeinsam: typeof k.usc_gemeinsam === 'boolean' ? k.usc_gemeinsam : null,
    puffer_min: puffer || 0,
    blockiert_pt: k.blockiert_pt !== false,
    preise, produkte,
    aktiv: !!k.aktiv,
    sichtbar: k.sichtbar !== false,
    ausfall: (alt && alt.ausfall) || [],
    extra: (alt && alt.extra) || [],
    created: (alt && alt.created) || new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  const heute = kursHeute();
  // Zeitänderung bei schon gebuchten Plätzen nur mit ausdrücklicher Bestätigung
  if (alt && (alt.wochentag !== neu.wochentag || alt.start !== neu.start || alt.minuten !== neu.minuten || alt.start_datum !== neu.start_datum) && !body.force) {
    const betroffen = [];
    for (const t of kursTermine(alt, heute, kursAddDays(heute, 7 * 40))) {
      const doc = await kursGetTermin(env, p.id, alt.id, t.datum);
      const n = (doc.plaetze || []).filter((z) => KURS_ZAEHLT(z, Date.now())).length;
      if (n) betroffen.push({ datum: t.datum, plaetze: n });
    }
    if (betroffen.length) {
      return kursErr('Für diesen Kurs gibt es schon Buchungen. Wenn du Tag oder Uhrzeit änderst, gelten die gebuchten Plätze nicht automatisch für die neue Zeit. Termine einzeln absagen ist meist besser.', 409, { betroffen, force_moeglich: true });
    }
  }
  const konflikte = await kursPtKonflikte(env, neu, heute, kursAddDays(heute, 7 * 26));
  if (konflikte.length && !body.force) {
    return kursErr('Zu diesen Kurszeiten gibt es schon Personal-Training-Termine. Bitte erst verschieben oder bewusst bestätigen.', 409, { konflikte, force_moeglich: true });
  }

  const liste = alt ? kurse.map((x) => (x.id === alt.id ? neu : x)) : kurse.concat([neu]);
  await kursSaveKurse(env, p.id, liste);
  return json({ ok: true, kurs: neu, konflikte });
}

/* ---------------- Einstellungen der Anbieterin ---------------- */

async function kursAdminEinstellungen(env, p, body) {
  const cur = await kursSettings(env, p.id);
  const e = body.einstellungen || {};
  const n = (v, min, max, def) => {
    if (v === undefined || v === null || v === '') return def;
    const x = Math.round(Number(v));
    if (!Number.isFinite(x) || x < min || x > max) throw Object.assign(new Error('Ein Wert liegt außerhalb des erlaubten Bereichs.'), { status: 400 });
    return x;
  };
  const next = {
    tageskarte_cents: n(e.tageskarte_cents, 0, 100000, cur.tageskarte_cents),
    karten: {
      karte5: { cents: n((e.karten || {}).karte5 && e.karten.karte5.cents, 0, 1000000, cur.karten.karte5.cents) },
      karte10: { cents: n((e.karten || {}).karte10 && e.karten.karte10.cents, 0, 1000000, cur.karten.karte10.cents) },
    },
    freischalt_tage: n(e.freischalt_tage, 0, 60, cur.freischalt_tage),
    usc_aktiv: kursBool(e.usc_aktiv, cur.usc_aktiv),
    usc_gemeinsam: kursBool(e.usc_gemeinsam, cur.usc_gemeinsam),
    usc_mail: kursBool(e.usc_mail, cur.usc_mail),
    warteliste_stunden: n(e.warteliste_stunden, 1, 72, cur.warteliste_stunden),
    buchungsschluss_min: n(e.buchungsschluss_min, 0, 1440, cur.buchungsschluss_min),
    serie_vorlauf_wochen: n(e.serie_vorlauf_wochen, 1, 26, cur.serie_vorlauf_wochen),
    gueltig_monate: n(e.gueltig_monate, 1, 36, cur.gueltig_monate),
    inklusiv: {
      karte4: n((e.inklusiv || {}).karte4, 0, 50, cur.inklusiv.karte4),
      karte8: n((e.inklusiv || {}).karte8, 0, 50, cur.inklusiv.karte8),
    },
    ics_token: e.ics_neu ? randomToken(24) : (e.ics_aus ? '' : cur.ics_token),
  };
  await kursPut(env, K.einstellungen(p.id), JSON.stringify(next));
  return json({ ok: true, einstellungen: await kursSettings(env, p.id) });
}

/* ---------------- Urban Sports Club ---------------- */

async function kursAdminUsc(env, p, body) {
  const kurs = await kursFind(env, p.id, body.kurs);
  if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
  const datum = String(body.datum || '');
  const t = kursTerminAm(kurs, datum);
  if (!t) return kursErr('An diesem Tag findet der Kurs nicht statt.');
  const plaetze = Math.round(Number(body.plaetze));
  if (!Number.isFinite(plaetze) || plaetze < 0 || plaetze > 100) return kursErr('Bitte eine Zahl ab 0 eintragen.');
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  let weniger = false;
  let fehler = '';
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    const b = kursBelegung(doc, kurs, eff);
    const vorher = b.usc;
    if (eff.usc_gemeinsam && plaetze > vorher + b.frei) {
      fehler = `Es sind nur ${vorher + b.frei} Plätze für Urban Sports möglich – der Rest ist schon gebucht.`;
      return;
    }
    doc.usc = doc.usc || { plaetze: 0, verlauf: [] };
    doc.usc.plaetze = plaetze;
    doc.usc.verlauf = (doc.usc.verlauf || []).concat([{ at: new Date().toISOString(), plaetze }]).slice(-20);
    weniger = plaetze < vorher;
    await kursPutTermin(env, p.id, doc);
  });
  if (fehler) return kursErr(fehler, 409);
  if (weniger) await kursNachruecken(env, p, kurs, eff, s, datum);
  return json({ ok: true });
}

/* ---------------- Absage durch die Trainerin ---------------- */

async function kursAdminAbsage(env, p, body) {
  const kurs = await kursFind(env, p.id, body.kurs);
  if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
  const datum = String(body.datum || '');
  const t = kursTerminAm(kurs, datum);
  if (!t) return kursErr('An diesem Tag findet der Kurs nicht statt.');
  if (t.ausfall) return kursErr('Dieser Termin ist schon abgesagt.', 409);
  const modus = body.modus === 'ersatz' ? 'ersatz' : 'erstattung';
  const grund = clean(body.grund, 200);
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  const now = Date.now();
  const heute = kursHeute(now);

  // Ersatztermin bestimmen: ein regulaerer Termin desselben Kurses oder ein Sondertermin
  let ersatz = null;
  let sonder = null;
  if (modus === 'ersatz') {
    const ed = String((body.ersatz || {}).datum || '');
    if (!KURS_DATUM.test(ed) || ed === datum) return kursErr('Bitte einen anderen Tag als Ersatz wählen.');
    const regulaer = kursTerminAm(kurs, ed);
    const es = (body.ersatz || {}).start ? String(body.ersatz.start) : '';
    if (regulaer && (!es || es === regulaer.start)) {
      if (regulaer.ausfall) return kursErr('Der gewählte Ersatztermin ist selbst abgesagt.');
      ersatz = regulaer;
    } else {
      if (regulaer) return kursErr('An diesem Tag findet der Kurs schon regulaer statt – nimm den regulaeren Termin oder einen anderen Tag.');
      if (!KURS_ZEIT.test(es)) return kursErr('Für einen Sondertermin bitte die Uhrzeit angeben.');
      const min = kursZahlOderNull((body.ersatz || {}).minuten, 15, 240) || kurs.minuten;
      sonder = { datum: ed, start: es, minuten: min, grund: `Ersatz für ${datum}` };
      ersatz = { kurs: kurs.id, datum: ed, start: es, minuten: min, ende: kursEnde(es, min), extra: true };
    }
    if (kursStartMs(ersatz) < now) return kursErr('Der Ersatztermin liegt in der Vergangenheit.');
    if (sonder) {
      const probe = { ...kurs, extra: (kurs.extra || []).concat([sonder]) };
      const konf = await kursPtKonflikte(env, { ...probe, provider: p.id }, ed, ed);
      if (konf.length && !body.force) return kursErr('Zum Sondertermin gibt es schon Personal-Training-Termine.', 409, { konflikte: konf, force_moeglich: true });
    }
  }

  const betroffen = [];   // { seat, orderId }
  const abgebrochen = [];
  let fehler = '';
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    for (const z of doc.plaetze) {
      if (z.status === 'gebucht') betroffen.push(z);
      else if (z.status === 'reserviert' && (z.bis || 0) > now && z.order) abgebrochen.push(z.order);
    }
    let edoc = null;
    if (ersatz) {
      edoc = await kursGetTermin(env, p.id, kurs.id, ersatz.datum);
      if (edoc.absage) { fehler = 'Der Ersatztermin ist selbst abgesagt.'; return; }
      const frei = sonder ? kurs.kapazitaet : kursBelegung(edoc, kurs, eff, now).frei;
      if (betroffen.length > frei) { fehler = `Am Ersatztermin sind nur ${frei} Plätze frei, betroffen sind ${betroffen.length}. Wähl einen anderen Tag oder lege einen Sondertermin an.`; return; }
      // Karten: Ersatz muss im Gültigkeitsrahmen liegen
      for (const z of betroffen) {
        const o = await kursGetBestellung(env, p.id, z.order);
        if (o && o.art !== 'tageskarte' && o.gueltig_bis && ersatz.datum > o.gueltig_bis) {
          fehler = `Die Karte von ${o.kunde.name} gilt nur bis ${fmtDate(o.gueltig_bis)} – der Ersatz muss davor liegen.`;
          return;
        }
      }
    }
    // Ab hier wird geschrieben
    for (const z of doc.plaetze) {
      if (z.status === 'reserviert') z.status = 'abgebrochen';
    }
    for (const w of doc.warteliste || []) if (w.status === 'wartet' || w.status === 'angeboten') w.status = 'termin_abgesagt';
    for (const z of betroffen) {
      z.status = 'abgesagt';
      if (ersatz) {
        z.ersatz = ersatz.datum;
        edoc.plaetze.push(kursNeuerSitz({
          order: z.order, quelle: 'ersatz', status: 'gebucht', bis: 0, ersatz_fuer: datum, antwort: 'offen',
          name: z.name, email: z.email, phone: z.phone, wert_cents: z.wert_cents, wert_gutschein_cents: z.wert_gutschein_cents,
        }));
      }
    }
    doc.absage = {
      at: new Date(now).toISOString(), grund, modus, pt_frei: !!body.pt_frei,
      ersatz: ersatz ? { datum: ersatz.datum, start: ersatz.start, ende: ersatz.ende, sonder: !!sonder } : null,
    };
    await kursPutTermin(env, p.id, doc);
    if (edoc) await kursPutTermin(env, p.id, edoc);
    const kurse = await kursLoadKurse(env, p.id);
    const kk = kurse.find((x) => x.id === kurs.id);
    kk.ausfall = (kk.ausfall || []).filter((a) => a.datum !== datum).concat([{ datum, pt_frei: !!body.pt_frei, grund, at: doc.absage.at }]);
    if (sonder) kk.extra = (kk.extra || []).concat([sonder]);
    await kursSaveKurse(env, p.id, kurse);
  });
  if (fehler) return kursErr(fehler, 409);

  // Offene Zahlseiten zu diesem Termin schließen (best effort)
  for (const oid of abgebrochen) {
    const o = await kursGetBestellung(env, p.id, oid);
    if (o && o.stripe_session && o.status === 'reserviert') {
      try { await kursStripe(env, p, 'POST', `checkout/sessions/${encodeURIComponent(o.stripe_session)}/expire`, new URLSearchParams()); } catch (e) { /* egal */ }
    }
  }

  // Bestellungen fortschreiben, Erstattungen vormerken, Mails
  const proOrder = new Map();
  for (const z of betroffen) {
    if (!proOrder.has(z.order)) proOrder.set(z.order, []);
    proOrder.get(z.order).push(z);
  }
  const offen = await kursGetOffen(env, p.id);
  let mails = 0;
  for (const [oid, sitze] of proOrder) {
    const o = await kursGetBestellung(env, p.id, oid);
    if (!o) continue;
    for (const z of sitze) {
      if (modus === 'erstattung' && (z.wert_cents || 0) > 0) {
        const e = kursErstattungAnlegen(o, datum, z, grund || 'Termin abgesagt');
        offen.erstattungen.push({ ...e, order: o.id, kurs: kurs.id, name: o.kunde.name });
      }
    }
    o.absagen = (o.absagen || []).concat([{ datum, modus, ersatz: ersatz ? ersatz.datum : '', at: new Date(now).toISOString() }]);
    await kursPutBestellung(env, p.id, o);
    if (body.benachrichtigen !== false) {
      try { await kursMailAbsage(env, p, await kursFind(env, p.id, kurs.id), o, datum, { modus, grund }, ersatz); mails++; }
      catch (err) { console.error('Absage-Mail', err); }
    }
  }
  // Erstattungs-Sitze in den Terminen vermerken (seat.erstattung wurde in kursErstattungAnlegen gesetzt)
  if (modus === 'erstattung' && betroffen.length) {
    await kursMitSperre(env, p.id, kurs.id, async () => {
      const doc = await kursGetTermin(env, p.id, kurs.id, datum);
      for (const z of doc.plaetze) {
        const b = betroffen.find((x) => x.id === z.id);
        if (b && b.erstattung) z.erstattung = b.erstattung;
      }
      await kursPutTermin(env, p.id, doc);
    });
  }
  await kursPutOffen(env, p.id, offen);
  return json({ ok: true, betroffen: betroffen.length, mails, ersatz: ersatz ? ersatz.datum : '', modus });
}

/* ---------------- Erstattungen ---------------- */

async function kursAdminErstattung(env, p, body) {
  const offen = await kursGetOffen(env, p.id);
  const e = offen.erstattungen.find((x) => x.id === body.id);
  if (!e) return kursErr('Diese Erstattung gibt es nicht.', 404);
  if (e.status === 'erledigt') return kursErr('Schon erledigt.', 409);
  const o = await kursGetBestellung(env, p.id, e.order);
  if (!o) return kursErr('Die Bestellung fehlt.', 404);
  const oe = (o.erstattungen || []).find((x) => x.id === e.id) || e;
  if (body.aktion === 'ausfuehren' && e.cents_bar > 0) {
    const r = await kursStripeErstatten(env, p, o, e.cents_bar, e.grund);
    if (!r.ok) return kursErr(r.error, 502);
    oe.stripe_refund = r.id;
    e.stripe_refund = r.id;
  } else if (body.aktion !== 'erledigt' && body.aktion !== 'ausfuehren') {
    return kursErr('Unbekannte Aktion.');
  }
  if (e.cents_gutschein) await kursGutscheinZurueck(env, o, e.cents_gutschein, e.datum);
  const at = new Date().toISOString();
  oe.status = 'erledigt'; oe.erledigt_at = at; oe.wie = body.aktion;
  e.status = 'erledigt'; e.erledigt_at = at; e.wie = body.aktion;
  await kursPutBestellung(env, p.id, o);
  await kursPutOffen(env, p.id, offen);
  const kurs = await kursFind(env, p.id, o.kurs);
  try { if (kurs) await kursMailErstattet(env, p, kurs, o, oe); } catch (err) { console.error('Erstattungs-Mail', err); }
  return json({ ok: true, stripe_refund: e.stripe_refund || '' });
}

/* ---------------- Teilnehmende von Hand ---------------- */

async function kursAdminTeilnehmer(env, p, body) {
  const kurs = await kursFind(env, p.id, body.kurs);
  if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
  const datum = String(body.datum || '');
  const t = kursTerminAm(kurs, datum);
  if (!t || t.ausfall) return kursErr('An diesem Tag findet der Kurs nicht statt.');
  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase();
  if (!name) return kursErr('Bitte einen Namen angeben.');
  if (email && !isEmail(email)) return kursErr('Die E-Mail-Adresse stimmt nicht.');
  const s = await kursSettings(env, p.id);
  const eff = kursEffektiv(kurs, s);
  const now = new Date().toISOString();
  const o = {
    id: randomToken(16), token: randomToken(24), provider: p.id, art: 'manuell', label: 'Manuell eingetragen',
    kurs: kurs.id, kurs_titel: kurs.titel, termine: [datum], preis_cents: 0, gutschein: null, offen_cents: 0,
    status: 'bestaetigt', kunde: { name, email, phone: clean(body.phone, 40) }, created: now, bezahlt_at: now,
    gueltig_bis: datum, widerruf_ausgeschlossen: true, notiz: clean(body.notiz, 200), erstattungen: [],
  };
  let fehler = '';
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    if (kursBelegung(doc, kurs, eff).frei < 1 && !body.ueber_kapazitaet) { fehler = 'Der Termin ist voll. Mit „trotzdem eintragen“ geht es über die Kapazität.'; return; }
    doc.plaetze.push(kursNeuerSitz({ order: o.id, quelle: 'manuell', status: 'gebucht', bis: 0, name, email, phone: o.kunde.phone, wert_cents: 0, wert_gutschein_cents: 0, notiz: o.notiz }));
    await kursPutTermin(env, p.id, doc);
  });
  if (fehler) return kursErr(fehler, 409);
  await kursPutBestellung(env, p.id, o);
  if (email) await kursKundeMerken(env, p.id, o.kunde, o.id);
  if (email && body.mail) { try { await kursMailBestaetigung(env, p, kurs, o); } catch (err) { console.error(err); } }
  return json({ ok: true, order: o.id });
}

async function kursAdminEntfernen(env, p, body) {
  const kurs = await kursFind(env, p.id, body.kurs);
  if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
  const datum = String(body.datum || '');
  let gefunden = null;
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    const z = doc.plaetze.find((x) => x.id === body.sitz && (x.status === 'gebucht' || x.status === 'reserviert'));
    if (!z) return;
    z.status = 'freigegeben';
    z.entfernt_durch = 'verwaltung';
    gefunden = z;
    await kursPutTermin(env, p.id, doc);
  });
  if (!gefunden) return kursErr('Diesen Platz gibt es nicht (mehr).', 404);
  if (body.mit_erstattung && gefunden.order && (gefunden.wert_cents || 0) > 0) {
    const o = await kursGetBestellung(env, p.id, gefunden.order);
    if (o) {
      const e = kursErstattungAnlegen(o, datum, gefunden, clean(body.grund, 200) || 'Von der Verwaltung entfernt');
      await kursPutBestellung(env, p.id, o);
      const offen = await kursGetOffen(env, p.id);
      offen.erstattungen.push({ ...e, order: o.id, kurs: kurs.id, name: o.kunde.name });
      await kursPutOffen(env, p.id, offen);
    }
  }
  const s = await kursSettings(env, p.id);
  await kursNachruecken(env, p, kurs, kursEffektiv(kurs, s), s, datum);
  return json({ ok: true });
}

async function kursAdminWarteRaus(env, p, body) {
  const kurs = await kursFind(env, p.id, body.kurs);
  if (!kurs) return kursErr('Diesen Kurs gibt es nicht.', 404);
  const datum = String(body.datum || '');
  let ok = false;
  let frei = false;
  await kursMitSperre(env, p.id, kurs.id, async () => {
    const doc = await kursGetTermin(env, p.id, kurs.id, datum);
    const w = (doc.warteliste || []).find((x) => x.id === body.id);
    if (!w) return;
    if (w.status === 'angeboten') {
      const z = doc.plaetze.find((x) => x.angebot === w.token && x.status === 'reserviert' && !x.order);
      if (z) { z.status = 'abgebrochen'; frei = true; }
    }
    w.status = 'entfernt';
    ok = true;
    await kursPutTermin(env, p.id, doc);
  });
  if (!ok) return kursErr('Diesen Eintrag gibt es nicht.', 404);
  if (frei) {
    const s = await kursSettings(env, p.id);
    await kursNachruecken(env, p, kurs, kursEffektiv(kurs, s), s, datum);
  }
  return json({ ok: true });
}

/* ---------------- Bestellungen ---------------- */

async function kursAdminBestellungen(env, p, url) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const list = await env.VOUCHERS.list({ prefix: K.bestellungPrefix(p.id) });
  const out = [];
  for (const k of list.keys) {
    const raw = await env.VOUCHERS.get(k.name);
    if (!raw) continue;
    const o = JSON.parse(raw);
    if (o.status === 'abgebrochen' || o.status === 'reserviert') continue;
    const hay = `${o.kunde.name} ${o.kunde.email} ${o.kurs_titel} ${o.gutschein ? o.gutschein.code : ''} ${o.pt_karte || ''}`.toLowerCase();
    if (q && hay.indexOf(q) === -1) continue;
    out.push({
      id: o.id, art: o.art, label: o.label || KURS_LABEL[o.art], kurs: o.kurs_titel, name: o.kunde.name, email: o.kunde.email,
      phone: o.kunde.phone || '', termine: o.termine, preis: fmtEur(o.preis_cents), bezahlt: fmtEur(o.offen_cents),
      gutschein: o.gutschein ? `${o.gutschein.code} · ${fmtEur(o.gutschein.cents)}` : '', pay_status: o.pay_status || '',
      created: o.created, gueltig_bis: o.gueltig_bis, ueberbucht: o.ueberbucht || [], gutschein_problem: o.gutschein_problem || '',
      erstattungen: (o.erstattungen || []).length,
    });
  }
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return json({ bestellungen: out.slice(0, 100), total: out.length });
}

/* ================================================================== */
/* Kursmodul: cron.js                                              */
/* ================================================================== */

/**
 * Kursmodul – Zeitgesteuertes.
 *
 * Läuft mit dem bestehenden täglichen Cron. Optional zusätzlich stündlich (KURS_CRON), dann
 * werden Wartelisten-Angebote pünktlich weitergereicht. Ohne stündlichen Cron passiert das
 * trotzdem – nur gröber: beim nächsten Freiwerden eines Platzes bzw. einmal am Tag.
 */

async function kursCron(env, opts) {
  const o = opts || {};
  for (const p of Object.values(KURS_PROVIDERS)) {
    if (!p.aktiv) continue;
    try {
      await kursCronAnbieterin(env, p, o);
    } catch (err) {
      console.error('Kurs-Cron', p.id, err);
    }
  }
}

async function kursCronAnbieterin(env, p, opts) {
  const kurse = (await kursLoadKurse(env, p.id)).filter((k) => k.aktiv);
  if (!kurse.length) return;
  const s = await kursSettings(env, p.id);
  const now = Date.now();
  const heute = kursHeute(now);
  const uscListe = [];

  for (const kurs of kurse) {
    const eff = kursEffektiv(kurs, s);
    const bis = kursAddDays(heute, Number(eff.freischalt_tage) + 1);
    for (const t of kursTermine(kurs, heute, bis)) {
      if (t.ausfall) continue;
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      const offen = now >= kursFreischaltMs(t, eff.freischalt_tage) && kursBuchbar(t, s.buchungsschluss_min, now);
      // Warteliste: abgelaufene Angebote weiterreichen, freie Plätze anbieten
      if ((doc.warteliste || []).some((w) => w.status === 'wartet' || w.status === 'angeboten')) {
        await kursNachruecken(env, p, kurs, eff, s, t.datum);
      }
      // Einmal pro Termin: Hinweis an die Anbieterin, dass sie Plätze für USC melden kann
      if (offen && s.usc_aktiv && s.usc_mail && !doc.usc_gemeldet) {
        const frisch = await kursGetTermin(env, p.id, kurs.id, t.datum);
        const b = kursBelegung(frisch, kurs, eff, now);
        uscListe.push({ titel: kurs.titel, datum: t.datum, start: t.start, frei: b.frei });
        await kursMitSperre(env, p.id, kurs.id, async () => {
          const d = await kursGetTermin(env, p.id, kurs.id, t.datum);
          d.usc_gemeldet = true;
          await kursPutTermin(env, p.id, d);
        });
      }
    }
  }
  if (uscListe.length) {
    try { await kursMailUsc(env, p, uscListe); } catch (err) { console.error('USC-Mail', err); }
  }
  // Erinnerung am Vortag – nicht vor 8 Uhr morgens
  if (berlinParts(new Date(now)).minutes >= 8 * 60) await kursErinnern(env, p, kurse, heute);
  if (opts.taeglich) await kursAufraeumen(env, p, kurse, heute);
}

/**
 * Datenschutz: Wartelisten nach dem Termin leeren; Termine und Bestellungen nach derselben
 * Frist löschen wie Personal-Training-Buchungen (bis Ende des Folgejahres).
 */
async function kursAufraeumen(env, p, kurse, heute) {
  // Warteliste von gestern bis vor einer Woche leeren
  for (const kurs of kurse) {
    for (const t of kursTermine(kurs, kursAddDays(heute, -7), kursAddDays(heute, -1))) {
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      if (!(doc.warteliste || []).length) continue;
      await kursMitSperre(env, p.id, kurs.id, async () => {
        const d = await kursGetTermin(env, p.id, kurs.id, t.datum);
        d.warteliste = [];
        await kursPutTermin(env, p.id, d);
      });
    }
  }
  // Einmal im Monat (am 1.): alte Termin-Dokumente und Bestellungen
  if (heute.slice(8, 10) !== '01') return;
  const grenze = `${Number(heute.slice(0, 4)) - 1}-01-01`;
  const termine = await env.VOUCHERS.list({ prefix: K.terminPrefix(p.id) });
  for (const k of termine.keys) {
    const d = k.name.slice(-10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < grenze) await env.VOUCHERS.delete(k.name);
  }
  const best = await env.VOUCHERS.list({ prefix: K.bestellungPrefix(p.id) });
  for (const k of best.keys) {
    const o = await kursGetBestellung(env, p.id, k.name.split(':').pop());
    if (!o) continue;
    const letzter = (o.termine || []).slice(-1)[0] || '';
    if (letzter && letzter < grenze) await env.VOUCHERS.delete(k.name);
  }
}


/** Erinnerungsmail für alle, die morgen einen Kursplatz haben. Jeder Platz wird nur einmal erinnert. */
async function kursErinnern(env, p, kurse, heute) {
  const morgen = kursAddDays(heute, 1);
  for (const kurs of kurse) {
    for (const t of kursTermine(kurs, morgen, morgen)) {
      if (t.ausfall) continue;
      const doc = await kursGetTermin(env, p.id, kurs.id, t.datum);
      if (doc.absage || !(doc.plaetze || []).some((z) => z.status === 'gebucht' && !z.erinnert && z.email)) continue;
      const faellig = [];
      // erst markieren, dann schicken – so geht auch bei zwei gleichzeitigen Läufen nichts doppelt raus
      await kursMitSperre(env, p.id, kurs.id, async () => {
        const d = await kursGetTermin(env, p.id, kurs.id, t.datum);
        for (const z of d.plaetze) {
          if (z.status === 'gebucht' && !z.erinnert && z.email) { z.erinnert = true; faellig.push({ ...z }); }
        }
        if (faellig.length) await kursPutTermin(env, p.id, d);
      });
      for (const z of faellig) {
        try {
          const o = z.order ? await kursGetBestellung(env, p.id, z.order) : null;
          await kursMailErinnerung(env, p, kurs, t, z, o);
        } catch (err) { console.error('Kurs-Erinnerung', err); }
      }
    }
  }
}

/* ================================================================== */
/* Kursmodul: index.js                                             */
/* ================================================================== */

/**
 * Kursmodul – Einstieg. Wird von basis.js an vier Stellen aufgerufen (KURSE-HOOK):
 * Router, Admin, takenState() und Webhook – plus Cron.
 */


/** CORS für Kurs-Endpunkte: Website plus freigegebene Partnerseiten (Variable KURS_ORIGINS). */
function kursCors(res, request, env) {
  const origin = request.headers.get('Origin') || '';
  const erlaubt = kursOrigins(env || {});
  const allow = erlaubt.indexOf(origin) !== -1 ? origin : erlaubt[0];
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', allow);
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

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

async function kursRoute(url, request, env, ctx) {
  const pfad = url.pathname.replace(/^\/api\/kurse\/?/, '');
  const m = request.method;
  let res;
  try {
    if (pfad === '' && m === 'GET') res = await kursListe(url, env);
    else if (pfad === 'checkout' && m === 'POST') res = await kursCheckoutHandler(request, env, ctx);
    else if (pfad === 'gutschein' && m === 'POST') res = await kursGutscheinCheck(request, env);
    else if (pfad === 'warteliste' && m === 'POST') res = await kursWarteliste(request, env);
    else if (pfad === 'warteliste-austragen' && m === 'POST') res = await kursWartelisteRaus(request, env, ctx);
    else if (pfad === 'release' && m === 'POST') res = await kursRelease(request, env, ctx);
    else if (pfad === 'bestellung' && m === 'GET') res = await kursBestellungAnsehen(url, env);
    else if (pfad === 'aktion' && m === 'POST') res = await kursAktion(request, env, ctx);
    else if (pfad === 'inklusiv-check' && m === 'POST') res = await kursInklusivCheck(request, env);
    else if (pfad === 'inklusiv' && m === 'POST') res = await kursInklusivBuchen(request, env);
    else if (pfad === 'karte' && m === 'POST') res = await kursKarteStatusRoute(request, env);
    else if (pfad === 'karte-buchen' && m === 'POST') res = await kursKarteBuchen(request, env, ctx);
    else if (pfad === 'karte-absagen' && m === 'POST') res = await kursKarteAbsagenRoute(request, env, ctx);
    else if (pfad === 'kalender.ics' && m === 'GET') return await kursKalenderAbo(url, env);
    else if (pfad === 'bestellung.ics' && m === 'GET') return kursCors(await kursBestellungIcs(url, env), request, env);
    else res = json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('Kurs-Fehler', err && err.stack ? err.stack : err);
    res = json({ error: err && err.status ? err.message : 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.' }, (err && err.status) || 500);
  }
  return kursCors(res, request, env);
}

/* ====================================================================== */
/* WIEDERVORLAGE (neu in worker-code-10)                                  */
/* ====================================================================== */
/*
 * Was dieser Block macht
 *   1. WhatsApp-Button für die Bestätigungsmails (whatsappBlockHtml)
 *   2. Täglicher Job: schickt Kunden nach N Wochen ohne neuen Einzeltermin eine
 *      persönliche Mail mit einem einmaligen Stripe-Aktionscode (wvDaily / wvRun)
 *   3. Abmeldung (POST /api/abmelden) und Unterdrückungsliste im KV
 *   4. Aktionscodes im bestehenden Buchungs-Checkout (wvCheckPromo, ein Codefeld
 *      für FD-Gutscheine und Stripe-Codes)
 *   5. Personalisierung: Variante A (Vorlage mit Platzhaltern) ist aktiv,
 *      Variante B (KI-Entwurf zur Freigabe) ist vorbereitet und ausgeschaltet
 *
 * Sicherheitsnetze
 *   - Modus steht standardmäßig auf "aus". "trocken" listet nur auf, "live" versendet.
 *   - Es gibt nie mehr als maxProTag Mails pro Lauf.
 *   - Nur Termine, die in den letzten catchupTage Tagen vor der Schwelle liegen,
 *     werden berücksichtigt – beim Einschalten geht also keine Welle an alte Kunden raus.
 *   - Nur Kunden, die beim Buchen den Werbehinweis gesehen haben (hinweisAb) oder
 *     für die eine Einwilligung eingetragen ist.
 *   - Das Freitextfeld wird nie an einen KI-Dienst gesendet.
 *
 * KV-Schlüssel (alle im Namespace VOUCHERS)
 *   wv:settings            Einstellungen (JSON)
 *   wv:optout:<mail>       Abmeldung  { at, quelle }
 *   wv:consent:<mail>      Einwilligung für Altkunden  { at, notiz }
 *   wv:sent:<buchungs-id>  Versandstatus je Termin  { status, code, ... }
 *   wv:entwurf:<id>        Entwurf zur Freigabe (Variante B)
 *   wv:last                Ergebnis des letzten Laufs (Trockenlauf oder echt)
 *   wv:lock                kurzer Sperrschlüssel gegen doppelte Läufe
 */

const WV_DEFAULTS = {
  modus: 'aus',            // 'aus' | 'trocken' | 'live'
  wochen: 10,              // Wochen nach dem letzten Einzeltermin (8–12)
  rabattCents: 3000,       // Wert des Aktionscodes
  gueltigWochen: 6,        // Laufzeit des Codes ab Versand
  catchupTage: 14,         // so weit hinter der Schwelle werden verpasste Kunden noch erfasst
  maxProTag: 25,           // harte Obergrenze pro Lauf
  codePrefix: 'WIEDER',    // Präfix des Codes; darf nicht mit "FD-" beginnen
  hinweisAb: '',           // ISO-Datum: ab dann gebuchte Termine enthalten den Werbehinweis
  wunschAn: true,          // Freitext darf (nach Prüfung) zitiert werden
  wunschAb: '',            // ISO-Datum: ab dann steht der Hinweis zur Verwendung der Ziele im Formular
  wunschMax: 140,          // längere Freitexte → neutrale Formulierung
  variante: 'A',           // 'A' = Vorlage, 'B' = KI-Entwurf zur Freigabe (nur vorbereitet)
  kiAktiv: false,          // Variante B erst mit true UND gesetztem ANTHROPIC_API_KEY
  kiModell: 'claude-sonnet-5-5',
  betreff: 'Wie läuft das Training, {Vorname}?',
  vorlageMitWunsch:
    'Hey {Vorname},\n\nwie läuft es mit dem Training? Du hattest mir bei deiner Buchung geschrieben: „{Wunsch}“. ' +
    'Gibt es Übungen oder Themen, die wir noch einmal ansehen sollten?',
  vorlageNeutral:
    'Hey {Vorname},\n\nwie läuft es mit dem Training? Gibt es Übungen oder Themen, ' +
    'die wir noch einmal ansehen sollten?',
};

// Texte mit Gesundheitsbezug werden nie zitiert, auch wenn sie kurz sind
const WV_GESUNDHEIT = new RegExp([
  'schmerz', 'verletz', 'bandscheib', 'diagnos', 'krank', 'erkrank', 'arzt', 'ärzt', 'aerzt', 'klinik',
  'reha', 'operation', '\\bop\\b', 'therap', 'depress', 'angst', 'burn.?out', 'diabet', 'bluthochdruck',
  'herz', 'asthma', 'schwanger', 'medikament', 'tablett', 'beschwerd', 'knie', 'rücken', 'ruecken',
  'schulter', 'hüft', 'huef', 'gelenk', 'arthros', 'skolio', 'hernie', 'übergewicht', 'uebergewicht',
  'adiposit', 'essstör', 'magersucht', 'bulimi', '\\bkrebs', 'tumor', 'migräne', 'migraene', 'inkontinenz',
  'beckenboden', 'rückbildung', 'rueckbildung', 'osteopor', 'rheuma', 'fibromyalg', 'long.?covid',
].join('|'), 'i');

/* ---------- kleine Helfer ---------- */

function wvBerlinDate(ms) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(ms));
}

function wvAddDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function wvClamp(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function wvIsoDateOrEmpty(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

async function wvSettings(env) {
  let s = {};
  try {
    const raw = await env.VOUCHERS.get('wv:settings');
    if (raw) s = JSON.parse(raw);
  } catch (err) {
    console.error('Wiedervorlage-Einstellungen unlesbar', err);
  }
  return wvNormalizeSettings(s);
}

function wvNormalizeSettings(s) {
  const d = WV_DEFAULTS;
  const prefix = String(s.codePrefix || d.codePrefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || d.codePrefix;
  return {
    modus: ['aus', 'trocken', 'live'].includes(s.modus) ? s.modus : d.modus,
    wochen: wvClamp(s.wochen, 8, 12, d.wochen),
    rabattCents: wvClamp(s.rabattCents, 500, 20000, d.rabattCents),
    gueltigWochen: wvClamp(s.gueltigWochen, 1, 26, d.gueltigWochen),
    catchupTage: wvClamp(s.catchupTage, 0, 60, d.catchupTage),
    maxProTag: wvClamp(s.maxProTag, 1, 100, d.maxProTag),
    codePrefix: prefix.startsWith('FD') ? d.codePrefix : prefix,
    hinweisAb: wvIsoDateOrEmpty(s.hinweisAb),
    wunschAn: s.wunschAn === undefined ? d.wunschAn : s.wunschAn === true,
    wunschAb: wvIsoDateOrEmpty(s.wunschAb),
    wunschMax: wvClamp(s.wunschMax, 20, 300, d.wunschMax),
    variante: s.variante === 'B' ? 'B' : 'A',
    kiAktiv: s.kiAktiv === true,
    kiModell: clean(s.kiModell || d.kiModell, 60) || d.kiModell,
    betreff: clean(s.betreff || d.betreff, 120) || d.betreff,
    vorlageMitWunsch: String(s.vorlageMitWunsch || d.vorlageMitWunsch).slice(0, 1200),
    vorlageNeutral: String(s.vorlageNeutral || d.vorlageNeutral).slice(0, 1200),
  };
}

async function wvListAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.VOUCHERS.list({ prefix, cursor });
    out.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

async function wvReadJson(env, key) {
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function wvEmailKey(email) {
  return String(email || '').trim().toLowerCase();
}

/* ---------- Abmeldung ---------- */

function wvSecret(env) {
  return String(env.WV_SECRET || env.ADMIN_PASSWORT || '');
}

function wvB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wvUnB64(s) {
  try {
    const pad = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch (err) {
    return '';
  }
}

async function wvToken(env, email) {
  const secret = wvSecret(env);
  if (!secret) return '';
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`wv-abmeldung:${wvEmailKey(email)}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function wvUnsubLinks(env, email) {
  const cfg = config(env);
  const e = wvB64(wvEmailKey(email));
  const t = await wvToken(env, email);
  return {
    seite: `${cfg.siteOrigin}/abmelden.html?e=${e}&t=${t}`,
    api: `${wvApiOrigin(env)}/api/abmelden?e=${e}&t=${t}`,
  };
}

function wvApiOrigin(env) {
  return String(env.API_ORIGIN || CONFIG.apiOrigin || '').replace(/\/+$/, '');
}

/** POST /api/abmelden – auch als One-Click-Abmeldung aus dem Mailprogramm (List-Unsubscribe-Post). */
async function handleAbmelden(url, request, env) {
  let e = url.searchParams.get('e') || '';
  let t = url.searchParams.get('t') || '';
  if (!e) {
    const body = await request.json().catch(() => ({}));
    e = String(body.e || '');
    t = String(body.t || '');
  }
  const email = wvEmailKey(wvUnB64(e));
  if (!isEmail(email) || !t) return json({ error: 'Der Abmeldelink ist ungültig.' }, 400);
  const expected = await wvToken(env, email);
  if (!expected || !timingSafeEqual(expected, t)) {
    return json({ error: 'Der Abmeldelink ist ungültig oder abgelaufen.' }, 400);
  }
  await env.VOUCHERS.put(`wv:optout:${email}`, JSON.stringify({ at: new Date().toISOString(), quelle: 'link' }));
  return json({ ok: true });
}

/* ---------- WhatsApp-Button ---------- */

function wvWhatsappNumber(cfg) {
  let d = String(cfg.ownerPhone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `49${d.slice(1)}`;
  return d;
}

/**
 * Button für alle Mailprogramme: Tabelle, Inline-Styles, Farbe auch als bgcolor-Attribut,
 * Innenabstand zusätzlich für Outlook (mso-padding-alt). Kein Nachname im Vorbelegungstext.
 */
function whatsappBlockHtml(b, env, opts) {
  const cfg = config(env);
  const num = wvWhatsappNumber(cfg);
  const frei = opts && opts.text;
  if (!num || (!frei && (!b || !b.date))) return '';
  const vorname = firstName(cfg.ownerName) || 'Niklas';
  const text = frei ? opts.text : `Hallo ${vorname}, ich habe am ${fmtDate(b.date)} um ${b.start} Uhr einen Termin und eine Frage`;
  const intro = (opts && opts.intro) || 'Eine Frage zum Termin? Schreib mir direkt:';
  const href = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
      <tr><td style="padding:0 0 10px;font-size:14px;line-height:1.6;color:#9AA0AB">
        ${esc(intro)}
      </td></tr>
      <tr><td align="left">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#1EA952" style="background-color:#1EA952;border:1px solid #25D366;border-radius:8px;mso-padding-alt:15px 28px">
            <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:15px 28px 15px 22px;color:#FFFFFF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:22px;letter-spacing:.01em;text-decoration:none"><img src="${esc(wvSiteUrl(env))}/whatsapp-weiss.png" width="24" height="24" alt="" style="display:inline-block;vertical-align:middle;border:0;margin:0 12px 0 0;width:24px;height:24px"><span style="vertical-align:middle">Per WhatsApp kontaktieren</span></a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:14px 0 0;font-size:13px;line-height:1.6;color:#9AA0AB">
        Neue Kurse und Early-Bird-Angebote erfährst du zuerst im <a href="${esc(wvKanalUrl(env))}" target="_blank" style="color:#EFB92E">WhatsApp-Kanal</a>.
      </td></tr>
    </table>`;
}

/** Kasten in Karten-Mails: wie man die restlichen Termine bucht (der Link enthält den Code schon). */
function cardHowToHtml(code, expires, left, total, link) {
  return `<div style="margin:0 0 24px;padding:18px 20px;background-color:#1F232B;border-left:3px solid #EFB92E">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ECE9E2">So buchst du die restlichen Termine</p>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#C9CCD3">Tipp einfach auf den gelben Button. Deine Karte ist dann schon hinterlegt, du musst keinen Code eintippen. Such dir Ort und Uhrzeit aus, die Einheit wird von deiner Karte abgezogen. Du kannst jeden Termin einzeln buchen, wann es dir passt.</p>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#C9CCD3">Noch <b style="color:#ECE9E2">${esc(String(left))} von ${esc(String(total))} Einheiten</b> frei, einlösbar bis ${esc(fmtDate(expires))}.</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#9AA0AB">Nur falls der Button mal nicht klappt: Öffne <a href="${esc(link)}" style="color:#EFB92E">fitnessdonner.de/termin-buchen.html</a> und gib dort deinen Kartencode ein: <b style="color:#ECE9E2;letter-spacing:.06em">${esc(code)}</b></p>
    </div>`;
}

/** Adresse der Website (für Bilder in Mails). */
function wvSiteUrl(env) {
  return String((env && env.SITE_URL) || 'https://fitnessdonner.de').replace(/\/+$/, '');
}

/** WhatsApp-Kanal (Link steht hier an einer Stelle; per Variable WA_CHANNEL überschreibbar). */
function wvKanalUrl(env) {
  return (env && env.WA_CHANNEL) || 'https://whatsapp.com/channel/0029Vb9Sacj9xVJgW1Vm7O2Z';
}

/* ---------- Stripe ---------- */

async function wvStripe(env, method, path, params, idem) {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idem) headers['Idempotency-Key'] = idem;
  let url = `https://api.stripe.com/v1/${path}`;
  let body;
  if (method === 'GET') {
    if (params) url += `?${params.toString()}`;
  } else {
    body = (params || new URLSearchParams()).toString();
  }
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('Stripe-Fehler (Wiedervorlage)', method, path, res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

/** Der Coupon hängt je nach API-Version direkt am Aktionscode oder unter "promotion". */
async function wvCouponOf(env, pc) {
  let c = pc.coupon || (pc.promotion && pc.promotion.coupon) || null;
  if (typeof c === 'string') {
    const r = await wvStripe(env, 'GET', `coupons/${encodeURIComponent(c)}`);
    c = r.ok ? r.data : null;
  }
  return c;
}

function wvRandomCode(S) {
  return `${S.codePrefix}-${randomChars(6)}`;
}

/** Legt Coupon + Aktionscode für einen Kunden an. Liefert { code, promoId, couponId, expiresAt } oder { error }. */
async function wvCreatePromo(env, S, ctx) {
  const validUntil = wvAddDays(wvBerlinDate(Date.now()), S.gueltigWochen * 7);
  const expiresTs = Math.floor(berlinToUtc(validUntil, '23:59').getTime() / 1000);
  const idem = ctx.idem || `wv-${ctx.bookingId}`;

  const cp = new URLSearchParams();
  cp.set('amount_off', String(S.rabattCents));
  cp.set('currency', 'eur');
  cp.set('duration', 'once');
  cp.set('max_redemptions', '1');
  cp.set('redeem_by', String(expiresTs));
  cp.set('name', `Wiedersehen ${fmtEur(S.rabattCents)}`);
  cp.set('metadata[quelle]', 'wiedervorlage');
  if (ctx.bookingId) cp.set('metadata[booking_id]', ctx.bookingId);
  const coupon = await wvStripe(env, 'POST', 'coupons', cp, `${idem}-coupon`);
  if (!coupon.ok) return { error: 'Coupon konnte nicht angelegt werden.' };

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = wvRandomCode(S);
    const shapes = [
      (p) => p.set('coupon', coupon.data.id),
      (p) => { p.set('promotion[type]', 'coupon'); p.set('promotion[coupon]', coupon.data.id); },
    ];
    for (const shape of shapes) {
      const pp = new URLSearchParams();
      shape(pp);
      pp.set('code', code);
      pp.set('max_redemptions', '1');
      pp.set('expires_at', String(expiresTs));
      pp.set('metadata[quelle]', 'wiedervorlage');
      if (ctx.bookingId) pp.set('metadata[booking_id]', ctx.bookingId);
      const r = await wvStripe(env, 'POST', 'promotion_codes', pp, `${idem}-promo-${attempt}-${shapes.indexOf(shape)}`);
      if (r.ok) return { code, promoId: r.data.id, couponId: coupon.data.id, validUntil, expiresTs };
      const msg = JSON.stringify(r.data || {});
      if (/already exists|bereits/i.test(msg)) break;            // Code vergeben → neuer Versuch mit anderem Code
      if (!/unknown parameter|parameter_unknown|Received unknown/i.test(msg)) return { error: 'Aktionscode konnte nicht angelegt werden.' };
    }
  }
  return { error: 'Aktionscode konnte nicht angelegt werden.' };
}

/**
 * Prüft einen Aktionscode für den Buchungs-Checkout.
 * Aktionscodes gelten nur für Einzeltermine (Personal Training); die Beschränkung erzwingt
 * der Worker selbst, weil er den Rabatt nur in diesem Checkout an Stripe weitergibt.
 */
async function wvCheckPromo(env, rawCode, type, priceCents) {
  const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
  if (!code) return { error: 'Bitte einen Code eingeben.' };
  if (type !== 'training') {
    return { error: 'Aktionscodes gelten nur für Personal Training, nicht für das Probetraining.' };
  }
  const q = new URLSearchParams({ code, limit: '5' });
  const r = await wvStripe(env, 'GET', 'promotion_codes', q);
  if (!r.ok) return { error: 'Der Code konnte gerade nicht geprüft werden. Bitte versuche es gleich noch einmal.' };

  const list = (r.data && r.data.data) || [];
  const pc = list.find((x) => x.active) || list[0];
  if (!pc) return { error: 'Diesen Code kennen wir nicht. Bitte prüfe die Schreibweise.' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (!pc.active) {
    if (pc.expires_at && pc.expires_at < nowSec) {
      return { error: `Dieser Code ist am ${fmtDate(wvBerlinDate(pc.expires_at * 1000))} abgelaufen.` };
    }
    if (pc.max_redemptions && pc.times_redeemed >= pc.max_redemptions) {
      return { error: 'Dieser Code wurde bereits eingelöst.' };
    }
    return { error: 'Dieser Code ist nicht mehr gültig.' };
  }
  if (pc.expires_at && pc.expires_at < nowSec) {
    return { error: `Dieser Code ist am ${fmtDate(wvBerlinDate(pc.expires_at * 1000))} abgelaufen.` };
  }

  const coupon = await wvCouponOf(env, pc);
  if (!coupon || coupon.valid === false) return { error: 'Dieser Code ist nicht mehr gültig.' };

  let discount = 0;
  if (coupon.amount_off) {
    if (coupon.currency && coupon.currency.toLowerCase() !== 'eur') return { error: 'Dieser Code gilt nicht für diese Buchung.' };
    discount = coupon.amount_off;
  } else if (coupon.percent_off) {
    discount = Math.round((priceCents * coupon.percent_off) / 100);
  }
  const min = pc.restrictions && pc.restrictions.minimum_amount;
  if (min && priceCents < min) {
    return { error: `Dieser Code gilt erst ab einem Preis von ${fmtEur(min)}.` };
  }
  discount = Math.min(discount, priceCents);
  // Stripe nimmt Zahlungen unter 50 Cent nicht an – der Rest muss also eine echte Zahlung bleiben
  if (discount <= 0 || priceCents - discount < 100) {
    return { error: 'Mit diesem Code bleibt kein zahlbarer Betrag übrig. Bitte melde dich kurz bei mir.' };
  }
  return {
    id: pc.id, code: pc.code || code, discount,
    expires: pc.expires_at ? wvBerlinDate(pc.expires_at * 1000) : '',
  };
}

/** Alles, was nicht mit "FD-" beginnt, ist (wenn überhaupt) ein Stripe-Aktionscode. */
function wvIsPromoCode(raw) {
  const c = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return !!c && !c.startsWith('FD-');
}

async function wvRedeemCheck(body, env) {
  const cfg = await liveConfig(env);
  const type = BOOKING_TYPES[body.type] ? body.type : 'training';
  const price = cfg[BOOKING_TYPES[type].priceKey];
  const pr = await wvCheckPromo(env, body.code, type, price);
  if (pr.error) return json({ ok: false, error: pr.error }, 200);
  return json({
    ok: true, kind: 'aktion', code: pr.code,
    remaining_cents: pr.discount, discount_cents: pr.discount, open_cents: price - pr.discount,
    expires: pr.expires,
  });
}

/* ---------- Kandidaten ---------- */

const WV_MAX_LESEN = 700;   // höchstens so viele Buchungen pro Lauf lesen (Limit pro Worker-Aufruf)

async function wvLoadBookings(env) {
  const keys = (await wvListAll(env, 'booking:')).map((k) => k.name);
  // neueste zuerst: bei sehr vielen Buchungen fallen die ältesten weg, nicht die aktuellen
  keys.sort((a, b) => b.localeCompare(a));
  const slice = keys.slice(0, WV_MAX_LESEN);
  const out = [];
  for (let i = 0; i < slice.length; i += 25) {
    const part = await Promise.all(slice.slice(i, i + 25).map((k) => wvReadJson(env, k)));
    for (const b of part) if (b) out.push(b);
  }
  return { bookings: out, abgeschnitten: keys.length > WV_MAX_LESEN };
}

async function wvKartenMitRest(env) {
  const set = new Set();
  const keys = await wvListAll(env, 'voucher:');
  for (let i = 0; i < keys.length; i += 25) {
    const part = await Promise.all(keys.slice(i, i + 25).map((k) => wvReadJson(env, k.name)));
    for (const v of part) {
      if (!v || v.kind !== 'karte' || v.status === 'cancelled' || v.status === 'redeemed') continue;
      if (v.expires && v.expires < wvBerlinDate(Date.now())) continue;
      if ((v.sessions_total || 0) - (v.sessions_used || 0) <= 0) continue;
      if (v.buyer_email) set.add(wvEmailKey(v.buyer_email));
    }
  }
  return set;
}

function wvWunschPruefen(S, b) {
  const text = clean(b && b.note, 300);
  if (!S.wunschAn) return { ok: false, grund: 'Freitext-Verwendung ausgeschaltet' };
  if (!text) return { ok: false, grund: 'Feld leer' };
  if (text.length < 3) return { ok: false, grund: 'zu kurz' };
  if (text.length > S.wunschMax) return { ok: false, grund: `länger als ${S.wunschMax} Zeichen` };
  if (/@|https?:|www\./i.test(text)) return { ok: false, grund: 'enthält Adresse oder Link' };
  if (WV_GESUNDHEIT.test(text)) return { ok: false, grund: 'Gesundheitsbezug' };
  if (!S.wunschAb || String(b.created || '').slice(0, 10) < S.wunschAb) {
    return { ok: false, grund: 'gebucht, bevor der Hinweis zur Verwendung im Formular stand' };
  }
  return { ok: true, text: text.replace(/[„“”"]/g, '').replace(/[.!?\s]+$/, '') };
}

/**
 * Wer würde jetzt eine Mail bekommen? Reine Auswertung, schreibt nichts.
 * Liefert { kandidaten, uebersprungen, schwelle, fensterStart, abgeschnitten }.
 */
async function wvKandidaten(env, S) {
  const today = wvBerlinDate(Date.now());
  const schwelle = wvAddDays(today, -S.wochen * 7);
  const fensterStart = wvAddDays(schwelle, -S.catchupTage);

  const { bookings, abgeschnitten } = await wvLoadBookings(env);
  const byEmail = new Map();
  for (const b of bookings) {
    if (!b || b.status !== 'confirmed' || !b.date || !b.email) continue;
    if (!BOOKING_TYPES[b.type]) continue;                 // nur Einzeltermine (Training, Probetraining)
    if (b.pay_status === 'failed') continue;              // geplatzte Lastschrift
    const e = wvEmailKey(b.email);
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(b);
  }

  const karten = await wvKartenMitRest(env);
  const kandidaten = [];
  const uebersprungen = [];

  for (const [email, list] of byEmail) {
    list.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    const last = list[list.length - 1];
    if (last.date > schwelle) continue;        // jüngere oder künftige Buchung → noch nicht dran
    if (last.date <= fensterStart) continue;   // zu lange her → nie Teil einer Welle
    const skip = (grund) => uebersprungen.push({ email, name: last.name, datum: last.date, grund });

    if (!isEmail(email)) { skip('ungültige E-Mail-Adresse'); continue; }
    if (await env.VOUCHERS.get(`wv:optout:${email}`)) { skip('abgemeldet'); continue; }
    const sent = await wvReadJson(env, `wv:sent:${last.id}`);
    if (sent && sent.status === 'gesendet') { skip('für diesen Termin schon gesendet'); continue; }
    if (karten.has(email)) { skip('hat noch Einheiten auf einer Karte'); continue; }

    const consent = await wvReadJson(env, `wv:consent:${email}`);
    const hinweis = S.hinweisAb && String(last.created || '').slice(0, 10) >= S.hinweisAb;
    if (!hinweis && !consent) { skip('ohne Werbehinweis gebucht und keine Einwilligung eingetragen'); continue; }

    // Angaben aus der ersten Buchung (älteste mit Text im Feld)
    const mitNotiz = list.find((x) => clean(x.note, 300));
    const wunsch = mitNotiz ? wvWunschPruefen(S, mitNotiz) : { ok: false, grund: 'Feld leer' };

    kandidaten.push({
      email,
      name: last.name,
      vorname: firstName(last.name),
      bookingId: last.id,
      letzterTermin: last.date,
      leistung: last.label || BOOKING_TYPES[last.type].label,
      anzahl: list.length,
      grundVersand: consent && !hinweis ? 'Einwilligung eingetragen' : 'Hinweis beim Buchen',
      wunsch: wunsch.ok ? wunsch.text : '',
      wunschOk: wunsch.ok,
      wunschGrund: wunsch.ok ? '' : wunsch.grund,
      sent,
    });
  }

  kandidaten.sort((a, b) => a.letzterTermin.localeCompare(b.letzterTermin));
  return { kandidaten, uebersprungen, schwelle, fensterStart, abgeschnitten };
}

/* ---------- Mail ---------- */

function wvFill(template, vars) {
  return String(template || '').replace(/\{(Vorname|Wunsch)\}/g, (m, k) => vars[k] || '');
}

function wvTextHtml(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 18px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function wvAbsatzText(S, c, override) {
  if (override) return override;
  const vorlage = c.wunschOk ? S.vorlageMitWunsch : S.vorlageNeutral;
  return wvFill(vorlage, { Vorname: c.vorname || '', Wunsch: c.wunsch || '' });
}

async function wvMailBauen(env, S, c, promo, absatzText) {
  const cfg = config(env);
  const links = await wvUnsubLinks(env, c.email);
  const buchen = `${cfg.siteOrigin}/termin-buchen.html?art=training&code=${encodeURIComponent(promo.code)}`;
  const gueltig = fmtDate(promo.validUntil);
  const inner = `
    ${wvTextHtml(absatzText || wvAbsatzText(S, c))}
    <p style="margin:0 0 18px">Falls du wieder einsteigen magst: Hier ist ein Gutschein über <b>${esc(fmtEur(S.rabattCents))}</b>
      für deinen nächsten Einzeltermin.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#22262F;margin:0 0 14px">
      <tr><td style="padding:18px 20px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9AA0AB">Dein Code</div>
        <div style="font-size:24px;font-weight:800;letter-spacing:.1em;color:#EFB92E;margin:6px 0 4px">${esc(promo.code)}</div>
        <div style="font-size:13px;color:#9AA0AB">Gültig bis ${esc(gueltig)} &middot; einmal einlösbar</div>
      </td></tr>
    </table>
    <p style="margin:0 0 22px;font-size:14px;color:#9AA0AB">Du kannst den Gutschein auch verschenken.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
      <td align="center" bgcolor="#EFB92E" style="background-color:#EFB92E;border-radius:4px;mso-padding-alt:14px 26px">
        <a href="${esc(buchen)}" target="_blank" style="display:inline-block;padding:14px 26px;color:#15171C;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.2;text-decoration:none">Neuen Termin buchen</a>
      </td>
    </tr></table>
    <p style="margin:0 0 18px;font-size:13px;color:#9AA0AB">Der Link trägt den Code schon ein. Alternativ gibst du ihn beim Buchen
      im Feld &bdquo;Gutschein-, Guthaben- oder Aktionscode&ldquo; ein.</p>
    <p style="margin:0;font-size:12px;line-height:1.7;color:#767C87">Du bekommst diese Mail, weil du bei mir einen Einzeltermin gebucht hast.
      Ich melde mich gelegentlich per Mail zu &auml;hnlichen Angeboten.
      Dem kannst du jederzeit widersprechen, es entstehen dir dabei keine anderen Kosten als f&uuml;r die &Uuml;bermittlung.
      Keine solchen Mails mehr? <a href="${esc(links.seite)}" style="color:#9AA0AB">Hier abmelden</a>
      &ndash; oder antworte kurz auf diese Mail.</p>`;

  const subject = wvFill(S.betreff, { Vorname: c.vorname || '' }).replace(/\s+,/g, ',').trim() || 'Wie läuft das Training?';
  return {
    subject,
    html: mailShell('Wie läuft das Training?', inner, env,
      `${fmtEur(S.rabattCents)} für deinen nächsten Einzeltermin, bis ${gueltig}`),
    headers: {
      'List-Unsubscribe': `<${links.api}>, <${links.seite}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/* ---------- Der Lauf ---------- */

async function wvDaily(env) {
  const S = await wvSettings(env);
  if (S.modus === 'aus') return;
  await wvRun(env, S, { senden: S.modus === 'live' });
}

/**
 * senden=false  → Trockenlauf: nichts wird angelegt oder verschickt.
 * senden=true   → Aktionscode in Stripe anlegen, Mail senden (Variante A) bzw. Entwurf ablegen (Variante B).
 */
async function wvRun(env, S, { senden }) {
  if (await env.VOUCHERS.get('wv:lock')) return { fehler: 'Ein anderer Lauf ist gerade aktiv.' };
  await env.VOUCHERS.put('wv:lock', '1', { expirationTtl: 120 });
  const report = {
    at: new Date().toISOString(),
    modus: senden ? 'live' : 'trocken',
    variante: S.variante,
    wochen: S.wochen,
    gesendet: [], entwuerfe: [], fehler: [],
  };
  try {
    const k = await wvKandidaten(env, S);
    Object.assign(report, {
      schwelle: k.schwelle, fensterStart: k.fensterStart, abgeschnitten: k.abgeschnitten,
      kandidaten: k.kandidaten.map((c) => ({
        email: c.email, name: c.name, bookingId: c.bookingId, letzterTermin: c.letzterTermin,
        leistung: c.leistung, anzahl: c.anzahl, grund: c.grundVersand,
        wunsch: c.wunsch, wunschGrund: c.wunschGrund, absatz: wvAbsatzText(S, c),
        status: c.sent ? c.sent.status : 'neu',
      })),
      uebersprungen: k.uebersprungen,
    });

    if (senden) {
      if (!wvSecret(env)) {
        report.fehler.push('Weder WV_SECRET noch ADMIN_PASSWORT gesetzt – ohne Abmelde-Token wird nichts versendet.');
      } else if (!env.STRIPE_SECRET_KEY || !env.RESEND_API_KEY) {
        report.fehler.push('STRIPE_SECRET_KEY oder RESEND_API_KEY fehlt.');
      } else {
        let n = 0;
        for (const c of k.kandidaten) {
          if (n >= S.maxProTag) { report.fehler.push(`Obergrenze von ${S.maxProTag} Mails erreicht – der Rest folgt am nächsten Tag.`); break; }
          try {
            const r = S.variante === 'B' && S.kiAktiv
              ? await wvEntwurfAblegen(env, S, c)
              : await wvSenden(env, S, c);
            if (r === 'entwurf') report.entwuerfe.push(c.email);
            else if (r === 'gesendet') { report.gesendet.push(c.email); n++; }
          } catch (err) {
            console.error('Wiedervorlage fehlgeschlagen', c.bookingId, err);
            report.fehler.push(`${c.email}: ${err && err.message ? err.message : err}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('Wiedervorlage-Lauf fehlgeschlagen', err);
    report.fehler.push(String(err && err.message ? err.message : err));
  } finally {
    await env.VOUCHERS.delete('wv:lock');
  }
  await env.VOUCHERS.put('wv:last', JSON.stringify(report), { expirationTtl: 60 * 60 * 24 * 60 });
  return report;
}

/** Code anlegen (falls noch nicht geschehen), Mail senden, Status festhalten. */
async function wvSenden(env, S, c, absatzOverride) {
  const key = `wv:sent:${c.bookingId}`;
  let rec = (await wvReadJson(env, key)) || null;
  if (rec && rec.status === 'gesendet') return 'schon';
  if (rec && (rec.versuche || 0) >= 3) throw new Error('nach 3 Versuchen aufgegeben');

  // Abmeldung kurz vor dem Versand noch einmal prüfen
  if (await env.VOUCHERS.get(`wv:optout:${c.email}`)) return 'abgemeldet';

  if (!rec) {
    const p = await wvCreatePromo(env, S, { bookingId: c.bookingId });
    if (p.error) throw new Error(p.error);
    rec = {
      status: 'angelegt', email: c.email, code: p.code, promoId: p.promoId, couponId: p.couponId,
      validUntil: p.validUntil, angelegt: new Date().toISOString(), versuche: 0,
    };
    await env.VOUCHERS.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 800 });
  }

  const mail = await wvMailBauen(env, S, c, rec, absatzOverride);
  try {
    await sendMail(env, { to: c.email, subject: mail.subject, html: mail.html, headers: mail.headers });
  } catch (err) {
    rec.versuche = (rec.versuche || 0) + 1;
    rec.fehler = String(err && err.message ? err.message : err).slice(0, 200);
    await env.VOUCHERS.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 800 });
    throw err;
  }
  rec.status = 'gesendet';
  rec.gesendet = new Date().toISOString();
  delete rec.fehler;
  await env.VOUCHERS.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 800 });
  return 'gesendet';
}

/* ---------- Variante B: KI-Entwurf zur Freigabe (vorbereitet, standardmäßig aus) ---------- */

/**
 * Datensparsam: an den KI-Dienst gehen nur Vorname, Zahl der Termine und Wochen seit dem
 * letzten Termin. Das Freitextfeld (Ziele, Beschwerden …) wird NIE übertragen.
 */
async function wvKiAbsatz(env, S, c) {
  if (!S.kiAktiv || !env.ANTHROPIC_API_KEY) return null;
  const wochen = Math.max(1, Math.round((Date.now() - new Date(`${c.letzterTermin}T12:00:00Z`).getTime()) / (7 * 864e5)));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: S.kiModell,
      max_tokens: 300,
      system: 'Du schreibst für einen Personal Trainer in Solingen einen kurzen, persönlichen Absatz für eine Mail an einen ' +
        'bisherigen Kunden. Du-Form, locker, ehrlich, höchstens drei Sätze, kein Marketing-Sprech, keine Ausrufezeichen-Ketten, ' +
        'keine Versprechen, keine Anspielung auf Gesundheit. Beginne mit „Hey <Vorname>,“. Erwähne den Rabatt nicht – der steht ' +
        'unter deinem Absatz. Gib nur den Absatz aus.',
      messages: [{
        role: 'user',
        content: `Vorname: ${c.vorname}\nBisherige Einzeltermine: ${c.anzahl}\nDer letzte Termin war vor etwa ${wochen} Wochen.`,
      }],
    }),
  });
  if (!res.ok) { console.error('KI-Entwurf fehlgeschlagen', res.status); return null; }
  const data = await res.json().catch(() => ({}));
  const text = data && data.content && data.content[0] && data.content[0].text;
  return text ? String(text).trim().slice(0, 700) : null;
}

async function wvEntwurfAblegen(env, S, c) {
  const key = `wv:entwurf:${c.bookingId}`;
  if (await env.VOUCHERS.get(key)) return 'schon';
  const text = (await wvKiAbsatz(env, S, c)) || wvAbsatzText(S, c);
  await env.VOUCHERS.put(key, JSON.stringify({
    status: 'offen', bookingId: c.bookingId, email: c.email, name: c.name, vorname: c.vorname,
    letzterTermin: c.letzterTermin, text, erstellt: new Date().toISOString(), quelle: S.kiAktiv ? 'ki' : 'vorlage',
  }), { expirationTtl: 60 * 60 * 24 * 90 });
  const cfg = config(env);
  await sendMail(env, {
    to: cfg.ownerEmail,
    subject: `Entwurf zur Freigabe: Wiedervorlage an ${c.vorname || c.name}`,
    html: mailShell('Entwurf zur Freigabe',
      `<p style="margin:0 0 14px">Für ${esc(c.name)} liegt ein Entwurf bereit. Es geht erst etwas raus, wenn du ihn in der Verwaltung freigibst.</p>
       <p style="margin:0 0 14px"><a href="${esc(cfg.siteOrigin)}/admin.html" style="color:#EFB92E">Verwaltung &ouml;ffnen &rarr; Reiter Wiedervorlage</a></p>`, env),
  });
  return 'entwurf';
}

/* ---------- Verwaltung ---------- */

async function wvAdmin(path, url, request, env, body) {
  switch (path) {
    case 'state': return wvAdminState(env);
    case 'settings': return wvAdminSettings(body, env);
    case 'trockenlauf': {
      const S = await wvSettings(env);
      const rep = await wvRun(env, S, { senden: false });
      return json(rep);
    }
    case 'testmail': return wvAdminTestmail(body, env);
    case 'mailtest': return wvAdminMailtest(body, env);
    case 'einwilligung': return wvAdminConsent(body, env, true);
    case 'einwilligung-loeschen': return wvAdminConsent(body, env, false);
    case 'optout': return wvAdminOptout(body, env, true);
    case 'optout-loeschen': return wvAdminOptout(body, env, false);
    case 'entwurf-freigeben': return wvAdminEntwurf(body, env, true);
    case 'entwurf-verwerfen': return wvAdminEntwurf(body, env, false);
    default: return json({ error: 'Unbekannte Aktion.' }, 404);
  }
}

async function wvAdminState(env) {
  const S = await wvSettings(env);
  const last = await wvReadJson(env, 'wv:last');
  const [oo, co, ed] = await Promise.all([
    wvListAll(env, 'wv:optout:'), wvListAll(env, 'wv:consent:'), wvListAll(env, 'wv:entwurf:'),
  ]);
  const optouts = [];
  for (const k of oo) { const v = await wvReadJson(env, k.name); optouts.push({ email: k.name.slice('wv:optout:'.length), at: v && v.at, quelle: v && v.quelle }); }
  const consents = [];
  for (const k of co) { const v = await wvReadJson(env, k.name); consents.push({ email: k.name.slice('wv:consent:'.length), at: v && v.at, notiz: v && v.notiz }); }
  const entwuerfe = [];
  for (const k of ed) { const v = await wvReadJson(env, k.name); if (v && v.status === 'offen') entwuerfe.push(v); }
  return json({
    settings: S, defaults: { vorlageMitWunsch: WV_DEFAULTS.vorlageMitWunsch, vorlageNeutral: WV_DEFAULTS.vorlageNeutral, betreff: WV_DEFAULTS.betreff },
    last, optouts, consents, entwuerfe,
    technik: {
      stripe: !!env.STRIPE_SECRET_KEY, resend: !!env.RESEND_API_KEY, secret: !!wvSecret(env),
      ki: !!env.ANTHROPIC_API_KEY, apiOrigin: wvApiOrigin(env),
      stripeTestmodus: String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test_') || String(env.STRIPE_SECRET_KEY || '').startsWith('rk_test_'),
    },
  });
}

async function wvAdminSettings(body, env) {
  const cur = await wvSettings(env);
  const next = wvNormalizeSettings({ ...cur, ...(body.settings || {}) });
  await env.VOUCHERS.put('wv:settings', JSON.stringify(next));
  return json({ ok: true, settings: next });
}

async function wvAdminTestmail(body, env) {
  const S = await wvSettings(env);
  const cfg = config(env);
  const echt = body.mitStripe === true;
  const c = {
    email: cfg.ownerEmail, name: 'Test Kunde', vorname: clean(body.vorname, 40) || 'Test',
    letzterTermin: wvAddDays(wvBerlinDate(Date.now()), -S.wochen * 7), anzahl: 3,
    wunschOk: body.wunsch ? true : false, wunsch: clean(body.wunsch, 140),
    bookingId: `test-${randomToken(6)}`,
  };
  if (!wvSecret(env)) return json({ error: 'Weder WV_SECRET noch ADMIN_PASSWORT gesetzt.' }, 400);
  let promo = {
    code: `${S.codePrefix}-TEST00`, validUntil: wvAddDays(wvBerlinDate(Date.now()), S.gueltigWochen * 7),
  };
  if (echt) {
    const p = await wvCreatePromo(env, S, { bookingId: c.bookingId });
    if (p.error) return json({ error: p.error }, 502);
    promo = p;
  }
  const mail = await wvMailBauen(env, S, c, promo, body.absatz ? String(body.absatz).slice(0, 700) : '');
  await sendMail(env, {
    to: cfg.ownerEmail, subject: `[TEST] ${mail.subject}`, html: mail.html, headers: mail.headers,
  });
  return json({ ok: true, code: promo.code, echterCode: echt });
}

async function wvAdminConsent(body, env, on) {
  const email = wvEmailKey(body.email);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  if (on) {
    await env.VOUCHERS.put(`wv:consent:${email}`, JSON.stringify({
      at: new Date().toISOString(), notiz: clean(body.notiz, 200) || 'mündlich erteilt',
    }));
  } else {
    await env.VOUCHERS.delete(`wv:consent:${email}`);
  }
  return json({ ok: true });
}

async function wvAdminOptout(body, env, on) {
  const email = wvEmailKey(body.email);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  if (on) await env.VOUCHERS.put(`wv:optout:${email}`, JSON.stringify({ at: new Date().toISOString(), quelle: 'von Hand' }));
  else await env.VOUCHERS.delete(`wv:optout:${email}`);
  return json({ ok: true });
}

async function wvAdminEntwurf(body, env, freigeben) {
  const id = String(body.id || '');
  if (!/^[a-z0-9]{8,40}$/.test(id)) return json({ error: 'Unbekannter Entwurf.' }, 400);
  const key = `wv:entwurf:${id}`;
  const e = await wvReadJson(env, key);
  if (!e || e.status !== 'offen') return json({ error: 'Der Entwurf ist nicht mehr offen.' }, 404);
  if (!freigeben) {
    e.status = 'verworfen';
    await env.VOUCHERS.put(key, JSON.stringify(e), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true });
  }
  const S = await wvSettings(env);
  const c = { email: e.email, name: e.name, vorname: e.vorname, bookingId: e.bookingId, letzterTermin: e.letzterTermin };
  const text = String(body.text || e.text).slice(0, 700);
  const r = await wvSenden(env, S, c, text);
  e.status = r === 'gesendet' ? 'freigegeben' : 'verworfen';
  await env.VOUCHERS.put(key, JSON.stringify(e), { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ ok: true, ergebnis: r });
}

/* ---------- Test aller Kundenmails (nur an die Inhaber-Adresse, mit Beispieldaten) ---------- */

function wvSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Schickt jede Kundenmail einmal mit Beispieldaten an die Inhaber-Adresse.
 * Sicherheitsnetz: sendMail/kursSendMail leiten im Testmodus (env.__testTo) immer dorthin um.
 * Es wird nichts gebucht, bezahlt, in den Kalender geschrieben oder im Speicher angelegt.
 */
async function wvAdminMailtest(body, env) {
  const cfg = config(env);
  const to = cfg.ownerEmail;
  if (!to) return json({ error: 'Keine Inhaber-Adresse hinterlegt.' }, 400);
  if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY fehlt.' }, 400);
  const S = await wvSettings(env);
  const heute = wvBerlinDate(Date.now());
  const d1 = wvAddDays(heute, 3), d2 = wvAddDays(heute, 10), d3 = wvAddDays(heute, 17);
  const morgen = wvAddDays(heute, 1);
  const name = 'Test Kunde';

  const mk = (id, date, start, end, extra) => ({
    id, token: 'testtoken', date, start, end, city: 'Solingen', place: 'Studio Solingen-Ohligs',
    type: 'training', label: 'Personal Training', name, email: to, phone: '0177 0000000', note: '',
    price_cents: S.trainingCents || 11900, open_cents: S.trainingCents || 11900, status: 'confirmed', pay_status: 'paid',
    ...extra,
  });
  const b1 = mk('testbooking01', d1, '17:15', '18:15', { promo_code: `${S.codePrefix}-TEST00`, promo_cents: S.rabattCents, open_cents: Math.max(0, (S.trainingCents || 11900) - S.rabattCents) });
  const b2 = mk('testbooking02', d2, '17:15', '18:15', {});
  const b3 = mk('testbooking03', d3, '17:15', '18:15', {});
  const probe = mk('testbooking04', d1, '09:00', '10:00', { type: 'probe', label: 'Probetraining', price_cents: 2900, open_cents: 2900 });
  const remind = mk('testbooking05', morgen, '17:15', '18:15', {});
  const old = mk('testbooking06', d1, '17:15', '18:15', {});
  const verschoben = mk('testbooking06', d2, '18:30', '19:30', {});
  const card = { code: 'FD-TEST-KARTE', label: '8er-Karte', sessions_total: 8, sessions_used: 3, unit_cents: 10900, amount_cents: 87200, expires: wvAddDays(heute, 365), buyer_name: name, buyer_email: to, kind: 'karte' };
  const gutschein = { design: xmDesign(body && body.design), pdf: body && body.pdf ? '1' : '', bastel: body && body.bastel ? '1' : '', code: 'FD-TEST-GUTS', amount_cents: 5000, buyer_name: name, buyer_email: to, recipient_name: 'Test Beschenkte', gift_email: to, message: 'Alles Gute zum Geburtstag!', expires: wvAddDays(heute, 365), token: 'testtoken', delivery: 'gift', send_date: '' };
  const rechnung = { id: 'in_test', number: 'FD-TEST-0001', customer_email: to, amount_paid: S.trainingCents || 11900, hosted_invoice_url: `${cfg.siteOrigin}/`, lines: { data: [{ description: `Personal Training am ${fmtDate(d1)} um 17:15 Uhr in Solingen` }] } };

  const tenv = Object.assign(Object.create(env), { __testTo: to, __testPrefix: '[TEST] ' });
  const kurs = { id: 'test', titel: 'Functional Training', ort: 'New Forge', adresse: 'Prinzenstraße 2a, 42697 Solingen', wochentag: kursWochentag(d1), start: '18:00', minuten: 60, start_datum: d1, end_datum: d3 };
  const p = kursProvider('niklas');
  const o = {
    id: 'testorder', token: 'testtoken', kunde: { name, email: to, phone: '0177 0000000' }, art: 'karte5', label: '5er-Karte',
    termine: [d1, d2, d3], offen_cents: 6900, gueltig_bis: wvAddDays(heute, 120), widerruf_ausgeschlossen: true, widerruf_hinweis_at: new Date().toISOString(),
  };
  const w = { name, email: to, token: 'testwait', angebot_bis: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
  const t1 = kursTerminAm(kurs, d1), t2 = kursTerminAm(kurs, d2);
  const promo = { code: `${S.codePrefix}-TEST00`, validUntil: wvAddDays(heute, S.gueltigWochen * 7) };
  const wvc = { email: to, name, vorname: 'Niklas', letzterTermin: wvAddDays(heute, -S.wochen * 7), anzahl: 3, wunschOk: true, wunsch: 'deine Kraft zu steigern', bookingId: `test-${randomToken(6)}` };

  const liste = [
    ['Termin bestätigt (mit Aktionscode, mehrere Termine)', () => sendBookingMail(b1, tenv, null, [b1, b2, b3])],
    ['Probetraining bestätigt (mit Anrechnungscode)', () => sendBookingMail(probe, tenv, { code: 'FD-TEST-ANRECH', amount: 2900, expires: wvAddDays(heute, 120) }, [probe])],
    ['Karte aktiv (mit zwei Terminen)', () => sendCardMail(card, tenv, [b2, b3])],
    ['Karte: mehrere Termine bestätigt', () => sendCardBookingsMail([b1, b2, b3], card, tenv, [b1, b2, b3])],
    ['Erinnerung am Vortag', () => sendReminderMail(remind, tenv)],
    ['Termin verschoben', () => sendMovedMail(verschoben, old, tenv)],
    ['Termin abgesagt', () => sendCancelMail(b1, tenv, 'Ich bin leider krank geworden.')],
    ['Gutschein: Kopie für den Käufer', () => sendBuyerMail({ ...gutschein, delivery: body && (body.pdf || body.bastel) ? 'buyer' : 'gift' }, tenv)],
    ['Gutschein: Mail an Beschenkte', () => sendGiftMail(gutschein, tenv)],
    ['Rechnung', () => sendInvoiceMail(rechnung, tenv)],
    ['Wiedervorlage (mit Wunsch)', async () => { const m = await wvMailBauen(tenv, S, wvc, promo, ''); await sendMail(tenv, { to, subject: m.subject, html: m.html, headers: m.headers }); }],
    ['Kurs gebucht', () => kursMailBestaetigung(tenv, p, kurs, o)],
    ['Kurs fällt aus (mit Ersatztermin)', () => kursMailAbsage(tenv, p, kurs, o, d1, { modus: 'ersatz', grund: 'Die Trainerin ist krank.' }, t2)],
    ['Kurs fällt aus (Erstattung)', () => kursMailAbsage(tenv, p, kurs, o, d1, { modus: 'erstattung', grund: '' }, null)],
    ['Kurs: Erstattung veranlasst', () => kursMailErstattet(tenv, p, kurs, { ...o, gutschein: null }, { datum: d1, cents_bar: 1380, cents_gutschein: 0 })],
    ['Kurs: Warteliste', () => kursMailWarteliste(tenv, p, kurs, t1, w)],
    ['Kurs: Platz frei', () => kursMailAngebot(tenv, p, kurs, t1, w, 1800)],
    ['Kurs: Erinnerung am Vortag', () => kursMailErinnerung(tenv, p, kurs, t1, { name, email: to }, o)],
  ];

  const nur = Array.isArray(body && body.nur) ? body.nur.map(Number) : null;
  const ergebnis = [];
  for (let i = 0; i < liste.length; i++) {
    if (nur && !nur.includes(i + 1)) continue;
    const [titel, fn] = liste[i];
    try { await fn(); ergebnis.push({ nr: i + 1, titel, ok: true }); }
    catch (err) { ergebnis.push({ nr: i + 1, titel, ok: false, fehler: String(err && err.message ? err.message : err).slice(0, 200) }); }
    await wvSleep(700);
  }
  return json({ ok: true, an: to, ergebnis });
}

/* ================================================================== */
/* KUNDEN (neu in worker-code-11): Kundenprofil + Mail-Verlauf           */
/* ================================================================== */
/*
 * Verwaltung, Reiter „Kunden“. Fasst pro E-Mail-Adresse zusammen, was im Speicher liegt:
 * Termine, Karten/Gutscheine, Kursbestellungen, Widerrufe und alle gesendeten Mails.
 *
 * KV-Schlüssel (neu):
 *   maillog:<mail>:<zeitstempel>:<kennung>   { to, subject, from, ts, html, anhaenge[], resend_id }
 *                                            Metadaten: { s: Betreff, t: Zeit, a: Art, r: Resend-ID }
 *                                            läuft nach 3 Jahren von selbst ab (expirationTtl)
 *
 * Mails an die Inhaber-Adresse (Benachrichtigungen) und Testmails werden nicht protokolliert.
 * Ein Fehler beim Protokollieren darf nie den Mailversand stören.
 */

const KUNDEN_MAIL_TTL = 3 * 365 * 24 * 3600;
const KUNDEN_MAIL_MAXHTML = 200000;
const KUNDEN_ANBIETERIN = 'niklas';

function kundenMailArt(subject, headers) {
  const s = String(subject || '');
  if (/widerruf/i.test(s)) return 'Widerruf';
  if (/rechnung/i.test(s)) return 'Rechnung';
  if (headers && Object.keys(headers).some((h) => /^list-unsubscribe$/i.test(h))) return 'Wiedervorlage';
  if (/^Morgen\s/i.test(s)) return 'Erinnerung';
  if (/verschoben/i.test(s)) return 'Verschoben';
  if (/ausfallen|fällt aus|erstattung/i.test(s)) return 'Absage';
  if (/warteliste|platz frei/i.test(s)) return 'Warteliste';
  if (/bestätigt/i.test(s)) return 'Bestätigung';
  if (/gutschein/i.test(s)) return 'Gutschein';
  if (/karte/i.test(s)) return 'Karte';
  return 'Nachricht';
}

/** Protokolliert eine gesendete Mail. Wirft nie. */
async function kundenMailLog(env, m) {
  try {
    if (!env || !env.VOUCHERS || env.__testTo) return;
    const to = String(m.to || '').trim().toLowerCase();
    if (!to || to.length > 200) return;
    const owner = String(env.OWNER_EMAIL || CONFIG.ownerEmail || '').toLowerCase();
    if (to === owner) return;
    const ts = m.ts || new Date().toISOString();
    const kennung = String(m.resend_id || randomToken(6)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || randomToken(6);
    const subject = String(m.subject || '').slice(0, 300);
    let html = String(m.html || '');
    if (html.length > KUNDEN_MAIL_MAXHTML) html = html.slice(0, KUNDEN_MAIL_MAXHTML) + '<!-- gekürzt -->';
    const art = kundenMailArt(subject, m.headers);
    const rec = {
      to, subject, from: String(m.from || ''), ts, html,
      anhaenge: (m.attachments || []).map((a) => String(a && a.filename || 'Anhang').slice(0, 120)),
      resend_id: m.resend_id || '', art,
    };
    await env.VOUCHERS.put(`maillog:${to}:${ts}:${kennung}`, JSON.stringify(rec), {
      expirationTtl: KUNDEN_MAIL_TTL,
      metadata: { s: subject.slice(0, 160), t: ts, a: art, r: m.resend_id || '' },
    });
    // Ab wann es ein Protokoll gibt (nur für die Anzeige „Mails ab …“)
    if (!m.nachgeladen && !(await env.VOUCHERS.get('kunden:logstart'))) await env.VOUCHERS.put('kunden:logstart', ts);
  } catch (err) {
    console.error('Mail-Protokoll', err);
  }
}

async function kundenListAll(env, prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 40; i++) {
    const res = await env.VOUCHERS.list({ prefix, cursor, limit: 1000 });
    for (const k of res.keys) out.push(k);
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

async function kundenGetMany(env, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 25) {
    const part = await Promise.all(keys.slice(i, i + 25).map(async (k) => {
      try {
        const raw = await env.VOUCHERS.get(k.name || k);
        return raw ? { key: k.name || k, v: JSON.parse(raw) } : null;
      } catch (e) {
        return null;
      }
    }));
    for (const p of part) if (p) out.push(p);
  }
  return out;
}

function kundenMail(v) { return String(v || '').trim().toLowerCase(); }

/** Liest alles, was zu Kunden gehört, einmal ein. */
async function kundenScan(env) {
  const [bk0, vc, wd, kd, ml, vf] = await Promise.all([
    kundenListAll(env, 'booking:'),
    kundenListAll(env, 'voucher:'),
    kundenListAll(env, 'widerruf:'),
    kundenListAll(env, K.kundePrefix(KUNDEN_ANBIETERIN)),
    kundenListAll(env, 'maillog:'),
    kundenListAll(env, 'verfallen:'),
  ]);
  const bk = bk0.concat(vf);   // verfallene (kurzfristig abgesagte) Termine zählen auf der Karte weiter
  const [bookings, vouchers, widerrufe, kurskunden] = await Promise.all([
    kundenGetMany(env, bk), kundenGetMany(env, vc), kundenGetMany(env, wd), kundenGetMany(env, kd),
  ]);
  return {
    bookings: bookings.map((x) => x.v).filter((b) => b && b.email && b.date && b.status !== 'pending' && b.status !== 'abgebrochen'),
    vouchers: vouchers.map((x) => x.v).filter((v) => v && v.code),
    widerrufe: widerrufe.map((x) => x.v).filter((w) => w && w.email),
    kurskunden: kurskunden.map((x) => x.v).filter((k) => k && k.email),
    mails: ml,
  };
}

function kundenMailAusKey(name) {
  // maillog:<mail>:<zeit>:<kennung> – die Mailadresse enthält nie einen Doppelpunkt
  const p = String(name).split(':');
  return p[1] || '';
}

async function kundenListe(url, env) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const scan = await kundenScan(env);
  const today = isoDate(new Date());
  const map = new Map();
  const get = (email) => {
    let c = map.get(email);
    if (!c) { c = { email, name: '', phone: '', termine: 0, kommend: '', karten: 0, kurse: 0, mails: 0, last: '' }; map.set(email, c); }
    return c;
  };
  const touch = (c, iso) => { if (iso && String(iso) > c.last) c.last = String(iso); };

  for (const b of scan.bookings) {
    const c = get(kundenMail(b.email));
    c.name = c.name || b.name || '';
    c.phone = c.phone || b.phone || '';
    if (b.status === 'confirmed') {
      c.termine++;
      if (b.date >= today && (!c.kommend || b.date < c.kommend)) c.kommend = b.date;
    }
    touch(c, b.created || b.date);
  }
  for (const v of scan.vouchers) {
    const e = kundenMail(v.buyer_email);
    if (e) { const c = get(e); c.name = c.name || v.buyer_name || ''; c.karten++; touch(c, v.created); }
    const g = kundenMail(v.gift_email);
    if (g && g !== e) { const c = get(g); c.name = c.name || v.recipient_name || ''; c.karten++; touch(c, v.created); }
  }
  for (const k of scan.kurskunden) {
    const c = get(kundenMail(k.email));
    c.name = c.name || k.name || '';
    c.phone = c.phone || k.telefon || '';
    c.kurse += (k.bestellungen || []).length;
    touch(c, k.updated || k.created);
  }
  for (const w of scan.widerrufe) {
    const c = get(kundenMail(w.email));
    c.name = c.name || w.name || '';
    touch(c, w.received);
  }
  for (const m of scan.mails) {
    const e = kundenMailAusKey(m.name);
    if (!e) continue;
    const c = get(e);
    c.mails++;
    touch(c, m.metadata && m.metadata.t);
  }

  let out = [...map.values()];
  if (q) out = out.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().indexOf(q) !== -1);
  out.sort((a, b) => String(b.last).localeCompare(String(a.last)));
  return json({ kunden: out.slice(0, 200), total: out.length });
}

async function kundenProfil(url, env) {
  const email = kundenMail(url.searchParams.get('email'));
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const scan = await kundenScan(env);

  const termine = scan.bookings.filter((b) => kundenMail(b.email) === email)
    .map((b) => ({
      id: b.id, date: b.date, orig_date: b.orig_date || b.date, start: b.start, end: b.end, label: b.label || '',
      city: b.city || '', place: b.place || '', status: b.status || '', paid: payLabel(b), pay_status: b.pay_status || '',
      note: b.note || '', card_code: b.card_code || '', voucher_code: b.voucher_code || '', promo_code: b.promo_code || '',
      created: b.created || '', name: b.name || '', phone: b.phone || '', slot_id: b.slot_id || '', minutes: b.minutes || 0,
    }))
    .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const zaehl = kartenZaehlungAus(scan.bookings);   // TERMIN-HOOK

  const karten = scan.vouchers.filter((v) => kundenMail(v.buyer_email) === email || kundenMail(v.gift_email) === email)
    .map((v) => {
      const istKarte = v.kind === 'karte';
      return {
        kind: istKarte ? 'karte' : 'gutschein',
        rolle: kundenMail(v.buyer_email) === email ? 'Käufer:in' : 'Beschenkte:r',
        code: v.code,
        label: istKarte ? v.label : (v.origin === 'probetraining' ? 'Probetraining-Gutschrift' : 'Wertgutschein'),
        rest: istKarte ? `${(v.sessions_total || 0) - (v.sessions_used || 0)} von ${v.sessions_total || 0} Einheiten`
          : `${fmtEur((v.amount_cents || 0) - (v.redeemed_cents || 0))} von ${fmtEur(v.amount_cents || 0)}`,
        expires: v.expires || '', status: v.status || '', created: v.created || '',
        einloesungen: (v.redemptions || []).length,
        ...(istKarte ? (() => { const s = kartenStand(v, zaehl.get(v.code)); return { absolviert: s.done, kommend: s.upcoming, manuell: s.manuell, frei: s.free, gesamt: v.sessions_total || 0, expires_iso: v.expires || '' }; })() : {}),   // TERMIN-HOOK
      };
    })
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));

  const widerrufe = scan.widerrufe.filter((w) => kundenMail(w.email) === email)
    .map((w) => ({ received: w.received, vertrag: w.vertrag || '', nachricht: w.nachricht || '' }));

  // Kurse: über das Kundenprofil des Kursmoduls
  const kurse = [];
  const kk = scan.kurskunden.find((k) => kundenMail(k.email) === email);
  if (kk && (kk.bestellungen || []).length) {
    const bs = await kundenGetMany(env, kk.bestellungen.map((id) => K.bestellung(KUNDEN_ANBIETERIN, id)));
    for (const { v: o } of bs) {
      if (o.status === 'abgebrochen' || o.status === 'reserviert') continue;
      kurse.push({
        id: o.id, kurs: o.kurs_titel || '', art: o.label || o.art || '', termine: o.termine || [],
        preis: fmtEur(o.preis_cents || 0), bezahlt: fmtEur(o.offen_cents || 0), status: o.status || '', pay_status: o.pay_status || '',
        created: o.created || '', erstattungen: (o.erstattungen || []).length,
      });
    }
    kurse.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }

  const mails = scan.mails.filter((m) => kundenMailAusKey(m.name) === email)
    .map((m) => ({ key: m.name, ts: (m.metadata && m.metadata.t) || '', subject: (m.metadata && m.metadata.s) || '', art: (m.metadata && m.metadata.a) || '' }))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  const [consent, optout] = await Promise.all([
    env.VOUCHERS.get(`wv:consent:${email}`), env.VOUCHERS.get(`wv:optout:${email}`),
  ]);

  const erste = termine[0] || {};
  const vname = (scan.vouchers.find((v) => kundenMail(v.buyer_email) === email && v.buyer_name) || {}).buyer_name || '';
  const wname = (scan.widerrufe.find((w) => kundenMail(w.email) === email && w.name) || {}).name || '';
  return json({
    email, name: erste.name || (kk && kk.name) || vname || wname || '', phone: erste.phone || (kk && kk.telefon) || '',
    termine, karten, kurse, widerrufe, mails,
    wv: { einwilligung: !!consent, abgemeldet: !!optout },
    mails_ab: await env.VOUCHERS.get('kunden:logstart') || '',
  });
}

async function kundenMailAnzeigen(url, env) {
  const key = String(url.searchParams.get('key') || '');
  if (key.indexOf('maillog:') !== 0 || key.length > 400) return json({ error: 'Unbekannte Mail.' }, 400);
  const raw = await env.VOUCHERS.get(key);
  if (!raw) return json({ error: 'Diese Mail ist nicht mehr gespeichert.' }, 404);
  const m = JSON.parse(raw);
  return json({ to: m.to, from: m.from, subject: m.subject, ts: m.ts, art: m.art || '', html: m.html || '', anhaenge: m.anhaenge || [] });
}

/**
 * Ältere Mails aus Resend nachladen (Mails, die vor der Protokollierung rausgingen).
 * Holt bei jedem Aufruf eine kleine Menge (Resend erlaubt nur 2 Anfragen pro Sekunde) und gibt
 * einen Zeiger für den nächsten Aufruf zurück. Braucht einen Resend-Schlüssel mit Leserechten –
 * mit einem reinen Sende-Schlüssel meldet Resend einen Fehler, der dann angezeigt wird.
 */
async function kundenNachladen(body, env) {
  if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY fehlt.' }, 503);
  const owner = String(env.OWNER_EMAIL || CONFIG.ownerEmail || '').toLowerCase();
  const head = { Authorization: `Bearer ${env.RESEND_API_KEY}` };
  const after = String(body.after || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  const lres = await fetch(`https://api.resend.com/emails?limit=10${after ? '&after=' + after : ''}`, { headers: head });
  if (!lres.ok) {
    const t = await lres.text();
    return json({ error: `Resend meldet ${lres.status}. ${lres.status === 401 || lres.status === 403 ? 'Der Schlüssel darf vermutlich nur senden, nicht lesen. ' : ''}${t.slice(0, 200)}` }, 502);
  }
  const ld = await lres.json();
  const liste = ld.data || [];

  const bekannt = new Set();
  for (const m of await kundenListAll(env, 'maillog:')) if (m.metadata && m.metadata.r) bekannt.add(m.metadata.r);

  let neu = 0, uebersprungen = 0, fehler = 0;
  for (const e of liste) {
    const to = kundenMail(Array.isArray(e.to) ? e.to[0] : e.to);
    if (!e.id || !to || to === owner || bekannt.has(e.id)) { uebersprungen++; continue; }
    await kursSleep(600);
    const dres = await fetch(`https://api.resend.com/emails/${encodeURIComponent(e.id)}`, { headers: head });
    if (!dres.ok) { fehler++; continue; }
    const d = await dres.json();
    await kundenMailLog(env, {
      to, subject: d.subject || e.subject, html: d.html || (d.text ? `<pre style="white-space:pre-wrap">${esc(d.text)}</pre>` : ''),
      from: d.from || e.from, ts: d.created_at || e.created_at || new Date().toISOString(), resend_id: e.id, nachgeladen: true,
    });
    neu++;
  }
  const letzte = liste.length ? liste[liste.length - 1].id : '';
  return json({ ok: true, neu, uebersprungen, fehler, weiter: !!ld.has_more && !!letzte, after: letzte });
}

async function kundenAdmin(path, url, request, env, body) {
  if (path === 'liste' && request.method === 'GET') return kundenListe(url, env);
  if (path === 'profil' && request.method === 'GET') return kundenProfil(url, env);
  if (path === 'mail' && request.method === 'GET') return kundenMailAnzeigen(url, env);
  if (path === 'nachladen' && request.method === 'POST') return kundenNachladen(body, env);
  return json({ error: 'Unbekannte Aktion.' }, 404);
}

/* ------------------------------------------------------------------ */
/* PUSH – Mitteilungen auf das Handy (Web Push, Standard RFC 8030/8291/8292) */
/* ------------------------------------------------------------------ */
/*
 * Jede Mail, die an Niklas selbst geht (neue Buchung, verschoben, Karte oder Gutschein
 * verkauft, Widerruf, Kursbuchung, Lastschrift …), löst zusätzlich eine Push-Meldung aus.
 * Die Meldung ist Ende-zu-Ende verschlüsselt (nur das Gerät kann sie lesen).
 *
 * KV:  push:vapid          – Schlüsselpaar des Servers (wird beim ersten Aufruf erzeugt)
 *      push:sub:<hash>     – ein Gerät (Endpoint + Schlüssel)
 * Verwaltung: GET push/key · POST push/subscribe · POST push/unsubscribe · POST push/test
 */

const PUSH_SUBJECT = 'mailto:info@fitnessdonner.de';
const PUSH_TTL = 24 * 3600;

function pushB64uToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pushBytesToB64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pushConcat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Schlüsselpaar des Servers (VAPID). Wird einmalig erzeugt und im KV gehalten. */
async function pushVapid(env) {
  const raw = await env.VOUCHERS.get('push:vapid');
  if (raw) { try { const v = JSON.parse(raw); if (v && v.pub && v.jwk) return v; } catch (e) { /* neu erzeugen */ } }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = pushBytesToB64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const v = { pub, jwk, created: new Date().toISOString() };
  await env.VOUCHERS.put('push:vapid', JSON.stringify(v));
  return v;
}

async function pushJwt(vapid, endpoint) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => pushBytesToB64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const claims = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUBJECT });
  const key = await crypto.subtle.importKey('jwk', vapid.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head + '.' + claims));
  return head + '.' + claims + '.' + pushBytesToB64u(sig);
}

async function pushHkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Verschlüsselt eine Nachricht für ein Gerät (aes128gcm, RFC 8291). fix = nur für Tests. */
async function pushEncrypt(sub, plain, fix) {
  const uaPublic = pushB64uToBytes(sub.keys.p256dh);
  const authSecret = pushB64uToBytes(sub.keys.auth);
  let asPriv, asPubRaw;
  if (fix && fix.asPrivateJwk) {
    asPriv = await crypto.subtle.importKey('jwk', fix.asPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPubRaw = fix.asPublicRaw;
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPriv = kp.privateKey;
    asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const salt = (fix && fix.salt) || crypto.getRandomValues(new Uint8Array(16));
  const te = new TextEncoder();
  const keyInfo = pushConcat(te.encode('WebPush: info\0'), uaPublic, asPubRaw);
  const ikm = await pushHkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await pushHkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await pushHkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = pushConcat(plain, new Uint8Array([2]));   // ein einziger Datensatz, Endmarke 0x02
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const rs = new Uint8Array([0, 0, 0x10, 0]);               // Datensatzgröße 4096
  return pushConcat(salt, rs, new Uint8Array([asPubRaw.length]), asPubRaw, cipher);
}

async function pushSubKey(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
  return 'push:sub:' + [...new Uint8Array(h)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function pushSubsListen(env) {
  const out = [];
  let cursor;
  do {
    const l = await env.VOUCHERS.list({ prefix: 'push:sub:', cursor });
    for (const k of l.keys) {
      const raw = await env.VOUCHERS.get(k.name);
      if (!raw) continue;
      try { out.push({ key: k.name, sub: JSON.parse(raw) }); } catch (e) { /* kaputt, ignorieren */ }
    }
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  return out;
}

/** Schickt eine Meldung an alle angemeldeten Geräte. Wirft nie. */
async function pushAnAdmin(env, msg) {
  const res = { gesendet: 0, entfernt: 0, fehler: 0 };
  try {
    const subs = await pushSubsListen(env);
    if (!subs.length) return res;
    const vapid = await pushVapid(env);
    const plain = new TextEncoder().encode(JSON.stringify({
      title: String(msg.title || 'Fitness Donner').slice(0, 80),
      body: String(msg.body || '').slice(0, 220),
      url: msg.url || '/admin.html',
    }));
    await Promise.all(subs.map(async ({ key, sub }) => {
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
        else { res.fehler++; console.error('Push abgelehnt', r.status, (await r.text()).slice(0, 200)); }
      } catch (e) {
        res.fehler++;
        console.error('Push fehlgeschlagen', e && e.message);
      }
    }));
  } catch (e) {
    console.error('Push-Fehler', e && e.message);
  }
  return res;
}

/** Aus dem Betreff einer Inhaber-Mail wird die Meldung: „Neue Buchung: Personal Training, …“ → Titel + Text. */
async function pushAusMail(env, subject) {
  try {
    if (env.__testTo) return;
    const s = String(subject || '').trim();
    if (!s || /^\[TEST\]/i.test(s)) return;
    const i = s.indexOf(': ');
    const title = i > 0 && i <= 40 ? s.slice(0, i) : 'Fitness Donner';
    const body = i > 0 && i <= 40 ? s.slice(i + 2) : s;
    await pushAnAdmin(env, { title, body });
  } catch (e) { /* Meldung darf nie den Versand stören */ }
}

async function pushAdmin(path, request, env, body) {
  if (path === 'key' && request.method === 'GET') {
    const v = await pushVapid(env);
    const subs = await pushSubsListen(env);
    return json({ ok: true, key: v.pub, geraete: subs.length });
  }
  if (path === 'subscribe' && request.method === 'POST') {
    const s = body && body.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) {
      return json({ error: 'Anmeldung unvollständig.' }, 400);
    }
    const key = await pushSubKey(s.endpoint);
    const alt = await env.VOUCHERS.get(key);
    let created = new Date().toISOString();
    if (alt) { try { created = JSON.parse(alt).created || created; } catch (e) { /* neu */ } }
    await env.VOUCHERS.put(key, JSON.stringify({
      endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) },
      ua: String(body.ua || '').slice(0, 160), created, updated: new Date().toISOString(),
    }));
    return json({ ok: true });
  }
  if (path === 'unsubscribe' && request.method === 'POST') {
    if (body && body.endpoint) await env.VOUCHERS.delete(await pushSubKey(body.endpoint));
    return json({ ok: true });
  }
  if (path === 'test' && request.method === 'POST') {
    const r = await pushAnAdmin(env, { title: 'Testmeldung', body: 'So sieht eine Meldung aus, wenn jemand bucht.' });
    return json({ ok: true, ...r });
  }
  return json({ error: 'Unbekannte Aktion.' }, 404);
}

/* ------------------------------------------------------------------ */
/* TERMIN – Verwaltung: Termine verschieben und von Hand eintragen, Kartenübersicht */
/* ------------------------------------------------------------------ */
/*
 * Verschieben: beliebiges Datum und beliebige Uhrzeit (keine Fristen wie bei der Selbstbedienung).
 *   Der alte Eintrag fliegt aus dem Google-Kalender, der neue kommt hinein, die Karteneinlösung zieht mit.
 * Eintragen: Termin für einen Kunden von Hand anlegen – mit Karte (eine Einheit wird abgezogen) oder bar.
 * Belegt ist belegt: Überschneidungen (Termin, Kurs, Sperre, Google-Kalender) melden sich als Warnung (409, konflikt:true)
 *   und gehen nur mit force:true. Derselbe Schlüssel (gleicher Tag, gleiche Zeit, gleiche Dauer) ist nie erlaubt.
 * Admin: GET termin/info · POST termin/verschieben · POST termin/eintragen
 */

function terminOrte() {
  const seen = new Set();
  const out = [];
  for (const a of AVAILABILITY) {
    const k = `${a.city}|${a.place}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ city: a.city, place: a.place });
  }
  return out;
}

function terminOrt(city, vorgabe) {
  const orte = terminOrte();
  return orte.find((o) => o.city === city) || (vorgabe && orte.find((o) => o.city === vorgabe.city)) || orte[0];
}

/** Datum, Beginn und Dauer prüfen – Ergebnis oder { error }. */
function terminZeit(body, vorgabeMinuten, vergangenOk) {
  const date = String(body.neuDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    return { error: 'Bitte ein Datum angeben.' };
  }
  const start = String(body.start || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return { error: 'Bitte eine Uhrzeit wie 18:30 angeben.' };
  const minutes = Math.round(Number(body.minutes) || vorgabeMinuten || 60);
  if (minutes < 15 || minutes > 240) return { error: 'Die Dauer muss zwischen 15 und 240 Minuten liegen.' };
  const bis = toMinutes(start) + minutes;
  if (bis >= 24 * 60) return { error: 'Der Termin würde über Mitternacht gehen.' };
  const end = fromMinutes(bis);
  if (!vergangenOk && berlinToUtc(date, start).getTime() <= Date.now()) return { error: 'Dieser Zeitpunkt liegt in der Vergangenheit.' };
  return { date, start, end, minutes };
}

/** Überschneidungen mit Terminen, Kursen, Sperren und Google-Kalender (der eigene alte Termin zählt nicht). */
async function terminKonflikte(env, date, start, end, eigene) {
  const taken = await takenState(env, date, date);
  const out = [];
  if (taken.blocked.has(date)) out.push('Dieser Tag ist gesperrt.');
  let busy = taken.busy.get(date) || [];
  if (eigene) busy = busy.filter(([f, t]) => !(f === eigene.from && t === eigene.to));
  const from = toMinutes(start), to = toMinutes(end);
  if (busy.some(([f, t]) => from < t && f < to)) {
    out.push('Zu dieser Zeit ist schon etwas belegt (anderer Termin, Kurs, Sperre oder Eintrag im Google-Kalender).');
  }
  return out;
}

async function terminInfo(env) {
  const cfg = await liveConfig(env);
  const today = isoDate(new Date());
  const list = await kundenListAll(env, 'voucher:');
  const cards = [];
  for (const x of await kundenGetMany(env, list)) {
    const v = x.v;
    if (!v || v.kind !== 'karte' || v.status !== 'active' || !v.expires || v.expires < today) continue;
    const left = (v.sessions_total || 0) - (v.sessions_used || 0);
    if (left <= 0) continue;
    cards.push({ code: v.code, label: v.label, name: v.buyer_name || '', email: v.buyer_email || '', left, total: v.sessions_total || 0, expires: v.expires });
  }
  cards.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  return json({ ok: true, orte: terminOrte(), cards, training_cents: cfg.trainingCents, kalender: calendarReady(env) });
}

async function terminVerschieben(body, env) {
  const date = String(body.date || '').slice(0, 10);
  const oldKey = `booking:${date}:${String(body.slotId || '')}`;
  const raw = await env.VOUCHERS.get(oldKey);
  if (!raw) return json({ error: 'Diesen Termin gibt es nicht (mehr).' }, 404);
  const b = JSON.parse(raw);
  if (b.status !== 'confirmed') return json({ error: 'Nur feste Buchungen lassen sich verschieben.' }, 409);

  const alteMinuten = b.minutes || (toMinutes(b.end) - toMinutes(b.start));
  const z = terminZeit({ neuDate: body.neuDate, start: body.start, minutes: body.minutes }, alteMinuten);
  if (z.error) return json({ error: z.error }, 400);
  const ort = terminOrt(body.ort, b);
  const slotId = `${slotPrefix(ort.city)}-${z.start.replace(':', '')}-${z.minutes}`;
  const newKey = `booking:${z.date}:${slotId}`;
  if (newKey === oldKey) return json({ error: 'Das ist der bisherige Termin.' }, 400);
  if (await env.VOUCHERS.get(newKey)) return json({ error: 'Genau zu dieser Zeit gibt es schon einen Termin.' }, 409);

  const eigene = z.date === b.date ? { from: toMinutes(b.start), to: toMinutes(b.end) } : null;
  const konflikte = await terminKonflikte(env, z.date, z.start, z.end, eigene);
  if (konflikte.length && body.force !== true) return json({ error: konflikte.join(' '), konflikt: true }, 409);

  const nb = Object.assign({}, b, {
    date: z.date, slot_id: slotId, start: z.start, end: z.end, minutes: z.minutes,
    city: ort.city, place: ort.place,
    orig_date: b.orig_date || b.date,
    moves: (b.moves || 0) + 1,
    moved_at: new Date().toISOString(),
    moved_from: `${b.date} ${b.start}`,
    moved_by: 'admin',
    reminded: false,
  });
  delete nb.gcal_id;

  await env.VOUCHERS.put(newKey, JSON.stringify(nb));
  await env.VOUCHERS.delete(oldKey);
  await indexBooking(nb, env);
  await markFree([oldKey], env);

  // Karte: Datum der eingelösten Einheit nachziehen
  if (nb.card_code) {
    const cr = await env.VOUCHERS.get(`voucher:${nb.card_code}`);
    if (cr) {
      const v = JSON.parse(cr);
      for (const red of v.redemptions || []) if (red.booking_id === nb.id) red.date = nb.date;
      await env.VOUCHERS.put(`voucher:${nb.card_code}`, JSON.stringify(v));
    }
  }

  let mail = false;
  try {
    await calendarRemove(b, env);
    await calendarInsert(nb, env);
  } catch (err) { console.error('Kalender beim Verschieben (Verwaltung)', err); }
  if (body.mail !== false) {
    try { await sendMovedMail(nb, b, env); mail = true; } catch (err) { console.error('Mail Verschieben (Verwaltung)', err); }
  }
  return json({ ok: true, date: nb.date, start: nb.start, end: nb.end, city: nb.city, mail, kalender: calendarReady(env) ? !!nb.gcal_id : null });
}

async function terminEintragen(body, env) {
  const cfg = await liveConfig(env);
  const mitKarte = body.art === 'karte';
  let name = clean(body.name, 80);
  let email = String(body.email || '').trim().toLowerCase();
  const phone = clean(body.phone, 40);
  let karte = null;

  if (mitKarte) {
    const v = await loadVoucher(body.code, env);
    if (v.error) return json({ error: v.error }, 400);
    if (v.kind !== 'karte') return json({ error: 'Das ist keine Karte.' }, 400);
    karte = v.voucher;
    name = name || clean(karte.buyer_name, 80);
    email = email || String(karte.buyer_email || '').trim().toLowerCase();
  }
  if (!name) return json({ error: 'Bitte einen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);

  const z = terminZeit({ neuDate: body.date, start: body.start, minutes: body.minutes }, 60, body.vergangen === true);
  if (z.error) return json({ error: z.error }, 400);
  const ort = terminOrt(body.ort, null);
  const slotId = `${slotPrefix(ort.city)}-${z.start.replace(':', '')}-${z.minutes}`;
  const key = `booking:${z.date}:${slotId}`;
  if (await env.VOUCHERS.get(key)) return json({ error: 'Genau zu dieser Zeit gibt es schon einen Termin.' }, 409);

  const konflikte = body.im_kalender === true ? [] : await terminKonflikte(env, z.date, z.start, z.end, null);
  if (konflikte.length && body.force !== true) return json({ error: konflikte.join(' '), konflikt: true }, 409);

  const booking = {
    id: randomToken(16),
    date: z.date, orig_date: z.date, slot_id: slotId, start: z.start, end: z.end, minutes: z.minutes,
    city: ort.city, place: ort.place,
    type: 'training', label: BOOKING_TYPES.training.label,
    name, email, phone, note: clean(body.note, 300),
    price_cents: cfg.trainingCents,
    voucher_code: '', card_code: karte ? karte.code : '', voucher_cents: karte ? cfg.trainingCents : 0,
    open_cents: 0,
    created: new Date().toISOString(), vorzeitig_at: '',
    status: 'confirmed', manuell: mitKarte ? 'karte' : 'bar',
    reminded: body.keine_erinnerung === true,
    ...(body.im_kalender === true && body.gcal_id ? { gcal_id: clean(body.gcal_id, 120) } : {}),
    ...(body.rechnung ? { rechnung: clean(body.rechnung, 60) } : {}),
  };
  await env.VOUCHERS.put(key, JSON.stringify(booking));
  await indexBooking(booking, env);
  if (karte) await applyVoucherRedemption(booking, env);

  let mail = false;
  if (!booking.gcal_id && body.im_kalender !== true) {
    try { await calendarInsert(booking, env); } catch (err) { console.error('Kalender (Eintragen)', err); }
  }
  if (body.mail !== false && body.vergangen !== true) {
    try {
      const alle = await upcomingFor(email, env);
      await sendBookingMail(booking, env, null, alle);
      mail = true;
    } catch (err) { console.error('Mail (Eintragen)', err); }
  }
  let rest = null;
  if (karte) {
    const cr = await env.VOUCHERS.get(`voucher:${karte.code}`);
    if (cr) { const v = JSON.parse(cr); rest = { left: (v.sessions_total || 0) - (v.sessions_used || 0), total: v.sessions_total || 0 }; }
  }
  return json({ ok: true, id: booking.id, date: booking.date, start: booking.start, end: booking.end, mail, karte: rest, kalender: calendarReady(env) ? !!booking.gcal_id : null });
}

/** Je Karte: wie viele Termine sind absolviert (vorbei) und wie viele noch kommend gebucht. */
function kartenZaehlungAus(bookings) {
  const out = new Map();
  const now = Date.now();
  for (const b of bookings) {
    if (!b || !b.card_code || (b.status !== 'confirmed' && b.status !== 'verfallen') || !b.date || !b.end) continue;
    const c = out.get(b.card_code) || { done: 0, upcoming: 0 };
    if (b.status === 'verfallen' || berlinToUtc(b.date, b.end).getTime() <= now) c.done++; else c.upcoming++;
    out.set(b.card_code, c);
  }
  return out;
}

async function kartenZaehlung(env) {
  const alle = await kundenGetMany(env, (await kundenListAll(env, 'booking:')).concat(await kundenListAll(env, 'verfallen:')));
  return kartenZaehlungAus(alle.map((x) => x.v));
}

/** Zahlen für eine Karte: absolviert, kommend, frei, und was ohne Termin abgezogen wurde. */
function kartenStand(v, z) {
  const total = v.sessions_total || 0, used = v.sessions_used || 0;
  const done = z ? z.done : 0, upcoming = z ? z.upcoming : 0;
  return { done, upcoming, free: Math.max(0, total - used), manuell: Math.max(0, used - done - upcoming) };
}

/** Kalendereintrag eines verfallenen Termins grau/durchsichtig markieren (bleibt als Nachweis, blockiert aber nichts). */
async function calendarMarkVerfallen(b, env) {
  if (!b.gcal_id || !calendarReady(env)) return;
  try {
    const token = await googleToken(env);
    if (!token) return;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events/${encodeURIComponent(b.gcal_id)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const ev = await res.json().catch(() => ({}));
    if (!ev || !ev.id) return;
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: `VERFALLEN (kurzfristig abgesagt): ${ev.summary || ''}`.slice(0, 250), transparency: 'transparent', colorId: '8' }),
    });
  } catch (err) {
    console.error('Kalender (Verfallen) fehlgeschlagen', err);
  }
}

async function sendVerfallenMail(b, env, grund) {
  const cfg = config(env);
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(b.name))},</p>
    <p style="margin:0 0 22px">dein Termin am <b>${esc(fmtDate(b.date))} um ${esc(b.start)} Uhr</b> in ${esc(b.city)} ist
      kurzfristig ausgefallen.${grund ? ' ' + esc(grund) : ''} Die Einheit wird deshalb auf deiner Karte verrechnet.</p>
    <p style="margin:0;font-size:14px">Fragen? ${esc(cfg.ownerPhone)} oder ${esc(cfg.ownerEmail)}</p>`;
  await sendMail(env, {
    to: b.email,
    subject: `Termin am ${fmtDate(b.date)} ist kurzfristig ausgefallen`,
    html: mailShell('Termin ausgefallen', inner, env),
  });
}

async function terminAdmin(path, url, request, env, body) {
  if (path === 'info' && request.method === 'GET') return terminInfo(env);
  if (path === 'verschieben' && request.method === 'POST') return terminVerschieben(body, env);
  if (path === 'eintragen' && request.method === 'POST') return terminEintragen(body, env);
  return json({ error: 'Unbekannte Aktion.' }, 404);
}

/* ------------------------------------------------------------------ */
/* KARTE – Karte im Kundenprofil ausstellen, Rechnung, Mail, Zahlart und SEPA-Mandat */
/* ------------------------------------------------------------------ */
/*
 * Neu in worker-code-15 (Haken: KARTE-HOOK).
 * Neu in worker-code-16: Zahlart "qr" (Vor Ort bezahlen): Rechnung mit Zahlungsseite, der Kunde bezahlt am eigenen Handy;
 *   GET rechnung/status?id= (Verwaltung fragt nach), POST rechnung/link-senden; die Karten-Mail geht erst raus, wenn gezahlt wird.
 *
 * KV:  kundenzahl:<mail>     – Zahlart des Kunden (lastschrift | ueberweisung | bar)
 *      rechnung:<stripe-id>  – jede Rechnung, die hier ausgestellt wurde (für Listen und Kartenansicht)
 *      rechnungsvorlage      – Texte der Rechnung und der Mail
 *
 * Verwaltung:
 *   GET  karte/optionen?email=   · POST karte/vorschau · POST karte/neu
 *   GET  rechnung/liste          · POST rechnung/bezahlt · GET/POST rechnung/vorlage
 *   POST kunden/zahlart          · POST kunden/mandat-link
 *   GET  kunden/liste, kunden/profil  (wie bisher, aber mit Zahlart, Mandat und Rechnungen)
 */

const KARTE_VORLAGE_STANDARD = {
  beschreibung: '{karte}: {einheiten} Einheiten Personal Training à {einheitspreis}',
  kopf: 'Steuernummer: 207/5043/2097',
  fuss: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  faellig_tage: 14,
  mail_betreff: 'Deine {karte} ist aktiv – Code {code}',
  mail_intro: 'deine neue {karte} wurde gebucht und ist ab sofort aktiv. Du kannst deine Termine einzeln buchen, wann immer es dir passt.',
  mail_lastschrift: 'Der Betrag von {betrag} wird in den nächsten Tagen per Lastschrift von deinem Konto eingezogen. Dafür musst du nichts weiter tun.',
  mail_ueberweisung: 'Bitte überweise den Betrag von {betrag} bis zum {faellig}. Die Bankverbindung findest du auf der angehängten Rechnung.',
  mail_bezahlt: 'Den Betrag von {betrag} hast du bereits bezahlt. Die Rechnung findest du im Anhang.',
};
const KARTE_ZAHLARTEN = ['lastschrift', 'ueberweisung', 'bar', 'qr'];

async function karteVorlage(env) {
  let gespeichert = {};
  try { const raw = await env.VOUCHERS.get('rechnungsvorlage'); if (raw) gespeichert = JSON.parse(raw); } catch (e) { /* Standard */ }
  const v = { ...KARTE_VORLAGE_STANDARD };
  for (const k of Object.keys(KARTE_VORLAGE_STANDARD)) {
    if (gespeichert[k] !== undefined && gespeichert[k] !== null && gespeichert[k] !== '') v[k] = gespeichert[k];
  }
  v.faellig_tage = Math.max(0, Math.min(60, Number(v.faellig_tage) || 0));
  return v;
}

function karteFill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function karteEurKurz(cents) {
  return fmtEur(cents);
}

function karteIsoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function karteTagPlus(n) { return isoDate(new Date(Date.now() + n * 86400000)); }

/* ---- Stripe-Helfer ---- */

function karteStripeFehler(res) {
  const e = res && res.data && res.data.error;
  return (e && (e.message || e.code)) || 'Stripe hat die Anfrage abgelehnt.';
}

async function karteStripeGet(env, pfad) {
  return stripeCall(env, 'GET', pfad);
}

/** Stripe-Kunde zur Mailadresse (anlegen, wenn gewünscht). */
async function karteStripeKunde(env, email, name, anlegen) {
  const res = await karteStripeGet(env, `customers?email=${encodeURIComponent(email)}&limit=5`);
  if (res.ok) {
    const l = (res.data.data || []).filter((c) => !c.deleted);
    if (l.length) {
      // der mit Mandat/der neueste zuerst: Stripe liefert neueste zuerst
      return l[0];
    }
  }
  if (!anlegen) return null;
  const p = new URLSearchParams();
  p.set('email', email);
  if (name) p.set('name', name);
  const neu = await stripeCall(env, 'POST', 'customers', p);
  if (!neu.ok) throw new Error(karteStripeFehler(neu));
  return neu.data;
}

/** Alle Stripe-Kunden mit dieser Mailadresse (manchmal gibt es mehrere, z. B. durch den Online-Kauf). */
async function karteStripeKunden(env, email) {
  const res = await karteStripeGet(env, `customers?email=${encodeURIComponent(email)}&limit=10`);
  return res.ok ? (res.data.data || []).filter((c) => !c.deleted) : [];
}

/** Gespeichertes SEPA-Mandat: gibt Kunde und Zahlungsmittel zurück oder null. */
async function karteMandat(env, email) {
  try {
    for (const c of await karteStripeKunden(env, email)) {
      const r = await karteStripeGet(env, `customers/${c.id}/payment_methods?type=sepa_debit&limit=1`);
      const pm = r.ok && (r.data.data || [])[0];
      if (pm) return { customer: c.id, pm: pm.id, iban: pm.sepa_debit && pm.sepa_debit.last4 ? pm.sepa_debit.last4 : '' };
    }
  } catch (e) { console.error('Mandatsprüfung fehlgeschlagen', e); }
  return null;
}

/** Zahlart, die der Kunde zuletzt genutzt hat (aus Stripe), mit Hinweistext. */
async function karteZahlartErraten(env, email) {
  try {
    for (const c of await karteStripeKunden(env, email)) {
      const ch = await karteStripeGet(env, `charges?customer=${c.id}&limit=5`);
      if (ch.ok) {
        for (const x of ch.data.data || []) {
          if (x.status === 'failed') continue;
          const t = x.payment_method_details && x.payment_method_details.type;
          const dat = fmtDate(isoDate(new Date(x.created * 1000)));
          if (t === 'sepa_debit') return { zahlart: 'lastschrift', hinweis: `Zuletzt per Lastschrift bezahlt (${dat})` };
          if (t === 'customer_balance') return { zahlart: 'ueberweisung', hinweis: `Zuletzt per Überweisung bezahlt (${dat})` };
          if (t) return { zahlart: 'ueberweisung', hinweis: `Zuletzt mit ${t === 'card' ? 'Karte' : t === 'paypal' ? 'PayPal' : t} bezahlt (${dat}) – ich schlage Überweisung vor` };
        }
      }
      const iv = await karteStripeGet(env, `invoices?customer=${c.id}&limit=5`);
      if (iv.ok) {
        const x = (iv.data.data || []).find((i) => i.status === 'paid' || i.status === 'open');
        if (x) return { zahlart: 'ueberweisung', hinweis: `Zuletzt per Rechnung bezahlt (${x.number || x.id})` };
      }
    }
  } catch (e) { console.error('Zahlart raten fehlgeschlagen', e); }
  return { zahlart: '', hinweis: '' };
}

async function karteZahlartLesen(env, email) {
  try {
    const raw = await env.VOUCHERS.get(`kundenzahl:${email}`);
    if (raw) { const z = JSON.parse(raw); if (KARTE_ZAHLARTEN.indexOf(z.zahlart) !== -1) return z.zahlart; }
  } catch (e) { /* weiter */ }
  return '';
}

async function karteZahlartSpeichern(env, email, zahlart, quelle) {
  await env.VOUCHERS.put(`kundenzahl:${email}`, JSON.stringify({ zahlart, quelle: quelle || 'verwaltung', updated: new Date().toISOString() }));
}

/* ---- Rechnungen (Stripe) ---- */

async function karteRechnungErstellen(env, o) {
  // o: email, name, zhd, cents, text, kopf, fuss, faellig(iso), gueltig(iso), zahlart, mandat({customer,pm}|null), code, kartenlabel
  const kunde = o.mandat ? { id: o.mandat.customer } : await karteStripeKunde(env, o.email, o.name, true);
  const abbuchen = o.zahlart === 'lastschrift' && !!o.mandat;
  const qr = o.zahlart === 'qr';

  const p = new URLSearchParams();
  p.set('customer', kunde.id);
  p.set('currency', 'eur');
  p.set('auto_advance', 'false');
  p.set('pending_invoice_items_behavior', 'exclude');
  if (o.kopf) p.set('description', String(o.kopf).slice(0, 500));
  if (o.fuss) p.set('footer', String(o.fuss).slice(0, 500));
  let n = 0;
  if (o.zhd) { p.set(`custom_fields[${n}][name]`, 'z. Hd.'); p.set(`custom_fields[${n}][value]`, String(o.zhd).slice(0, 140)); n++; }
  if (o.gueltig) { p.set(`custom_fields[${n}][name]`, 'Einlösbar bis'); p.set(`custom_fields[${n}][value]`, fmtDate(o.gueltig)); n++; }
  p.set('metadata[fd_karte]', o.code);
  p.set('metadata[fd_zahlart]', o.zahlart);
  p.set('metadata[fd_mail]', o.email);

  if (abbuchen) {
    p.set('collection_method', 'charge_automatically');
    p.set('default_payment_method', o.mandat.pm);
    p.append('payment_settings[payment_method_types][]', 'sepa_debit');
  } else {
    p.set('collection_method', 'send_invoice');
    let frist = o.zahlart === 'bar' ? karteTagPlus(1) : qr ? karteTagPlus(7) : (o.faellig && karteIsoOk(o.faellig) ? o.faellig : karteTagPlus(14));
    if (frist < karteTagPlus(0)) frist = karteTagPlus(0);
    p.set('due_date', String(Math.floor(new Date(`${frist}T21:00:00Z`).getTime() / 1000)));
  }
  // Überweisungs-Angaben wie bei den bisherigen Rechnungen (Bankdaten stehen auf der Rechnung)
  const ueberweisung = (q) => {
    q.set('payment_settings[payment_method_options][customer_balance][funding_type]', 'bank_transfer');
    q.set('payment_settings[payment_method_options][customer_balance][bank_transfer][type]', 'eu_bank_transfer');
    q.set('payment_settings[payment_method_options][customer_balance][bank_transfer][eu_bank_transfer][country]', 'DE');
  };
  if (qr) {
    // Zahlungsseite für das Handy: Karte (inkl. Apple Pay / Google Pay) und SEPA-Lastschrift, keine Überweisung
    p.append('payment_settings[payment_method_types][]', 'card');
    p.append('payment_settings[payment_method_types][]', 'sepa_debit');
  } else if (!abbuchen && o.zahlart !== 'bar') ueberweisung(p);

  let inv = await stripeCall(env, 'POST', 'invoices', p);
  if (!inv.ok && /payment_method|payment_settings|bank_transfer/i.test(JSON.stringify(inv.data || {})) && !abbuchen) {
    // Ohne Überweisungs-Zusatzangaben nochmal versuchen
    for (const k of [...p.keys()]) if (k.indexOf('payment_settings') === 0) p.delete(k);
    inv = await stripeCall(env, 'POST', 'invoices', p);
  }
  if (!inv.ok) throw new Error('Rechnung konnte nicht angelegt werden: ' + karteStripeFehler(inv));
  const id = inv.data.id;

  const it = new URLSearchParams();
  it.set('customer', kunde.id);
  it.set('invoice', id);
  it.set('currency', 'eur');
  it.set('amount', String(o.cents));
  it.set('description', String(o.text).slice(0, 250));
  const item = await stripeCall(env, 'POST', 'invoiceitems', it);
  if (!item.ok) {
    await stripeCall(env, 'DELETE', `invoices/${id}`);
    throw new Error('Rechnungszeile konnte nicht angelegt werden: ' + karteStripeFehler(item));
  }

  const fin = await stripeCall(env, 'POST', `invoices/${id}/finalize`, new URLSearchParams({ auto_advance: 'false' }));
  if (!fin.ok) {
    await stripeCall(env, 'DELETE', `invoices/${id}`);
    throw new Error('Rechnung konnte nicht abgeschlossen werden: ' + karteStripeFehler(fin));
  }
  let rech = fin.data;

  if (o.zahlart === 'bar') {
    const pay = await stripeCall(env, 'POST', `invoices/${id}/pay`, new URLSearchParams({ paid_out_of_band: 'true' }));
    if (pay.ok) rech = pay.data;
  } else if (abbuchen) {
    const pay = await stripeCall(env, 'POST', `invoices/${id}/pay`, new URLSearchParams({ payment_method: o.mandat.pm }));
    if (pay.ok) rech = pay.data;
    else console.error('Lastschrift konnte nicht gestartet werden', id, karteStripeFehler(pay));
  }
  return rech;
}

function karteRechnungKurz(inv, extra) {
  return {
    id: inv.id, nummer: inv.number || inv.id, cents: inv.total != null ? inv.total : inv.amount_due,
    status: inv.status === 'paid' ? 'paid' : inv.status === 'void' ? 'void' : inv.status === 'uncollectible' ? 'void' : 'open',
    faellig: inv.due_date ? isoDate(new Date(inv.due_date * 1000)) : '',
    methode: (inv.metadata && inv.metadata.fd_zahlart) || '', url: inv.hosted_invoice_url || '', pdf: inv.invoice_pdf || '',
    ...(extra || {}),
  };
}

async function karteRechnungSpeichern(env, inv, extra) {
  const k = karteRechnungKurz(inv, extra);
  const alt = await env.VOUCHERS.get(`rechnung:${inv.id}`);
  const rec = { ...(alt ? JSON.parse(alt) : {}), ...k };
  await env.VOUCHERS.put(`rechnung:${inv.id}`, JSON.stringify(rec));
  return rec;
}

/** Alle gespeicherten Rechnungen; offene werden frisch aus Stripe gelesen. */
async function karteRechnungenAlle(env, aktualisieren) {
  const keys = await kundenListAll(env, 'rechnung:');
  const alle = (await kundenGetMany(env, keys)).map((x) => x.v).filter((r) => r && r.id);
  if (aktualisieren) {
    const offen = alle.filter((r) => r.status === 'open').slice(0, 25);
    await Promise.all(offen.map(async (r) => {
      try {
        const res = await karteStripeGet(env, `invoices/${r.id}`);
        if (!res.ok) return;
        const neu = karteRechnungKurz(res.data);
        if (neu.status !== r.status || neu.cents !== r.cents) {
          Object.assign(r, { status: neu.status, cents: neu.cents, faellig: neu.faellig || r.faellig, url: neu.url || r.url, pdf: neu.pdf || r.pdf });
          await env.VOUCHERS.put(`rechnung:${r.id}`, JSON.stringify(r));
        }
      } catch (e) { console.error('Rechnung nicht aktualisiert', r.id, e); }
    }));
  }
  alle.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return alle;
}

function karteRechnungFuerListe(r) {
  return {
    id: r.id, nummer: r.nummer, name: r.name || '', email: r.email || '', cents: r.cents, status: r.status,
    faellig: r.faellig || '', text: r.text || '', url: r.url || '', lastschrift: r.methode === 'lastschrift' && r.status !== 'paid',
  };
}

/* ---- Widerrufshinweis ---- */

/** Belehrung wie bisher; der Zustimmungs-Satz kommt nur, wenn der Kunde wirklich zugestimmt hat. */
function karteWiderrufHtml(env, zustimmung) {
  const h = widerrufMailHtml(env);
  if (zustimmung) return h;
  const a = h.indexOf('<p'), b = h.indexOf('</p>', a);
  if (a < 0 || b < 0) return h;
  const p = 'margin:0 0 10px;font-size:12px;line-height:1.55;color:#9AA0AB';
  const hinweis = `<p style="${p}"><b style="color:#ECE9E2">Hinweis zum Trainingsbeginn:</b> Du kannst diesen Vertrag innerhalb von vierzehn Tagen
        widerrufen. Mit dem Training beginne ich vor Ablauf dieser Frist nur, wenn du das ausdr&uuml;cklich verlangst (zum Beispiel
        per WhatsApp). Hast du das verlangt, zahlst du bei einem Widerruf nur f&uuml;r die bis dahin erbrachten Trainings.</p>`;
  return h.slice(0, a) + hinweis + h.slice(b + 4);
}

/* ---- Mail ---- */

function karteMailHtml(env, o) {
  // o: rec, vorlage, zahlart, cents, faellig, zustimmung, hinweis, link(zahlungslink), url(Rechnung)
  const cfg = config(env);
  const c = o.rec;
  const link = `${cfg.siteOrigin}/termin-buchen.html?art=training&code=${encodeURIComponent(c.code)}`;
  const left = c.sessions_total - c.sessions_used;
  const vars = {
    karte: c.label, einheiten: c.sessions_total, einheitspreis: karteEurKurz(c.unit_cents), betrag: karteEurKurz(o.cents),
    faellig: o.faellig ? fmtDate(o.faellig) : '', code: c.code, name: firstName(c.buyer_name),
  };
  const intro = karteFill(o.vorlage.mail_intro, vars);
  let zahlText = o.zahlart === 'lastschrift' ? o.vorlage.mail_lastschrift : o.zahlart === 'ueberweisung' ? o.vorlage.mail_ueberweisung : o.vorlage.mail_bezahlt;
  zahlText = karteFill(zahlText, vars);
  if (o.link) {
    zahlText = `Der Betrag von ${karteEurKurz(o.cents)} ist bis zum ${o.faellig ? fmtDate(o.faellig) : 'Fälligkeitsdatum'} offen. Du kannst ihn bequem &uuml;ber den Link bei der Rechnung bezahlen (Lastschrift oder &Uuml;berweisung).`;
  }
  const rows =
    row('Karte', `${c.label} · ${c.sessions_total} Einheiten`) +
    row('Preis pro Einheit', fmtEur(c.unit_cents)) +
    row('Gesamtbetrag', fmtEur(o.cents)) +
    row('Einlösbar bis', fmtDate(c.expires));
  const zahlBox = `
    <div style="border-left:3px solid #EFB92E;padding:12px 16px;margin:0 0 24px;background:#22262F">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#EFB92E;margin-bottom:6px">Zahlung</div>
      <p style="margin:0;font-size:15px;color:#c9cbd0">${o.link ? zahlText : esc(zahlText)}</p>
      ${o.url && o.zahlart !== 'bar' && (o.zahlart === 'ueberweisung' || o.link) ? `<p style="margin:12px 0 0"><a href="${esc(o.url)}" style="color:#EFB92E;font-weight:700">Rechnung ansehen${o.link ? ' &amp; online bezahlen' : ''}</a></p>` : ''}
    </div>`;
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(c.buyer_name))},</p>
    <p style="margin:0 0 22px">${esc(intro)}</p>
    ${o.hinweis ? `<p style="margin:0 0 22px;padding:12px 16px;background:#22262F;color:#c9cbd0">${esc(o.hinweis)}</p>` : ''}
    <div style="border:1px solid #EFB92E;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#B8860B">Dein Code</div>
      <p style="margin:10px 0 0;font-size:26px;letter-spacing:.12em;font-weight:700;color:#ECE9E2">${esc(c.code)}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#9AA0AB">noch ${left} von ${c.sessions_total} Einheiten frei</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>
    ${zahlBox}
    <p style="margin:0 0 22px;text-align:center">
      <a href="${esc(link)}" style="display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;
        font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px">Ersten Termin buchen</a>
    </p>
    ${cardHowToHtml(c.code, c.expires, left, c.sessions_total, link)}
    ${whatsappBlockHtml(null, env, { text: `Hallo ${firstName(cfg.ownerName) || 'Niklas'}, ich habe eine Frage zu meiner ${c.label} (Code ${c.code})`, intro: 'Fragen zur Karte oder zu den Terminen? Schreib mir direkt:' })}
    ${moveHtml(null, env)}
    ${karteWiderrufHtml(env, !!o.zustimmung)}`;
  return {
    betreff: karteFill(o.vorlage.mail_betreff, vars),
    html: mailShell(c.label + ' aktiv', inner, env),
  };
}

/* ---- Hilfsfunktionen für Karte ---- */

function karteRechnen(karte, body) {
  let unit = karte.unitCents;
  const eigener = Math.round(Number(body.einheitspreis) * 100);
  if (eigener > 0) unit = eigener;
  return { unit, cents: unit * karte.sessions };
}

function karteRechnungText(vorlage, karte, rechnen, body, name) {
  const t = String(body.beschreibung || '').trim() || vorlage.beschreibung;
  return karteFill(t, { karte: karte.label, einheiten: karte.sessions, einheitspreis: fmtEur(rechnen.unit), betrag: fmtEur(rechnen.cents), name });
}

async function karteOptionen(url, env) {
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const vorlage = await karteVorlage(env);
  const cards = await liveCards(env);
  const karten = {};
  for (const [k, c] of Object.entries(cards)) karten[k] = { label: c.label, sessions: c.sessions, unitCents: c.unitCents, totalCents: c.totalCents };
  let zahlart = '', hinweis = '', mandat = false, letzte = '';
  if (isEmail(email)) {
    const [gespeichert, m, vs] = await Promise.all([
      karteZahlartLesen(env, email), karteMandat(env, email),
      kundenGetMany(env, await kundenListAll(env, 'voucher:')),
    ]);
    mandat = !!m;
    const meine = vs.map((x) => x.v).filter((v) => v && v.kind === 'karte' && kundenMail(v.buyer_email) === email)
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));
    if (meine[0] && karten[meine[0].card]) letzte = meine[0].card;
    const geraten = await karteZahlartErraten(env, email);
    zahlart = gespeichert || geraten.zahlart;
    hinweis = gespeichert ? (geraten.zahlart === gespeichert ? geraten.hinweis : 'Von dir für diesen Kunden festgelegt') : geraten.hinweis;
  }
  return json({
    zahlart, zahlart_hinweis: hinweis, mandat, letzte_karte: letzte,
    standard_faellig: karteTagPlus(vorlage.faellig_tage), gueltig_bis: expiryDate(new Date(), 1), vorlage, karten,
  });
}

async function karteVorschau(body, env) {
  const cards = await liveCards(env);
  const karte = cards[body.card];
  if (!karte) return json({ error: 'Diese Karte gibt es nicht.' }, 400);
  const vorlage = await karteVorlage(env);
  const rechnen = karteRechnen(karte, body);
  const zahlart = KARTE_ZAHLARTEN.indexOf(body.zahlart) !== -1 ? body.zahlart : 'ueberweisung';
  const mailArt = zahlart === 'qr' ? 'bar' : zahlart;   // Mail kommt bei QR erst nach der Zahlung: Text "bereits bezahlt"
  const email = String(body.email || '').trim().toLowerCase();
  const mandat = zahlart === 'lastschrift' && isEmail(email) ? await karteMandat(env, email) : null;
  const rec = {
    code: 'FD-XXXX-XXXX', label: karte.label, sessions_total: karte.sessions, sessions_used: 0, unit_cents: rechnen.unit,
    amount_cents: rechnen.cents, buyer_name: clean(body.name, 80) || 'Max Mustermann',
    expires: karteIsoOk(body.gueltig_bis) ? body.gueltig_bis : expiryDate(new Date(), 1),
  };
  const faellig = karteIsoOk(body.faellig) ? body.faellig : karteTagPlus(vorlage.faellig_tage);
  const m = karteMailHtml(env, {
    rec, vorlage, zahlart: mailArt, cents: rechnen.cents, faellig, zustimmung: !!body.zustimmung, hinweis: clean(body.hinweis, 300),
    link: zahlart === 'lastschrift' && !mandat && isEmail(email), url: '#',
  });
  return json({ betreff: m.betreff, rechnung_text: karteRechnungText(vorlage, karte, rechnen, body, rec.buyer_name), cents: rechnen.cents, html: m.html });
}

async function karteNeu(body, env) {
  const name = clean(body.name, 80);
  const email = String(body.email || '').trim().toLowerCase();
  if (!name) return json({ error: 'Bitte einen Namen angeben.' }, 400);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const cards = await liveCards(env);
  const karte = cards[body.card];
  if (!karte) return json({ error: 'Diese Karte gibt es nicht.' }, 400);
  const zahlart = body.zahlart;
  if (KARTE_ZAHLARTEN.indexOf(zahlart) === -1) return json({ error: 'Bitte wähle, wie der Kunde bezahlt.' }, 400);

  // Doppelklick-Schutz
  const sperre = `karte:sperre:${email}:${body.card}`;
  if (await env.VOUCHERS.get(sperre)) return json({ error: 'Diese Karte wurde für den Kunden gerade erst ausgestellt. Bitte kurz warten oder in den Karten prüfen.' }, 409);
  await env.VOUCHERS.put(sperre, '1', { expirationTtl: 60 });

  try {
    const vorlage = await karteVorlage(env);
    const rechnen = karteRechnen(karte, body);
    const jetzt = new Date();
    const gueltig = karteIsoOk(body.gueltig_bis) ? body.gueltig_bis : expiryDate(jetzt, 1);
    const faellig = zahlart === 'bar' ? '' : zahlart === 'qr' ? karteTagPlus(7) : (karteIsoOk(body.faellig) ? body.faellig : karteTagPlus(vorlage.faellig_tage));
    const code = await uniqueCode(env);

    const mandat = zahlart === 'lastschrift' ? await karteMandat(env, email) : null;
    const zahlungslink = zahlart === 'lastschrift' && !mandat;   // ohne Mandat: Rechnung mit Zahlungslink
    const rechnungsart = zahlungslink ? 'ueberweisung' : zahlart;
    const text = karteRechnungText(vorlage, karte, rechnen, body, name);

    let inv;
    try {
      inv = await karteRechnungErstellen(env, {
        email, name, zhd: clean(body.zhd, 140) || name, cents: rechnen.cents, text,
        kopf: vorlage.kopf, fuss: vorlage.fuss, faellig, gueltig, zahlart: rechnungsart, mandat, code, kartenlabel: karte.label,
      });
    } catch (err) {
      console.error('Karte: Rechnung fehlgeschlagen', err);
      return json({ error: String(err.message || err) }, 502);
    }

    const rec = {
      kind: 'karte', code, token: randomToken(20), card: body.card, label: karte.label,
      sessions_total: karte.sessions, sessions_used: 0, unit_cents: rechnen.unit, amount_cents: rechnen.cents, currency: 'EUR',
      buyer_name: name, buyer_email: email, created: jetzt.toISOString(), expires: gueltig, status: 'active',
      redemptions: [], origin: 'verwaltung', zahlart: zahlart, rechnung: inv.number || inv.id, rechnung_id: inv.id,
      vorzeitig_zustimmung: !!body.zustimmung,
    };
    if (zahlart === 'qr') { rec.qr_mail = body.mail !== false; rec.qr_hinweis = clean(body.hinweis, 300); rec.qr_vorlage_faellig = faellig; }
    await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
    await karteRechnungSpeichern(env, inv, { code, email, name, text, created: jetzt.toISOString() });
    await karteZahlartSpeichern(env, email, zahlart);

    let mail = false, mailFehler = '';
    if (body.mail !== false && zahlart !== 'qr') {   // QR: Mail erst, wenn bezahlt wird (karteQrAbschluss)
      try {
        const m = karteMailHtml(env, {
          rec, vorlage, zahlart, cents: rechnen.cents, faellig, zustimmung: !!body.zustimmung, hinweis: clean(body.hinweis, 300),
          link: zahlungslink, url: inv.hosted_invoice_url || '',
        });
        const anhang = [];
        if (inv.invoice_pdf) anhang.push({ path: inv.invoice_pdf, filename: `Rechnung-${String(inv.number || inv.id).replace(/[^A-Za-z0-9_-]/g, '')}.pdf` });
        await sendMail(env, { to: email, subject: m.betreff, html: m.html, attachments: anhang });
        mail = true;
      } catch (err) {
        console.error('Karte: Mail fehlgeschlagen', err);
        mailFehler = 'Die Karte und die Rechnung sind angelegt, aber die Mail ging nicht raus. Bitte schicke dem Kunden den Code selbst.';
      }
    }

    const zahlungText = zahlungslink
      ? 'Kein Lastschrift-Mandat gespeichert – der Kunde bekommt die Rechnung mit Zahlungslink.'
      : zahlart === 'lastschrift' ? 'Der Betrag wird in den nächsten Tagen per Lastschrift eingezogen.'
        : zahlart === 'ueberweisung' ? `Fällig am ${fmtDate(faellig)}.`
          : zahlart === 'qr' ? 'Der Kunde bezahlt jetzt mit dem QR-Code. Die Mail mit dem Code geht automatisch raus, sobald bezahlt wird.' : '';
    return json({
      ok: true, code, label: karte.label, cents: rechnen.cents, gueltig_bis: gueltig, mail, mail_fehler: mailFehler,
      rechnung: { id: inv.id, nummer: inv.number || inv.id, status: inv.status === 'paid' ? 'paid' : 'open', url: inv.hosted_invoice_url || '' },
      qr: zahlart === 'qr' ? { url: inv.hosted_invoice_url || '', id: inv.id, mail_nach_zahlung: body.mail !== false } : undefined,
      zahlung_text: zahlungText,
    });
  } catch (err) {
    console.error('Karte neu fehlgeschlagen', err);
    return json({ error: 'Das hat nicht geklappt: ' + String(err.message || err) }, 500);
  }
}

/* ---- SEPA-Mandat per Link anfordern ---- */

async function karteMandatLink(body, env) {
  const email = String(body.email || '').trim().toLowerCase();
  const name = clean(body.name, 80);
  if (!isEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  if (await karteMandat(env, email)) return json({ error: 'Für diese Mailadresse ist schon ein Lastschrift-Mandat gespeichert.' }, 400);
  const kunde = await karteStripeKunde(env, email, name, true);
  const cfg = config(env);
  const p = new URLSearchParams();
  p.set('mode', 'setup');
  p.set('customer', kunde.id);
  p.append('payment_method_types[]', 'sepa_debit');
  p.set('currency', 'eur');
  p.set('locale', 'de');
  p.set('success_url', `${cfg.siteOrigin}/mandat-erteilt.html`);
  p.set('cancel_url', `${cfg.siteOrigin}/`);
  p.set('metadata[kind]', 'mandat');
  p.set('metadata[email]', email);
  const s = await stripeCall(env, 'POST', 'checkout/sessions', p);
  if (!s.ok || !s.data.url) return json({ error: 'Der Link konnte nicht erstellt werden: ' + karteStripeFehler(s) }, 502);

  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(name || kunde.name || ''))},</p>
    <p style="margin:0 0 22px">damit ich k&uuml;nftige Karten bequem per Lastschrift abbuchen kann, brauche ich einmalig dein SEPA-Lastschrift-Mandat.
      Das dauert etwa 30 Sekunden: Du gibst Namen und IBAN ein und best&auml;tigst das Mandat. Die Eingabe l&auml;uft direkt &uuml;ber Stripe, ich sehe
      deine Bankdaten nicht.</p>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(s.data.url)}" style="display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;
      font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px">Mandat erteilen</a></p>
    <p style="margin:0 0 14px;font-size:14px;color:#9AA0AB">Der Link gilt 24 Stunden. Danach schicke ich dir auf Wunsch einen neuen.</p>
    <p style="margin:0;font-size:14px;color:#9AA0AB">Abgebucht wird nur, wenn du eine neue Karte bei mir buchst, und ich k&uuml;ndige dir den Betrag vorher per Mail an.
      Fragen? ${esc(cfg.ownerPhone)} oder ${esc(cfg.ownerEmail)}</p>`;
  await sendMail(env, { to: email, subject: 'Dein Lastschrift-Mandat für Fitness Donner', html: mailShell('Lastschrift-Mandat', inner, env) });
  return json({ ok: true });
}

/** Webhook: Der Kunde hat sein Mandat erteilt. */
async function karteMandatErhalten(session, env) {
  const m = session.metadata || {};
  const email = String(m.email || (session.customer_details && session.customer_details.email) || '').trim().toLowerCase();
  if (!isEmail(email)) return;
  await karteZahlartSpeichern(env, email, 'lastschrift', 'mandat');
  const cfg = config(env);
  try {
    await sendMail(env, {
      to: cfg.ownerEmail, subject: `Lastschrift-Mandat erteilt: ${email}`,
      html: mailShell('Mandat erteilt', `<p style="margin:0">${esc(email)} hat das SEPA-Lastschrift-Mandat erteilt. Du kannst Karten jetzt mit einem Klick per Lastschrift abbuchen.</p>`, env),
    });
  } catch (err) { console.error('Mandat-Meldung fehlgeschlagen', err); }
}

/** Webhook: Eine hier ausgestellte Rechnung wurde bezahlt (Lastschrift eingegangen o. ä.). */
async function karteRechnungBezahlt(inv, env) {
  try { await karteRechnungSpeichern(env, inv); } catch (err) { console.error('Rechnung nicht aktualisiert', err); }
}

/* ---- Vor Ort bezahlen (QR): Status abfragen, Mail nach Zahlung, Link verschicken ---- */

/** 'open' | 'processing' (Lastschrift ausgelöst, Geld noch unterwegs) | 'paid' | 'void' */
async function karteQrStatus(env, id) {
  const res = await karteStripeGet(env, `invoices/${id}`);
  if (!res.ok) throw new Error(karteStripeFehler(res));
  const inv = res.data;
  if (inv.status === 'paid') return { status: 'paid', inv };
  if (inv.status === 'void' || inv.status === 'uncollectible') return { status: 'void', inv };
  try {
    const pays = await karteStripeGet(env, `invoice_payments?invoice=${id}&limit=5&expand[]=data.payment.payment_intent`);
    if (pays.ok) {
      for (const x of pays.data.data || []) {
        const pi = x.payment && x.payment.payment_intent;
        if (pi && typeof pi === 'object' && (pi.status === 'processing' || pi.status === 'succeeded')) return { status: pi.status === 'succeeded' ? 'paid' : 'processing', inv };
      }
    }
  } catch (e) { console.error('Zahlungsstand nicht lesbar', id, e); }
  return { status: 'open', inv };
}

/** Karten-Mail für eine per QR bezahlte Karte – genau einmal (egal ob Verwaltung oder Webhook zuerst merkt). */
async function karteQrAbschluss(env, inv, status) {
  const code = inv.metadata && inv.metadata.fd_karte;
  if (!code) return false;
  const raw = await env.VOUCHERS.get(`voucher:${code}`);
  if (!raw) return false;
  const rec = JSON.parse(raw);
  if (rec.zahlart !== 'qr') return false;
  const sperre = `karte:qrmail:${code}`;
  if (rec.qr_mail_gesendet || await env.VOUCHERS.get(sperre)) return false;
  await env.VOUCHERS.put(sperre, '1', { expirationTtl: 60 * 60 * 24 * 30 });
  rec.qr_bezahlt = status;
  rec.qr_mail_gesendet = true;
  await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
  if (rec.qr_mail === false) return false;
  try {
    const vorlage = await karteVorlage(env);
    const m = karteMailHtml(env, {
      rec, vorlage, zahlart: status === 'paid' ? 'bar' : 'lastschrift', cents: rec.amount_cents, faellig: '',
      zustimmung: !!rec.vorzeitig_zustimmung, hinweis: rec.qr_hinweis || '', url: inv.hosted_invoice_url || '',
    });
    const anhang = [];
    if (inv.invoice_pdf) anhang.push({ path: inv.invoice_pdf, filename: `Rechnung-${String(inv.number || inv.id).replace(/[^A-Za-z0-9_-]/g, '')}.pdf` });
    await sendMail(env, { to: rec.buyer_email, subject: m.betreff, html: m.html, attachments: anhang });
    return true;
  } catch (err) {
    console.error('QR-Karte: Mail fehlgeschlagen', code, err);
    rec.qr_mail_gesendet = false; rec.qr_mail_fehler = String(err.message || err);
    await env.VOUCHERS.put(`voucher:${code}`, JSON.stringify(rec));
    await env.VOUCHERS.delete(sperre);
    return false;
  }
}

async function karteQrStatusAbfrage(url, env) {
  const id = String(url.searchParams.get('id') || '');
  if (!/^in_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Unbekannte Rechnung.' }, 400);
  const raw = await env.VOUCHERS.get(`rechnung:${id}`);
  if (!raw) return json({ error: 'Diese Rechnung kenne ich nicht.' }, 404);
  const { status, inv } = await karteQrStatus(env, id);
  let mail = false;
  if (status === 'paid' || status === 'processing') {
    mail = await karteQrAbschluss(env, inv, status);
    if (status === 'paid') await karteRechnungSpeichern(env, inv);
  }
  const rec = inv.metadata && inv.metadata.fd_karte ? JSON.parse((await env.VOUCHERS.get(`voucher:${inv.metadata.fd_karte}`)) || '{}') : {};
  return json({ status, nummer: inv.number || inv.id, mail: !!(rec.qr_mail_gesendet && rec.qr_mail !== false), mail_fehler: rec.qr_mail_fehler || '', mail_neu: mail });
}

/** Zahlungslink per Mail an den Kunden (wenn er nicht vor Ort ist). */
async function karteQrLinkMail(body, env) {
  const id = String(body.id || '');
  if (!/^in_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Unbekannte Rechnung.' }, 400);
  const raw = await env.VOUCHERS.get(`rechnung:${id}`);
  if (!raw) return json({ error: 'Diese Rechnung kenne ich nicht.' }, 404);
  const r = JSON.parse(raw);
  const res = await karteStripeGet(env, `invoices/${id}`);
  if (!res.ok) return json({ error: karteStripeFehler(res) }, 502);
  const inv = res.data;
  if (inv.status === 'paid') return json({ error: 'Diese Rechnung ist schon bezahlt.' }, 400);
  if (!r.email || !inv.hosted_invoice_url) return json({ error: 'Es fehlt die Mailadresse oder der Zahlungslink.' }, 400);
  const cfg = config(env);
  const betrag = fmtEur(inv.total != null ? inv.total : inv.amount_due);
  const inner = `
    <p style="margin:0 0 18px">Hallo ${esc(firstName(r.name || ''))},</p>
    <p style="margin:0 0 22px">hier ist der Link, um deine neue Karte (${esc(betrag)}) zu bezahlen. Du kannst mit Apple Pay, Google Pay, Karte oder Lastschrift zahlen &ndash; das dauert nur wenige Sekunden.</p>
    <p style="margin:0 0 22px;text-align:center"><a href="${esc(inv.hosted_invoice_url)}" style="display:inline-block;background:#EFB92E;color:#15171C;padding:14px 26px;
      font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:14px">Jetzt bezahlen</a></p>
    <p style="margin:0;font-size:14px;color:#9AA0AB">Sobald die Zahlung bei mir angekommen ist, schicke ich dir den Code f&uuml;r deine Termine per Mail.
      Fragen? ${esc(cfg.ownerPhone)} oder ${esc(cfg.ownerEmail)}</p>`;
  await sendMail(env, { to: r.email, subject: 'Dein Zahlungslink für Fitness Donner', html: mailShell('Zahlungslink', inner, env) });
  return json({ ok: true });
}

/* ---- Router ---- */

async function karteAdmin(path, url, request, env, body) {
  const GET = request.method === 'GET', POST = request.method === 'POST';
  if (path === 'karte/optionen' && GET) return karteOptionen(url, env);
  if (path === 'karte/vorschau' && POST) return karteVorschau(body, env);
  if (path === 'karte/neu' && POST) return karteNeu(body, env);

  if (path === 'rechnung/status' && GET) {
    try { return await karteQrStatusAbfrage(url, env); } catch (err) { return json({ error: String(err.message || err) }, 502); }
  }
  if (path === 'rechnung/link-senden' && POST) return karteQrLinkMail(body, env);
  if (path === 'rechnung/liste' && GET) {
    const l = await karteRechnungenAlle(env, true);
    return json({ rechnungen: l.map(karteRechnungFuerListe) });
  }
  if (path === 'rechnung/bezahlt' && POST) {
    const id = String(body.id || '');
    if (!/^in_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Unbekannte Rechnung.' }, 400);
    const raw = await env.VOUCHERS.get(`rechnung:${id}`);
    if (!raw) return json({ error: 'Diese Rechnung kenne ich nicht.' }, 404);
    const res = await stripeCall(env, 'POST', `invoices/${id}/pay`, new URLSearchParams({ paid_out_of_band: 'true' }));
    if (!res.ok && !/already paid|bereits/i.test(JSON.stringify(res.data || {}))) return json({ error: karteStripeFehler(res) }, 502);
    const rec = JSON.parse(raw); rec.status = 'paid';
    await env.VOUCHERS.put(`rechnung:${id}`, JSON.stringify(rec));
    return json({ ok: true });
  }
  if (path === 'rechnung/vorlage' && GET) return json({ vorlage: await karteVorlage(env) });
  if (path === 'rechnung/vorlage' && POST) {
    const neu = {};
    for (const k of Object.keys(KARTE_VORLAGE_STANDARD)) {
      if (body[k] === undefined) continue;
      neu[k] = k === 'faellig_tage' ? Math.max(0, Math.min(60, Number(body[k]) || 0)) : String(body[k]).slice(0, 1000);
    }
    const alt = await karteVorlage(env);
    await env.VOUCHERS.put('rechnungsvorlage', JSON.stringify({ ...alt, ...neu }));
    return json({ ok: true });
  }

  if (path === 'kunden/zahlart' && POST) {
    const email = String(body.email || '').trim().toLowerCase();
    if (!isEmail(email) || KARTE_ZAHLARTEN.indexOf(body.zahlart) === -1) return json({ error: 'Ungültige Angabe.' }, 400);
    await karteZahlartSpeichern(env, email, body.zahlart);
    return json({ ok: true });
  }
  if (path === 'kunden/mandat-link' && POST) return karteMandatLink(body, env);

  // bestehende Kunden-Ansichten ergänzen
  if (path === 'kunden/liste' && GET) {
    const r = await kundenListe(url, env);
    const d = await r.json();
    const offen = new Map();
    for (const x of await karteRechnungenAlle(env, true)) if (x.status === 'open') offen.set(kundenMail(x.email), (offen.get(kundenMail(x.email)) || 0) + 1);
    for (const k of d.kunden) k.offen = offen.get(kundenMail(k.email)) || 0;
    return json(d);
  }
  if (path === 'kunden/profil' && GET) {
    const r = await kundenProfil(url, env);
    if (!r.ok) return r;
    const d = await r.json();
    const email = kundenMail(d.email);
    const [rechn, gespeichert, mandat] = await Promise.all([karteRechnungenAlle(env, true), karteZahlartLesen(env, email), karteMandat(env, email)]);
    d.zahlart = gespeichert || (await karteZahlartErraten(env, email)).zahlart;
    d.mandat = !!mandat;
    const nachCode = new Map(rechn.filter((x) => x.code).map((x) => [x.code, x]));
    for (const k of d.karten || []) {
      const x = nachCode.get(k.code);
      if (x) k.rechnung = { id: x.id, nummer: x.nummer, cents: x.cents, status: x.status, faellig: x.faellig, methode: x.methode, url: x.url };
    }
    return json(d);
  }
  return null;
}
