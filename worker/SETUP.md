# Gutscheinverkauf einrichten

Diese Anleitung führt einmal komplett durch das Setup. Rechne mit 60–90 Minuten,
plus Wartezeit für die DNS-Freischaltung bei Resend.

## Wie es funktioniert

```
Besucher füllt gutschein.html aus
        │
        ▼
Cloudflare Worker  /api/checkout   ──►  Stripe erstellt eine Checkout-Seite
        │                                        │
        │                                        ▼
        │                               Besucher bezahlt bei Stripe
        │                                        │
        ▼                                        ▼
Worker /api/webhook  ◄──────────  Stripe meldet "bezahlt"
        │
        ├─► Gutschein-Code erzeugen und in Cloudflare KV speichern
        ├─► Gutschein-Mail an den Käufer
        ├─► Benachrichtigung an dich
        └─► auf Wunsch: Mail an die beschenkte Person (sofort oder am Wunschtag)
```

Die Website selbst bleibt statisch auf GitHub Pages. Alles, was einen Server
braucht, läuft im Worker – kostenlos im Free-Tarif von Cloudflare
(100.000 Anfragen/Tag; ein Gutscheinkauf sind ca. 5).

## Was du brauchst

| Dienst | Wofür | Kosten |
|---|---|---|
| Stripe | Zahlungsabwicklung | 1,5 % + 0,25 € je Kartenzahlung, keine Grundgebühr |
| Cloudflare | Worker + Datenspeicher (KV) | kostenlos |
| Resend | Versand der Gutschein-Mails | kostenlos bis 3.000 Mails/Monat |
| Zugriff auf die DNS-Einstellungen von fitnessdonner.de | Absenderadresse verifizieren | – |

---

## 1. Resend einrichten (zuerst, weil DNS Zeit braucht)

