/* Tests für worker-code-25: Versand zur Wunsch-Uhrzeit, neue Mail an Beschenkte.
   Start: node worker/test/gutschein-zeit.test.mjs */
import worker from '../worker-code-25.js';

class KV {
  constructor() { this.m = new Map(); }
  async get(k, t) { if (!this.m.has(k)) return null; const v = this.m.get(k); return (t === 'json' || (t && t.type === 'json')) ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
}
const env = { VOUCHERS: new KV(), STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_testsecret', RESEND_API_KEY: 're_test', SITE_ORIGIN: 'https://fitnessdonner.de', OWNER_EMAIL: 'info@fitnessdonner.de' };
const ctx = { waitUntil: (p) => p };

const sent = { stripe: [], mails: [], andere: [] };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.stripe.com')) { sent.stripe.push(Object.fromEntries(new URLSearchParams(opts && opts.body))); return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.includes('api.resend.com')) { sent.mails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: 'mail_' + sent.mails.length }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  sent.andere.push(u);
  return new Response('x', { status: 404 });
};

const post = (path, body, headers = {}) => new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fitnessdonner.de', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
let fails = 0;
function check(name, cond, extra) { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' -> ' + JSON.stringify(extra))); if (!cond) fails++; }
const warte = () => new Promise((r) => setTimeout(r, 60));

/* Berliner Datum heute / gestern / morgen */
const fmt = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(ms));
const heute = fmt(Date.now()), gestern = fmt(Date.now() - 864e5), morgen = fmt(Date.now() + 864e5);
const basis = { amount: 119, buyerName: 'Niklas Donner', buyerEmail: 'n@beispiel.de', recipientName: 'Lisa', message: 'Keine Socken!', delivery: 'gift', giftEmail: 'lisa@beispiel.de' };
const meta = () => sent.stripe.at(-1);

console.log('\n1) Checkout: Tag und Uhrzeit');
let r = await worker.fetch(post('/api/checkout', { ...basis, sendDate: morgen + 'T08:15' }), env, ctx);
check('Tag + Uhrzeit werden übernommen', r.status === 200 && meta()['metadata[send_date]'] === morgen && meta()['metadata[send_time]'] === '08:15', meta());
await worker.fetch(post('/api/checkout', { ...basis, sendDate: morgen }), env, ctx);
check('nur Tag (altes Formular) bleibt gültig, Uhrzeit leer', meta()['metadata[send_date]'] === morgen && meta()['metadata[send_time]'] === '', meta());
await worker.fetch(post('/api/checkout', { ...basis, sendDate: morgen + 'T08:10' }), env, ctx);
check('krumme Uhrzeit wird ignoriert, Tag bleibt', meta()['metadata[send_date]'] === morgen && meta()['metadata[send_time]'] === '', meta());
await worker.fetch(post('/api/checkout', { ...basis, sendDate: gestern + 'T08:00' }), env, ctx);
check('Zeitpunkt in der Vergangenheit = sofort', meta()['metadata[send_date]'] === '' && meta()['metadata[send_time]'] === '', meta());
await worker.fetch(post('/api/checkout', { ...basis, sendDate: heute + 'T00:00' }), env, ctx);
check('heute, Uhrzeit schon vorbei = sofort', meta()['metadata[send_date]'] === '', meta());
await worker.fetch(post('/api/checkout', { ...basis, delivery: 'buyer', sendDate: morgen + 'T08:15' }), env, ctx);
check('"An mich" bleibt immer sofort', meta()['metadata[send_date]'] === '' && meta()['metadata[send_time]'] === '', meta());
await worker.fetch(post('/api/checkout', { ...basis, sendDate: '2099-12-24T08:00' }), env, ctx);
check('mehr als ein Jahr voraus wird verworfen', meta()['metadata[send_date]'] === '', meta());

