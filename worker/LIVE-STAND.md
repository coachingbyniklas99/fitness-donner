# Live-Stand des Workers (fitnessdonner-gutscheine)

Stand 19.11.2026, Hash (sha256, erste 16 Zeichen des worker.js): **4e27e2b0d5110d8c** = „worker-code-38“ (= 37 mit Kundentexten ohne „Prämie“; davor 37 = f8789c81465f7d42)

- Basis: die Live-Fassung „worker-code-36“ aus einer anderen Sitzung (RECHNUNG-OFFEN: Karte ohne Zahlung, mehrere Termine auf einmal mit Sammelmail). **Dieser Code liegt nicht im Repository.**
- Darauf gesetzt: der Prämien-Block (GET/POST /api/kurse/praemie, KURS_PRAEMIEN, K.praemie, zwei Router-Zeilen) aus `worker-code-36-praemie-auf-35.js`.

Wichtig vor dem nächsten Einspielen: den Live-Code bei Cloudflare herunterladen und als Basis nehmen (oder die RECHNUNG-OFFEN-Fassung ins Repo legen), sonst gehen entweder die Rechnungs-Funktionen oder die Prämie verloren.
