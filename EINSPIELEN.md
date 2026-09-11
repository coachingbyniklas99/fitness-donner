# Live schalten – in dieser Reihenfolge

Wichtig: **Erst der Worker, dann die Website.** Der neue Worker kann alles, was der alte
kann – die neue Website braucht aber Endpunkte, die es im alten Worker noch nicht gibt.
Andersherum stünde die Buchungsseite ein paar Minuten im Leeren.

---

## Schritt 1 – Worker aktualisieren (5 Minuten)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages →
   fitnessdonner-gutscheine → Bearbeiten** (Code-Editor).
2. Den gesamten Inhalt von **`worker-code.txt`** kopieren und den alten Code komplett
   damit ersetzen.
3. **Bereitstellen** klicken.

## Schritt 2 – Passwort fürs Backend setzen

1. Im selben Worker: **Einstellungen → Variablen und Secrets → Hinzufügen**
2. Typ **Secret**, Name genau `ADMIN_PASSWORT`, Wert: ein Passwort deiner Wahl.
   Nimm eins, das du sonst nirgends benutzt, und leg es in Bitwarden ab.
3. **Bereitstellungen → Version befördern** – ohne diesen Schritt ist das Secret nicht aktiv.
   (Genau der Punkt, an dem wir beim Stripe-Schlüssel schon einmal hingen.)

## Schritt 3 – Website hochladen

1. [github.com/coachingbyniklas99/fitness-donner](https://github.com/coachingbyniklas99/fitness-donner)
   → **Add file → Upload files**
2. Den **Inhalt** des Ordners `website` hineinziehen (nicht den Ordner selbst).
3. Unten Beschreibung eintragen, z. B. *Buchungssystem, Karten und Backend*, dann
   **Commit changes**.
4. Nach zwei bis drei Minuten ist alles unter fitnessdonner.de live.

## Schritt 4 – Prüfen

- `fitnessdonner.de/termin-buchen.html` → Termine müssen erscheinen
- `fitnessdonner.de/admin.html` → Anmelden mit deinem Passwort
- Einen echten Testkauf über einen kleinen Betrag machen und in Stripe zurückerstatten.
  **Das steht immer noch aus** – der Live-Webhook hat bis heute nie ausgelöst.

## Später, wenn du Zeit hast

- Google-Kalender-Synchronisation: Anleitung in `GOOGLE-KALENDER.md`, etwa 15 Minuten.
- Das kostenlose Erstgespräch ist raus – Einstieg ist jetzt das Probetraining für 29 €,
  Fragen laufen über Telefon und WhatsApp. Steht überall auf der Seite unter jedem Button.

---

# Das Backend

**Adresse:** fitnessdonner.de/admin.html
Am Handy im Browser öffnen → Teilen → **Zum Home-Bildschirm** – dann liegt es wie eine
App auf dem Startbildschirm. Die Anmeldung hält 30 Tage.

## Was drin ist

**Termine** – alle kommenden Buchungen mit Name, Ort, Telefonnummer zum Antippen,
E-Mail und dem, was die Person ins Formular geschrieben hat. Absagen geht mit zwei
Klicks (der zweite ist die Sicherheitsabfrage); der Kunde bekommt automatisch eine Mail,
und eine Karteneinheit oder ein Gutscheinguthaben wird wieder freigegeben.

**Sperren** – der Fall, für den du das wolltest: Jemand ruft an und bucht direkt bei dir.
Tag auswählen, Uhrzeit antippen, weg ist der Slot. Genauso lässt sich ein ganzer Tag
sperren, für Urlaub oder Krankheit. Alles Gesperrte steht darunter und lässt sich mit
einem Klick wieder freigeben.

**Codes** – alle Gutscheine und Karten, durchsuchbar nach Code, Name oder E-Mail.
Du siehst Restwert bzw. freie Einheiten und kannst korrigieren: Einheit gutschreiben,
Einheit abziehen, um ein Jahr verlängern, stornieren oder wieder aktivieren.
Über **Neu ausstellen** legst du eine Karte oder einen Gutschein von Hand an – für
Barzahlung oder Kulanz. Der Code geht sofort per Mail raus, ohne Stripe.

**Preise** – Personal Training, Probetraining und der Einheitenpreis beider Karten.
Gilt sofort für alle neuen Buchungen; schon verkaufte Karten behalten ihren Preis.
Dazu Mindestvorlauf und wie weit im Voraus gebucht werden kann.

## Was bewusst nicht drin ist

- **Umsatzzahlen** – das kann Stripe besser, und doppelte Zahlen führen zu Zweifeln.
- **Rückerstattungen** – laufen über Stripe. Beim Absagen sagt dir das Backend, wie viel
  bezahlt wurde, damit du weißt, was zu erstatten ist.
- **Verfügbarkeiten ändern** (neue Wochentage, neue Uhrzeiten) – steht noch im Code.
  Das ist der nächste sinnvolle Ausbau, sobald sich dein Fahrplan wirklich ändert.
- **Die Preistexte auf preise.html** – die stehen als Text auf der Seite. Wenn du im
  Backend die Preise änderst, ändert sich die Preisseite nicht mit. Sag mir Bescheid,
  dann ziehe ich sie nach.

---

# Fotos vom New Forge

Erledigt. Fünf Bilder liegen im Repo und sind eingebaut:

| Datei | Wo sie erscheint |
|---|---|
| `newforge-studio.webp` | Startseite (Solingen-Block), Solingen-Seite, Terminbuchung |
| `newforge-sprint.webp` | Galerie "Dein Studio" |
| `newforge-rack.webp` | Galerie |
| `newforge-kursraum.webp` | Galerie |
| `newforge-power.webp` | Galerie |

Die Galerie steht auf `personal-training-solingen.html` unter dem Studio-Block:
großes Bild, Pfeile, fünf Miniaturen, auf dem Handy auch zum Wischen.

**Ein weiteres Bild aufnehmen:** in `personal-training-solingen.html` nach
`galStudio` suchen und eine Zeile nach demselben Muster ergänzen –
`<img src="…" loading="lazy" alt="…" data-cap="…">`. Die Miniatur baut das
Skript von allein, der Text unter `data-cap` erscheint als Bildunterschrift.
Bei mehr als fünf Bildern in `style.css` das `repeat(5,1fr)` bei `.gal-th`
auf die neue Anzahl setzen.

## Logo von New Forge

Als **`newforge-logo.svg`** ablegen (weiße Variante, die passt auf den dunklen Grund).
Dann an zwei Stellen den markierten Kommentar ersetzen:

- `index.html`, Partner-Streifen: `<img src="newforge-logo.svg" alt="New Forge Coworking">`
  statt der Wortmarke `<span class="pl-wort">…</span>`
- `personal-training-solingen.html`, Studio-Block: dasselbe im `.studio-partner`

Beide Stellen sind im Quelltext mit einem Kommentar markiert – such nach `newforge-logo`.
