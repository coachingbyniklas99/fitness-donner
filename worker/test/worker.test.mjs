import worker from '../src/index.js';

/* ---- Mock-KV ---- */
class KV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; }
}

const env = {
  VOUCHERS: new KV(),
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
  RESEND_API_KEY: 're_test',
};
const ctx = { waitUntil: (p) => p };

/* ---- fetch mocken ---- */
const sent = { stripe: [], mails: [] };
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.stripe.com')) {
    sent.stripe.push(Object.fromEntries(new URLSearchParams(opts.body)));
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url).includes('api.resend.com')) {
    sent.mails.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'mail_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('unerwarteter fetch: ' + url);
};

const post = (path, body, headers = {}) =>
  new Request('https://api.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://fitnessdonner.de', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' -> ' + JSON.stringify(extra)));
  if (!cond) fails++;
}

/* ---- 1. Checkout-Validierung ---- */
console.log('\n1) Checkout');
let r = await worker.fetch(post('/api/checkout', { amount: 5, buyerName: 'Max', buyerEmail: 'max@x.de' }), env, ctx);
check('Betrag zu klein wird abgelehnt', r.status === 400, await r.clone().json());

r = await worker.fetch(post('/api/checkout', { amount: 5000, buyerName: 'Max', buyerEmail: 'max@x.de' }), env, ctx);
check('Betrag zu groß wird abgelehnt', r.status === 400);

r = await worker.fetch(post('/api/checkout', { amount: 100, buyerName: 'Max', buyerEmail: 'keine-mail' }), env, ctx);
check('ungültige Mail wird abgelehnt', r.status === 400);

r = await worker.fetch(post('/api/checkout', { amount: 100, buyerName: '', buyerEmail: 'max@x.de' }), env, ctx);
check('fehlender Name wird abgelehnt', r.status === 400);

r = await worker.fetch(post('/api/checkout', { amount: 100, buyerName: 'Max', buyerEmail: 'max@x.de', delivery: 'gift', giftEmail: '' }), env, ctx);
check('Geschenkversand ohne Empfängermail wird abgelehnt', r.status === 400);

r = await worker.fetch(post('/api/checkout', {
  amount: 120, buyerName: 'Max Mustermann', buyerEmail: 'Max@Beispiel.DE',
  recipientName: 'Lisa', message: 'Alles Gute!', delivery: 'gift',
  giftEmail: 'lisa@beispiel.de', sendDate: '2026-12-24',
}), env, ctx);
const cj = await r.json();
const sp = sent.stripe[sent.stripe.length - 1];
check('gültige Anfrage liefert Stripe-URL', r.status === 200 && cj.url.includes('checkout.stripe.com'), cj);
check('Betrag in Cent korrekt', sp['line_items[0][price_data][unit_amount]'] === '12000', sp);
check('Mail wird kleingeschrieben', sp['customer_email'] === 'max@beispiel.de', sp['customer_email']);
check('Metadaten übernommen', sp['metadata[recipient_name]'] === 'Lisa' && sp['metadata[send_date]'] === '2026-12-24', sp);
check('CORS-Header gesetzt', r.headers.get('Access-Control-Allow-Origin') === 'https://fitnessdonner.de');

r = await worker.fetch(post('/api/checkout', { amount: 100, buyerName: 'Max', buyerEmail: 'max@x.de', delivery: 'gift', giftEmail: 'l@x.de', sendDate: '2020-01-01' }), env, ctx);
check('Versanddatum in der Vergangenheit wird verworfen', sent.stripe.at(-1)['metadata[send_date]'] === '');

