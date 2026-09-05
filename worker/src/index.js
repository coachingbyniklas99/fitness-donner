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
 */

const CONFIG = {
  siteOrigin: 'https://fitnessdonner.de',
  siteName: 'Fitness Donner',
  ownerEmail: 'info@fitnessdonner.de',
  ownerName: 'Niklas Donner',
  ownerPhone: '0177 6311404',
  // Absenderadresse – muss in Resend als verifizierte Domain hinterlegt sein
  fromEmail: 'Fitness Donner <gutschein@fitnessdonner.de>',
  minCents: 2000,      // 20 €
  maxCents: 100000,    // 1.000 €
  validYears: 3,       // Gültigkeit: 3 Jahre bis zum Jahresende
};

const ALLOWED_ORIGINS = ['https://fitnessdonner.de', 'https://www.fitnessdonner.de'];

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);

    try {
      if (url.pathname === '/api/checkout' && request.method === 'POST') {
        return cors(await handleCheckout(request, env), request);
      }
      if (url.pathname === '/api/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env, ctx);
      }
      if (url.pathname === '/api/voucher' && request.method === 'GET') {
        return cors(await handleVoucherLookup(url, env), request);
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('Unhandled error', err && err.stack ? err.stack : err);
      return cors(json({ error: 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.' }, 500), request);
    }
  },

  // Täglicher Cron: Gutscheine mit Wunsch-Versanddatum verschicken
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendScheduledVouchers(env));
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

  // Wunsch-Versanddatum: heute bis 1 Jahr in der Zukunft
  let sendDate = '';
  if (delivery === 'gift' && body.sendDate) {
    const d = String(body.sendDate).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const today = isoDate(new Date());
      const max = isoDate(new Date(Date.now() + 365 * 864e5));
      if (d > today && d <= max) sendDate = d;
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
    `Wertgutschein über ${fmtEur(amountCents)} für Personal Training`
  );
  params.set('payment_intent_data[description]', `Gutschein ${fmtEur(amountCents)}`);
  params.set('metadata[buyer_name]', buyerName);
  params.set('metadata[recipient_name]', clean(body.recipientName, 80));
  params.set('metadata[message]', clean(body.message, 200));
  params.set('metadata[delivery]', delivery);
  params.set('metadata[gift_email]', delivery === 'gift' ? giftEmail : '');
  params.set('metadata[send_date]', sendDate);

  const session = await stripe(env, 'checkout/sessions', params);
  if (!session || !session.url) {
    console.error('Stripe-Session fehlgeschlagen', session);
    return json({ error: 'Die Zahlung konnte nicht gestartet werden. Bitte später erneut versuchen.' }, 502);
  }
  return json({ url: session.url });
}

/* ------------------------------------------------------------------ */
/* 2. Webhook                                                          */
/* ------------------------------------------------------------------ */

async function handleWebhook(request, env, ctx) {
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  const ok = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 400 });

  const event = JSON.parse(raw);
  if (event.type !== 'checkout.session.completed') return new Response('ignored', { status: 200 });

  // Idempotenz: jedes Event nur einmal verarbeiten
  const seen = await env.VOUCHERS.get(`event:${event.id}`);
  if (seen) return new Response('duplicate', { status: 200 });
  await env.VOUCHERS.put(`event:${event.id}`, '1', { expirationTtl: 60 * 60 * 24 * 30 });

  ctx.waitUntil(createVoucherFromSession(event.data.object, env));
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
    send_date: m.send_date || '',
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
      await env.VOUCHERS.put(`pending:${voucher.send_date}:${code}`, code);
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
    send_date: v.send_date,
  });
}

/* ------------------------------------------------------------------ */
/* 4. Geplanter Versand (Cron)                                         */
/* ------------------------------------------------------------------ */

