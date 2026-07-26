# Trainingscoach — zelf-gehoste versie

Persoonlijke trainingslog en AI-coach voor fietsen, hardlopen en krachttraining.
Draait volledig op je eigen hardware (bijv. een Raspberry Pi), met je eigen data
in een lokale database.

Dit is de omzetting van het Claude-artifact-prototype naar een echte applicatie:
dezelfde functionaliteit en berekeningen, maar nu met een eigen backend, database
en versiebeheer.

## Twee projecten

| Map | Wat het is |
|---|---|
| `trainingscoach-server/` | Node.js/Express + SQLite. API, database, en de server-side aanroep naar Anthropic voor de AI-coach. |
| `trainingscoach-frontend/` | React (Vite). De interface, die tegen de API praat. |

De frontend bouwt naar `trainingscoach-server/public/`, waarna de server beide
serveert op één poort.

## Wat de app kan

- **Krachttraining loggen** tegen een vast schema, met de vorige sessie als referentie
- **Cardio importeren** uit Strava/Garmin CSV-exports (bulk) en GPX-bestanden
  (inclusief het verloop *binnen* een sessie: hartslag, snelheid, vermogen, cadans, hoogte)
- **Gewicht bijhouden**, automatisch gebruikt voor watt-per-kilo
- **Trainingsbelasting** volgens het standaard Performance Management Chart-model
  (TSS, CTL, ATL, TSB) — dezelfde formules als TrainingPeaks/WKO, puur berekend
- **Hartslag- en vermogenszones** op basis van je max. hartslag, rusthartslag en FTP
- **AI-coach** die bovenop die harde cijfers analyse, tips en een cardiovoorstel geeft

De rekenkern is bewust deterministisch en los van de AI: de coach krijgt de
berekende cijfers aangereikt en interpreteert ze, in plaats van ze zelf te schatten.

## Installatievolgorde (op de Pi)

```bash
# 1. Repo ophalen
git clone https://github.com/<jouw-gebruikersnaam>/trainingscoach.git
cd trainingscoach

# 2. Backend
cd trainingscoach-server
npm install
cp .env.example .env
nano .env                 # vul ANTHROPIC_API_KEY in
npm test                  # controleert de rekenkern
cd ..

# 3. Frontend bouwen (schrijft naar server/public/)
cd trainingscoach-frontend
npm install
npm run build
cd ..

# 4. Starten
cd trainingscoach-server
npm start
```

Ga daarna naar `http://<ip-van-je-pi>:3001`.

## Je bestaande data overzetten

Exporteer in de artifact-versie via Schema → "Exporteer alles (JSON)", en importeer
dat bestand daarna:

```bash
curl -X POST http://localhost:3001/api/import \
  -H "Content-Type: application/json" \
  --data @trainingscoach-backup-2026-XX-XX.json
```

## 24/7 laten draaien

```bash
npm install -g pm2
cd trainingscoach-server
pm2 start src/server.js --name trainingscoach
pm2 save
pm2 startup      # volg de instructies die dit toont
```

## Status en vervolgstappen

Werkend en getest:
- Rekenkern (13 tests, o.a. TSS=100 bij 1 uur op FTP, Karvonen-zones, hoogtemeters met ruisfilter)
- Databaseschema (inserts, foreign keys, cascade-delete)

Nog te doen:
1. Eerste echte `npm install` + `npm run build` — de omzetting is statisch
   gevalideerd maar nog niet gedraaid
2. Strava-webhook afmaken (`server/src/routes/stravaWebhook.js` bevat de structuur
   en TODO's; vereist een geregistreerde Strava API-app)
3. Eventueel authenticatie als je dit van buiten je netwerk bereikbaar maakt

## Belangrijk bij aanpassingen

`calculations.js` bestaat twee keer — in `server/src/lib/` en in
`frontend/src/lib/`. Die moeten functioneel identiek blijven. De serverversie is
leidend voor wat de AI-coach te zien krijgt.