/* ---- 2. Webhook ---- */
console.log('\n2) Webhook');
async function signed(payload, secret = 'whsec_testsecret', tOffset = 0) {
  const t = Math.floor(Date.now() / 1000) + tOffset;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

const evt = (id, meta, amount = 12000) => JSON.stringify({
  id, type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_' + id, amount_total: amount, currency: 'eur', customer_details: { email: 'max@beispiel.de' }, metadata: meta } },
});

let payload = evt('evt_1', { buyer_name: 'Max Mustermann', recipient_name: 'Lisa', message: 'Alles Gute!', delivery: 'gift', gift_email: 'lisa@beispiel.de', send_date: '' });
r = await worker.fetch(post('/api/webhook', payload, { 'stripe-signature': 't=1,v1=deadbeef' }), env, ctx);
check('falsche Signatur wird abgewiesen', r.status === 400);

r = await worker.fetch(post('/api/webhook', payload, { 'stripe-signature': await signed(payload, 'whsec_testsecret', -3600) }), env, ctx);
check('alter Zeitstempel wird abgewiesen (Replay-Schutz)', r.status === 400);

r = await worker.fetch(post('/api/webhook', payload, { 'stripe-signature': await signed(payload) }), env, ctx);
check('gültige Signatur wird akzeptiert', r.status === 200);
await new Promise(res => setTimeout(res, 50));

const codes = [...env.VOUCHERS.m.keys()].filter(k => k.startsWith('voucher:'));
check('Gutschein wurde angelegt', codes.length === 1, codes);
const v = JSON.parse(env.VOUCHERS.m.get(codes[0]));
check('Code hat das Format FD-XXXX-XXXX', /^FD-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(v.code), v.code);
check('Betrag gespeichert', v.amount_cents === 12000);
check('Ablauf = Jahresende +3', v.expires === `${new Date().getUTCFullYear() + 3}-12-31`, v.expires);
check('3 Mails verschickt (Käufer, Inhaber, Beschenkte)', sent.mails.length === 3, sent.mails.map(m => m.to));
check('Mail an Beschenkte enthält den Code', (sent.mails.find(m => m.to[0] === 'lisa@beispiel.de') || {}).html?.includes(v.code));
check('Mail an Inhaber geht an info@fitnessdonner.de', sent.mails.some(m => m.to[0] === 'info@fitnessdonner.de'), sent.mails.map(m => m.to));
check('Nachricht erscheint im Gutschein', sent.mails[0].html.includes('Alles Gute!'));

const before = sent.mails.length;
r = await worker.fetch(post('/api/webhook', payload, { 'stripe-signature': await signed(payload) }), env, ctx);
await new Promise(res => setTimeout(res, 50));
check('doppeltes Event wird ignoriert (Idempotenz)', sent.mails.length === before);

/* ---- 3. Geplanter Versand ---- */
console.log('\n3) Geplanter Versand');
const heute = new Date().toISOString().slice(0, 10);
let p2 = evt('evt_2', { buyer_name: 'Anna', recipient_name: 'Tom', message: '', delivery: 'gift', gift_email: 'tom@beispiel.de', send_date: heute }, 5000);
await worker.fetch(post('/api/webhook', p2, { 'stripe-signature': await signed(p2) }), env, ctx);
await new Promise(res => setTimeout(res, 50));
check('kein Sofortversand bei Wunschdatum', !sent.mails.some(m => m.to[0] === 'tom@beispiel.de'), sent.mails.map(m => m.to));
check('Vormerkung angelegt', [...env.VOUCHERS.m.keys()].some(k => k.startsWith(`pending:${heute}:`)));

await worker.scheduled({}, env, ctx);
await new Promise(res => setTimeout(res, 50));
check('Cron verschickt am Stichtag', sent.mails.some(m => m.to[0] === 'tom@beispiel.de'));
check('Vormerkung wurde entfernt', ![...env.VOUCHERS.m.keys()].some(k => k.startsWith(`pending:${heute}:`)));

/* ---- 4. Abruf ---- */
console.log('\n4) Gutschein-Abruf');
const get = (qs) => new Request('https://api.test/api/voucher?' + qs, { headers: { Origin: 'https://fitnessdonner.de' } });
r = await worker.fetch(get('session_id=cs_test_evt_1'), env, ctx);
const d = await r.json();
check('Abruf per session_id liefert den Gutschein', r.status === 200 && d.code === v.code, d);
check('Betrag formatiert', d.amount_formatted === '120 €', d.amount_formatted);

r = await worker.fetch(get('session_id=cs_unbekannt'), env, ctx);
check('unbekannte Session -> pending', r.status === 202);

r = await worker.fetch(get(`code=${v.code}&t=${v.token}`), env, ctx);
check('Abruf per Code+Token funktioniert', r.status === 200);

r = await worker.fetch(get(`code=${v.code}&t=falsch`), env, ctx);
check('falscher Token wird abgewiesen', r.status === 403);

r = await worker.fetch(get('code=FD-XXXX-XXXX&t=abc'), env, ctx);
check('unbekannter Code -> 404', r.status === 404);

console.log('\n' + (fails === 0 ? 'ALLE TESTS BESTANDEN' : fails + ' TEST(S) FEHLGESCHLAGEN'));
process.exit(fails ? 1 : 0);