async function sendScheduledVouchers(env) {
  const today = isoDate(new Date());
  const list = await env.VOUCHERS.list({ prefix: `pending:${today}:` });
  for (const key of list.keys) {
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

async function sendBuyerMail(v, env) {
  const cfg = config(env);
  const selbst = v.delivery === 'buyer';
  const intro = selbst
    ? `<p>vielen Dank für deinen Kauf! Dein Gutschein ist unten – du kannst ihn ausdrucken oder einfach weiterleiten.</p>`
    : `<p>vielen Dank für deinen Kauf! Der Gutschein geht ${v.send_date
        ? `am <b>${fmtDate(v.send_date)}</b>`
        : `<b>gleich</b>`} an <b>${esc(v.gift_email)}</b>. Hier ist deine Kopie:</p>`;

  await sendMail(env, {
    to: v.buyer_email,
    subject: `Dein Gutschein über ${fmtEur(v.amount_cents)} – ${cfg.siteName}`,
    html: mailShell(
      `Hallo ${esc(firstName(v.buyer_name))},`,
      intro + voucherCardHtml(v, env) + buyerFooterHtml(v, env),
      env
    ),
  });
}

async function sendGiftMail(v, env) {
  const cfg = config(env);
  const an = firstName(v.recipient_name) || 'du';
  await sendMail(env, {
    to: v.gift_email,
    subject: `Du hast einen Gutschein geschenkt bekommen – ${cfg.siteName}`,
    html: mailShell(
      `Hallo ${esc(an)},`,
      `<p><b>${esc(v.buyer_name)}</b> hat dir einen Gutschein für Personal Training geschenkt.</p>` +
        voucherCardHtml(v, env) +
        `<p style="margin-top:26px">Zum Einlösen meldest du dich einfach bei mir – per WhatsApp unter ${esc(cfg.ownerPhone)},
         per Mail an <a href="mailto:${esc(cfg.ownerEmail)}" style="color:#EFB92E">${esc(cfg.ownerEmail)}</a>
         oder du buchst direkt ein kostenloses Erstgespräch:</p>
         <p><a href="https://cal.com/fitnessdonner/kennenlernen" style="display:inline-block;background:#EFB92E;color:#15171C;font-weight:700;text-decoration:none;padding:14px 26px;letter-spacing:.06em;text-transform:uppercase;font-size:13px">Termin aussuchen</a></p>
         <p>Ich freue mich auf dich!<br>${esc(cfg.ownerName)}</p>`,
      env
    ),
  });
}

async function sendOwnerMail(v, env) {
  const cfg = config(env);
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
        ${row('Versand', v.delivery === 'gift' ? `direkt an ${esc(v.gift_email)}${v.send_date ? ` am ${fmtDate(v.send_date)}` : ' (sofort)'}` : 'an den Käufer')}
        ${row('Nachricht', esc(v.message) || '–')}
        ${row('Gültig bis', fmtDate(v.expires))}
      </table>
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
  return `<p style="margin-top:26px">Einlösen kann man den Gutschein per WhatsApp unter ${esc(cfg.ownerPhone)},
    per Mail an <a href="mailto:${esc(cfg.ownerEmail)}" style="color:#EFB92E">${esc(cfg.ownerEmail)}</a>
    oder direkt über ein kostenloses Erstgespräch.</p>
    <p style="color:#9AA0AB;font-size:13px">Die Rechnung zu deinem Kauf kommt separat von Stripe.
    Als Kleinunternehmer im Sinne von § 19 UStG berechne ich keine Umsatzsteuer.</p>`;
}

function voucherCardHtml(v, env) {
  const cfg = config(env);
  const fuer = v.recipient_name ? `Für <b style="color:#ECE9E2">${esc(v.recipient_name)}</b>` : '';
  const von = v.buyer_name ? `von ${esc(v.buyer_name)}` : '';
  return `
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#1C1F26;border:1px solid rgba(239,185,46,.45);margin:26px 0">
    <tr><td style="padding:32px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#EFB92E">Geschenkgutschein</div>
      <div style="font-size:34px;font-weight:800;color:#ECE9E2;letter-spacing:.02em;text-transform:uppercase;margin:14px 0 0">Personal Training</div>
      <div style="font-size:44px;font-weight:800;color:#EFB92E;margin:12px 0 4px">${fmtEur(v.amount_cents)}</div>
      <div style="font-size:15px;color:#9AA0AB">${fuer} ${von}</div>
      ${v.message ? `<div style="border-left:2px solid #EFB92E;padding:10px 0 10px 16px;margin:22px 0;font-style:italic;color:#c9cbd0">„${esc(v.message)}“</div>` : ''}
      <table style="width:100%;border-collapse:collapse;border-top:1px solid rgba(236,233,226,.12);margin-top:22px">
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

function mailShell(headline, inner, env) {
  const cfg = config(env);
  return `<!DOCTYPE html><html lang="de"><body style="margin:0;padding:0;background:#15171C">
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#15171C">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;color:#ECE9E2;font-size:16px;line-height:1.6">
        <tr><td style="padding-bottom:26px">
          <div style="font-size:12px;letter-spacing:.5em;color:#ECE9E2">FITNESS</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:.04em;color:#ECE9E2">DONNER</div>
          <div style="height:4px;width:120px;background:#EFB92E;margin-top:4px"></div>
        </td></tr>
        <tr><td>
          <div style="font-size:20px;font-weight:700;margin-bottom:12px">${headline}</div>
          ${inner}
        </td></tr>
        <tr><td style="padding-top:32px;border-top:1px solid rgba(236,233,226,.12);margin-top:20px;color:#9AA0AB;font-size:12px;line-height:1.7">
          ${esc(cfg.ownerName)} · ${esc(cfg.siteOrigin.replace('https://', ''))}<br>
          <a href="${cfg.siteOrigin}/impressum.html" style="color:#9AA0AB">Impressum</a> ·
          <a href="${cfg.siteOrigin}/datenschutz.html" style="color:#9AA0AB">Datenschutz</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendMail(env, { to, subject, html }) {
  const cfg = config(env);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: cfg.fromEmail,
      to: [to],
      reply_to: cfg.ownerEmail,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Mailversand fehlgeschlagen', res.status, text);
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* 6. Stripe-Helfer                                                    */
/* ------------------------------------------------------------------ */

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
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}