1. Konto auf [resend.com](https://resend.com) anlegen.
2. **Domains → Add Domain →** `fitnessdonner.de` eintragen, Region `eu-west-1` wählen.
3. Resend zeigt drei DNS-Einträge an (MX + zwei TXT für DKIM/SPF). Diese Einträge
   bei dem Anbieter eintragen, bei dem `fitnessdonner.de` verwaltet wird.
4. Auf **Verify** klicken. Die Freischaltung dauert meist Minuten, manchmal Stunden.
5. **API Keys → Create API Key** (Berechtigung: *Sending access*). Der Schlüssel
   (`re_…`) wird nur einmal angezeigt – gut aufbewahren.

Die Absenderadresse ist `gutschein@fitnessdonner.de` (in `wrangler.toml` änderbar).
Ein echtes Postfach dafür ist nicht nötig; Antworten laufen über `Reply-To` an
`info@fitnessdonner.de`.

---

## 2. Cloudflare einrichten

1. Konto auf [dash.cloudflare.com](https://dash.cloudflare.com) anlegen.
   Die Domain muss dafür **nicht** zu Cloudflare umziehen.
2. **Storage & Databases → KV → Create namespace**, Name: `VOUCHERS`.
   Die angezeigte ID kopieren und in `worker/wrangler.toml` bei
   `id = "HIER_DIE_KV_ID_EINTRAGEN"` einsetzen.
3. Worker deployen – am einfachsten vom eigenen Rechner aus:

   ```bash
   cd worker
   npx wrangler login          # öffnet den Browser zum Anmelden
   npx wrangler deploy
   ```

4. Secrets setzen (werden verschlüsselt gespeichert und sind später nicht mehr lesbar):

   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put RESEND_API_KEY
   ```

   Alternativ im Dashboard unter **Workers & Pages → fitnessdonner-gutscheine →
   Settings → Variables and Secrets**.

5. Nach dem Deploy zeigt Wrangler die Adresse des Workers an, etwa
   `https://fitnessdonner-gutscheine.<dein-name>.workers.dev`.
   Diese Adresse in **beiden** Dateien bei `var API_BASE = …` eintragen:
   - `gutschein.html`
   - `gutschein-danke.html`

---

## 3. Stripe einrichten

1. Im [Stripe-Dashboard](https://dashboard.stripe.com) oben rechts prüfen, ob der
   **Testmodus** aktiv ist – damit wird zuerst getestet.
2. **Entwickler → API-Schlüssel →** *Geheimer Schlüssel* (`sk_test_…`) kopieren.
   Das ist `STRIPE_SECRET_KEY`.
3. **Entwickler → Webhooks → Endpunkt hinzufügen**
   - URL: `https://fitnessdonner-gutscheine.<dein-name>.workers.dev/api/webhook`
   - Ereignis: `checkout.session.completed`
   - Nach dem Anlegen das **Signing secret** (`whsec_…`) kopieren –
     das ist `STRIPE_WEBHOOK_SECRET`.
4. **Einstellungen → Zahlungen → Zahlungsmethoden**: Kreditkarte, Apple Pay,
   Google Pay, PayPal und Klarna aktivieren, was du anbieten möchtest.
5. **Einstellungen → Kundenmails**: „Erfolgreiche Zahlungen" aktivieren, damit
   Käufer automatisch einen Zahlungsbeleg von Stripe bekommen.
6. **Einstellungen → Geschäftsdaten**: Adresse und Kontakt hinterlegen, damit sie
   auf den Belegen erscheinen. Im Feld für Fußnoten den Hinweis ergänzen:
   *„Als Kleinunternehmer im Sinne von § 19 Abs. 1 UStG wird keine Umsatzsteuer berechnet."*

---

## 4. Testlauf

1. Sicherstellen, dass in beiden HTML-Dateien die richtige `API_BASE` steht und die
   Testmodus-Schlüssel im Worker hinterlegt sind.
2. `gutschein.html` im Browser öffnen, 20 € wählen, Formular ausfüllen.
3. Bei Stripe mit der Testkarte bezahlen: `4242 4242 4242 4242`,
   beliebiges Datum in der Zukunft, beliebige Prüfziffer.
4. Erwartetes Ergebnis:
   - Weiterleitung auf `gutschein-danke.html` mit sichtbarem Gutschein-Code
   - Gutschein-Mail im Postfach des Käufers
   - Benachrichtigung an `info@fitnessdonner.de`
   - bei „direkt an die beschenkte Person": zusätzliche Mail dorthin
5. Läuft etwas schief: **Cloudflare → Worker → Logs** (Live-Ansicht) zeigt die
   Fehlermeldung, und **Stripe → Webhooks** zeigt, ob die Zustellung geklappt hat.

## 5. Live schalten

1. In Stripe in den **Live-Modus** wechseln.
2. Dort erneut einen Webhook-Endpunkt für dieselbe URL anlegen (Live-Modus hat
   eigene Schlüssel) und die beiden Live-Schlüssel als Secrets neu setzen:

   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_…
   npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_… (Live-Endpunkt)
   ```

3. Einen echten Kauf über einen kleinen Betrag machen und danach in Stripe
   zurückerstatten – so ist die komplette Kette einmal echt getestet.

---

## Gutscheine verwalten

Alle Gutscheine liegen im KV-Namespace `VOUCHERS`
(**Cloudflare → Storage & Databases → KV → VOUCHERS**), ein Eintrag je Gutschein
unter dem Schlüssel `voucher:FD-XXXX-XXXX`:

```json
{
  "code": "FD-7K4M-92XA",
  "amount_cents": 12000,
  "buyer_name": "Max Mustermann",
  "buyer_email": "max@beispiel.de",
  "recipient_name": "Lisa",
  "expires": "2029-12-31",
  "status": "active",
  "redeemed_cents": 0
}
```

Beim Einlösen `redeemed_cents` hochsetzen bzw. `status` auf `redeemed` ändern –
oder du führst die Einlösung einfach in Notion. Der Worker prüft das aktuell nicht
automatisch; ein Kunde kann einen Code also theoretisch zweimal vorlegen. Bei den
zu erwartenden Stückzahlen ist die manuelle Kontrolle völlig ausreichend.

## Später nachrüstbar

- **Gutschein als PDF im Anhang** statt nur als HTML-Mail mit Druckfunktion
- **Einlöse-Übersicht** als geschützte Seite statt Blick ins KV-Dashboard
- **Feste Pakete** (z. B. 1 und 3 Einheiten mit Rabatt): Der Worker akzeptiert
  jeden Betrag, es bräuchte nur zusätzliche Auswahlkarten in `gutschein.html`
- **Firmen-/Sammelgutscheine** mit mehreren Codes pro Kauf

## Wichtig

Die Texte in `gutschein-bedingungen.html` (Gutscheinbedingungen und
Widerrufsbelehrung) sind sorgfältig formuliert, aber keine Rechtsberatung.
Wenn du regelmäßig Gutscheine verkaufst, lass sie einmal anwaltlich oder von
einem Verband (z. B. IHK-Beratung) prüfen – gerade Widerrufsbelehrungen sind ein
klassischer Abmahnpunkt.

## Tests

```bash
cd worker/test && node worker.test.mjs
```

Prüft Betragsgrenzen, Pflichtfelder, Webhook-Signatur inklusive Replay-Schutz,
Idempotenz, Code-Erzeugung, Ablaufdatum, Mailversand und den geplanten Versand.
