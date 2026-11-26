# Live-Stand des Workers (fitnessdonner-gutscheine)

**Stand 26.11.2026, ca. 12:00 Uhr: „worker-code-43“ (KUNDE2), Version 3d95a03d (Nr. 77), 100 % aktiv.** Rückfall: Version 6dca5ea5 (Nr. 76, ohne „trainierte Person“ in Liste/Profil/Karten) oder b8832036 (worker-code-42).
= worker-code-42 plus Kunden ohne E-Mail, Stammdaten, Zahler/trainierte Person, Karte per Zahlungslink. Der Block liegt als `worker/kunde2-block.js` im Repository; Haken im Worker: `KUNDE2-HOOK` (sendMail, handleAdmin, createCardFromSession, karteNeu ×2, kundenListe, kundenProfil, adminCodes).

## Davor

Stand 26.11.2026, 10:37 Uhr: „worker-code-42“ (FARBWAHL), Version b8832036, 100 % aktiv.**
= worker-code-41 (probe-1, Version 614d8f24) plus Farbe getrennt vom Anlass. Eingespielt über die Cloudflare-API aus dem Dashboard;
die Änderung steht als Ersetzungsliste im Projekt (Claude outputs/farbwahl-2026-11-26). Der vollständige Code liegt nicht im Repository —
vor dem nächsten Einspielen den Live-Code bei Cloudflare holen und als Basis nehmen.

## Ältere Stände

Stand 19.11.2026, Hash (sha256, erste 16 Zeichen des worker.js): **4e27e2b0d5110d8c** = „worker-code-38“ (= 37 mit Kundentexten ohne „Prämie“; davor 37 = f8789c81465f7d42)

- Basis: die Live-Fassung „worker-code-36“ aus einer anderen Sitzung (RECHNUNG-OFFEN: Karte ohne Zahlung, mehrere Termine auf einmal mit Sammelmail). **Dieser Code liegt nicht im Repository.**
- Darauf gesetzt: der Prämien-Block (GET/POST /api/kurse/praemie, KURS_PRAEMIEN, K.praemie, zwei Router-Zeilen) aus `worker-code-36-praemie-auf-35.js`.

Wichtig vor dem nächsten Einspielen: den Live-Code bei Cloudflare herunterladen und als Basis nehmen (oder die RECHNUNG-OFFEN-Fassung ins Repo legen), sonst gehen entweder die Rechnungs-Funktionen oder die Prämie verloren.