console.log('\n2) Webhook und Vormerkung');
async function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_testsecret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const evt = (id, m, amount = 11900) => JSON.stringify({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_' + id, amount_total: amount, currency: 'eur', payment_status: 'paid', customer_details: { email: 'n@beispiel.de' }, metadata: m } } });
async function kauf(id, m) { const p = evt(id, { buyer_name: 'Niklas Donner', recipient_name: 'Lisa', message: 'Keine Socken!', delivery: 'gift', ...m }); const res = await worker.fetch(post('/api/webhook', p, { 'stripe-signature': await signed(p) }), env, ctx); await warte(); return res; }
const pend = () => [...env.VOUCHERS.m.keys()].filter((k) => k.startsWith('pending:'));
const anMail = (adr) => sent.mails.filter((m) => m.to[0] === adr);

r = await kauf('evt_spaet', { gift_email: 'spaet@beispiel.de', send_date: morgen, send_time: '08:15', design: 'nik' });
check('Webhook angenommen', r.status === 200, r.status);
check('noch keine Mail an die beschenkte Person', anMail('spaet@beispiel.de').length === 0);
check('Vormerkung mit Uhrzeit im Schlüssel', pend().some((k) => k.startsWith(`pending:${morgen}T08:15:FD-`)), pend());
const owner1 = anMail('info@fitnessdonner.de').at(-1);
check('Inhaber-Mail nennt die Uhrzeit', !!owner1 && owner1.html.includes('um 08:15 Uhr'), owner1 && owner1.subject);
check('Inhaber-Mail warnt, solange der Viertelstunden-Cron nie lief', !!owner1 && owner1.html.includes('Viertelstunden-Zeitplan'));
const kaeufer1 = anMail('n@beispiel.de').at(-1);
check('Käufer-Mail nennt Tag und Uhrzeit', !!kaeufer1 && kaeufer1.html.includes('um <b>08:15 Uhr</b>'), kaeufer1 && kaeufer1.subject);

await kauf('evt_faellig', { gift_email: 'faellig@beispiel.de', send_date: heute, send_time: '00:00', design: 'xmas' });
check('fällige Vormerkung wartet auf den Cron', anMail('faellig@beispiel.de').length === 0 && pend().length === 2, pend());

console.log('\n3) Viertelstunden-Cron');
env.VOUCHERS.m.set(`voucher:FD-ALT1-ALT1`, JSON.stringify({ code: 'FD-ALT1-ALT1', token: 'tok', amount_cents: 5000, buyer_name: 'Anna', recipient_name: 'Tom', message: '', delivery: 'gift', gift_email: 'alt@beispiel.de', send_date: gestern, expires: '2029-12-31', status: 'active', sent: false }));
env.VOUCHERS.m.set(`pending:${gestern}:FD-ALT1-ALT1`, 'FD-ALT1-ALT1');
await worker.scheduled({ cron: '*/15 * * * *' }, env, ctx); await warte();
check('fälliger Gutschein (heute 00:00) geht raus', anMail('faellig@beispiel.de').length === 1);
check('liegengebliebener alter Eintrag ohne Uhrzeit geht raus', anMail('alt@beispiel.de').length === 1);
check('Gutschein für morgen bleibt liegen', anMail('spaet@beispiel.de').length === 0 && pend().length === 1, pend());
check('Merker für den Viertelstunden-Cron gesetzt', env.VOUCHERS.m.has('gs:takt'));
await worker.scheduled({ cron: '*/15 * * * *' }, env, ctx); await warte();
check('kein doppelter Versand beim nächsten Lauf', anMail('faellig@beispiel.de').length === 1 && anMail('alt@beispiel.de').length === 1);
const gespeichert = [...env.VOUCHERS.m.entries()].filter(([k]) => k.startsWith('voucher:')).map(([, v]) => JSON.parse(v)).find((v) => v.gift_email === 'faellig@beispiel.de');
check('Gutschein als verschickt markiert', gespeichert && gespeichert.sent === true);

console.log('\n4) Mail an die beschenkte Person');
const g = anMail('faellig@beispiel.de')[0];
check('Betreff ohne Betrag', g.subject === 'Niklas hat dir etwas eingepackt', g.subject);
check('Link zur Auspack-Seite mit Code und Token', g.html.includes(`https://fitnessdonner.de/auspacken.html?code=${encodeURIComponent(gespeichert.code)}&amp;t=${encodeURIComponent(gespeichert.token)}`), g.html.match(/auspacken[^"]*/));
check('Geschenkbild passend zum Design (Weihnachten)', /geschenk-xmas/.test(g.html) || (g.attachments || []).some((a) => /geschenk-xmas/.test(a.filename || '')), (g.html.match(/geschenk-[a-z]+/g) || []));
check('keine Notfall-Zeile mit Code mehr', !g.html.includes('Falls der Button') && !g.html.includes('>' + gespeichert.code + '<'), g.html.slice(-1500));
check('Fragen nur noch per WhatsApp', g.html.includes('Bei Fragen oder Problemen schreib mir einfach direkt per WhatsApp') && !g.html.includes('Ruf einfach an') && !g.html.includes('Noch Fragen?'));
check('Betrag steht nicht in der Mail', !g.html.includes('119 €') && !g.html.includes('119&nbsp;€'));
check('Nachricht steht nicht in der Mail', !g.html.includes('Keine Socken!'));
check('Textfassung vorhanden', typeof g.text === 'string' && g.text.includes('Geschenk auspacken'), (g.text || '').slice(0, 200));
const alt = anMail('alt@beispiel.de')[0];
check('ohne Festtagsdesign: Standard-Geschenkbild', /geschenk-std/.test(alt.html) || (alt.attachments || []).some((a) => /geschenk-std/.test(a.filename || '')));

console.log('\n5) Sofortversand und Abruf');
await kauf('evt_sofort', { gift_email: 'sofort@beispiel.de', send_date: '', send_time: '' });
check('ohne Datum geht die Mail sofort raus', anMail('sofort@beispiel.de').length === 1);
const owner2 = anMail('info@fitnessdonner.de').at(-1);
check('Inhaber-Mail ohne Warnung bei Sofortversand', !owner2.html.includes('Viertelstunden-Zeitplan'));
await kauf('evt_spaet2', { gift_email: 'spaet2@beispiel.de', send_date: morgen, send_time: '18:30' });
check('keine Warnung mehr, sobald der Viertelstunden-Cron lief', !anMail('info@fitnessdonner.de').at(-1).html.includes('Viertelstunden-Zeitplan'));
r = await worker.fetch(new Request(`https://api.test/api/voucher?code=${gespeichert.code}&t=${gespeichert.token}`, { headers: { Origin: 'https://fitnessdonner.de' } }), env, ctx);
const d = await r.json();
check('Abruf liefert alles für die Auspack-Seite', r.status === 200 && d.code === gespeichert.code && d.recipient_name === 'Lisa' && d.message === 'Keine Socken!' && d.design === 'xmas' && d.send_time === '00:00' && !!d.amount_formatted && !!d.expires, d);
r = await worker.fetch(new Request(`https://api.test/api/voucher?code=${gespeichert.code}&t=falsch`, { headers: { Origin: 'https://fitnessdonner.de' } }), env, ctx);
check('Abruf mit falschem Token wird abgelehnt', r.status === 403, r.status);
r = await worker.fetch(new Request(`https://api.test/api/voucher-pdf?code=${gespeichert.code}&t=${gespeichert.token}`), env, ctx);
const pdfBytes = new Uint8Array(await r.arrayBuffer());
check('PDF-Download liefert ein PDF', r.status === 200 && r.headers.get('Content-Type') === 'application/pdf' && String.fromCharCode(...pdfBytes.slice(0, 5)) === '%PDF-' && pdfBytes.length > 800, { status: r.status, typ: r.headers.get('Content-Type'), len: pdfBytes.length, kopf: String.fromCharCode(...pdfBytes.slice(0, 8)) });
check('PDF-Download als Datei mit Code im Namen', (r.headers.get('Content-Disposition') || '').includes(`Gutschein-Fitness-Donner-${gespeichert.code}.pdf`), r.headers.get('Content-Disposition'));
r = await worker.fetch(new Request(`https://api.test/api/voucher-pdf?code=${gespeichert.code}&t=falsch`), env, ctx);
check('PDF-Download mit falschem Token wird abgelehnt', r.status === 403, r.status);

console.log('\n6) Morgenlauf (täglicher Cron) holt ebenfalls nach');
env.VOUCHERS.m.set(`voucher:FD-ALT2-ALT2`, JSON.stringify({ code: 'FD-ALT2-ALT2', token: 'tok', amount_cents: 5000, buyer_name: 'Anna', recipient_name: 'Tom', message: '', delivery: 'gift', gift_email: 'alt2@beispiel.de', send_date: gestern, send_time: '20:00', expires: '2029-12-31', status: 'active', sent: false }));
env.VOUCHERS.m.set(`pending:${gestern}T20:00:FD-ALT2-ALT2`, 'FD-ALT2-ALT2');
try { await worker.scheduled({ cron: '10 7 * * *' }, env, ctx); await warte(); await warte(); } catch (e) { console.log('  (Morgenlauf: Nebenaufgabe warf', String(e).slice(0, 80), ')'); }
check('Morgenlauf verschickt Liegengebliebenes', anMail('alt2@beispiel.de').length === 1);

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);
