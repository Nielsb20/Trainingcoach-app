# Trainingscoach — frontend

De React-interface van Trainingscoach, omgezet van het Claude-artifact-prototype
naar een gewoon Vite-project dat tegen je eigen backend praat in plaats van tegen
Claude's artifact-opslag.

## Structuur

```
src/
├── api/client.js          ← alle communicatie met de backend (vervangt window.storage)
├── lib/
│   ├── calculations.js    ← rekenkern: TSS/CTL/ATL, hartslag-/vermogenszones, NP, snelheid
│   ├── constants.js       ← navigatie, cardiotypes, weekdagen, event-types
│   ├── gpxParser.js       ← GPX-parsing + .gpx.gz uitpakken (browser-only)
│   └── csvImport.js       ← kolom-mapping voor Strava/Garmin CSV-exports
├── components/
│   ├── SchemaTab.jsx      ← trainingsschema, cardiomomenten, profiel (max HR/FTP), back-up
│   ├── KrachtTab.jsx      ← krachttraining loggen
│   ├── CardioTab.jsx      ← CSV-bulkimport, GPX-import, handmatige invoer
│   ├── WeightTab.jsx      ← gewicht + vetpercentage
│   ├── EventsTab.jsx      ← geplande wedstrijden/doelen
│   ├── GeschiedenisTab.jsx← grafieken, tabellen, belasting (CTL/ATL/TSB)
│   ├── CoachTab.jsx       ← AI-coach (roept de server aan, niet Anthropic direct)
│   └── shared/            ← herbruikbare kleine componenten
├── App.jsx                ← state + navigatie + foutafhandeling
└── styles.css             ← alle styling
```

## Belangrijk: `calculations.js` staat op twee plekken

`src/lib/calculations.js` is een **functioneel identieke kopie** van
`server/src/lib/calculations.js`. De frontend gebruikt zijn kopie om grafieken en
tabellen te tekenen zonder een extra serverronde; de server gebruikt zijn eigen
kopie om de payload voor de AI-coach te bouwen.

**Pas je iets aan in de een, pas het dan ook aan in de ander.** De serverversie is
leidend voor alles wat de coach te zien krijgt.

## Ontwikkelen (op je eigen computer)

```bash
npm install
npm run dev
```

Draait op `http://localhost:5173`. De Vite-config proxyt `/api` automatisch door
naar `http://localhost:3001`, dus start de backend in een tweede terminal:

```bash
cd ../trainingscoach-server
npm start
```

## Bouwen voor productie (op de Pi)

```bash
npm run build
```

Dit bouwt rechtstreeks naar `../trainingscoach-server/public/`. De server serveert
die map automatisch, dus daarna draait alles — UI én API — op één poort:

```
http://<ip-van-je-pi>:3001
```

Geen aparte webserver nodig, geen CORS-configuratie.

## Wanneer heb je `VITE_API_URL` nodig?

Alleen als je de frontend op een **andere** oorsprong serveert dan de API
(bijvoorbeeld frontend op een aparte webserver). In de standaardopstelling
(bouwen naar `server/public/`) laat je die leeg — alles gaat naar `/api` op
dezelfde oorsprong.

```bash
cp .env.example .env
# en vul in indien nodig:
# VITE_API_URL=http://192.168.1.50:3001/api
```

## Bekende aandachtspunten

- **Nog niet gedraaid.** Deze omzetting is statisch gevalideerd (syntax +
  import-controle), maar er is nog geen `npm install`/`npm run build` overheen
  gegaan. Reken op een paar kleine dingen bij de eerste start.
- **FIT-bestanden** worden niet ondersteund, alleen GPX (en `.gpx.gz`).
- **Geen authenticatie.** Prima binnen je eigen netwerk; wil je dit van buitenaf
  bereikbaar maken, voeg dan eerst een vorm van afscherming toe.
