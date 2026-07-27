# Trainingscoach — self-hosted server (voorbereidend scaffold)

Dit is de backend-tegenhanger van de Trainingscoach-artifact: dezelfde rekenkern
(TSS/CTL/ATL, hartslag-/vermogenszones, snelheid, hoogtemeters, Normalized Power),
nu als een echte Node/Express-server met SQLite-database, klaar om op je NUC te
draaien. De AI-coach-aanroep gebeurt hier server-side, zodat je Anthropic API-sleutel
nooit in de browser terechtkomt.

## Wat hier al staat

- `src/lib/calculations.js` — de volledige, geteste rekenkern (zie `calculations.test.js`)
- `src/db/schema.sql` + `src/db/db.js` — SQLite-schema en verbinding
- `src/routes/*` — REST-endpoints voor schema/profiel, kracht- en cardiologs, gewicht,
  evenementen, coach, en import/export
- `src/routes/coach.js` — bouwt exact dezelfde payload als de artifact-versie en roept
  het taalmodel aan met je eigen sleutel (uit `.env`, nooit blootgesteld aan de client)
- `src/lib/llmProvider.js` — providerlaag: ondersteunt **Google Gemini** én **Anthropic**,
  omschakelbaar via één instelling in `.env`
- `src/routes/stravaWebhook.js` — **scaffold, nog niet werkend** — bevat de structuur en
  duidelijke TODO's voor wanneer je een Strava API-app hebt geregistreerd
- `src/routes/importExport.js` — importeert het exacte JSON-formaat van de
  "Exporteer alles (JSON)"-knop uit de artifact-versie, dus je kunt je huidige data
  1-op-1 overzetten

## De frontend

De React-UI staat in het aparte project `trainingscoach-frontend`. Die bouw je met
`npm run build`, wat rechtstreeks naar de `public/`-map hier schrijft — daarna
serveert deze server zowel de UI als de API op één poort. Zie de README daar.

## Wat hier nog NIET staat
- **De echte Strava-koppeling.** De webhook-route staat klaar qua vorm, maar mist de
  OAuth-token-opslag en de daadwerkelijke Strava API-aanroepen (zie TODO's in het bestand).
- **Authenticatie.** Dit is nu single-user zonder inlogscherm — prima voor persoonlijk
  gebruik binnen je eigen netwerk, maar als je dit ooit vanaf buiten je huis bereikbaar
  maakt, wil je op zijn minst een simpele API-sleutel-check toevoegen.

## Installeren op de NUC

```bash
# 1. Node.js 18+ nodig (check met: node --version)
# 2. Op de meeste Linux-distributies moet je bouwgereedschap hebben voor better-sqlite3
#    (het compileert een kleine native module bij installatie):
sudo apt update && sudo apt install -y build-essential python3

# 3. Dependencies installeren
npm install

# 4. .env aanmaken en invullen
cp .env.example .env
# open .env en vul één API-sleutel in (GEMINI_API_KEY of ANTHROPIC_API_KEY)

# 5. Testen dat de rekenkern klopt (geen dependencies nodig, draait los)
npm test

# 6. Server starten
npm start
# -> Trainingscoach-server draait op http://localhost:3001
```

> **Alternatief zonder compilatie:** als je Node 22+ hebt, heeft Node zelf al ingebouwde
> SQLite-ondersteuning (`node:sqlite`, momenteel experimenteel). Getest tegen exact dit
> schema (inserts, foreign keys, cascade-delete — alles werkt) zonder `build-essential`
> nodig te hebben. De API is vrijwel identiek aan better-sqlite3 (`.prepare().run()/.all()/.get()`),
> dus `src/db/db.js` is met een paar regels aan te passen als je dat liever hebt:
> ```js
> const { DatabaseSync } = require("node:sqlite");
> const db = new DatabaseSync(DB_PATH);
> ```

Check daarna `http://localhost:3001/api/health` — die moet `{"ok":true}` teruggeven.

## Welk AI-model gebruikt de coach?

Instelbaar via `.env`, zonder code aan te passen:

| | Google Gemini | Anthropic |
|---|---|---|
| Kosten | Gratis tier (1.500 verzoeken/dag), geen creditcard | Betalen per gebruik |
| Sleutel ophalen | https://aistudio.google.com | https://console.anthropic.com |
| Instellen | `GEMINI_API_KEY=...` | `ANTHROPIC_API_KEY=...` |

Laat `LLM_PROVIDER` leeg en de server kiest automatisch: staat er een
`GEMINI_API_KEY`, dan wordt Gemini gebruikt. Wil je expliciet vastzetten (bijv.
omdat beide sleutels ingevuld staan), zet dan `LLM_PROVIDER=anthropic` of
`LLM_PROVIDER=gemini`.

Bij Gemini wordt het JSON-antwoordformaat afgedwongen via `responseSchema`, wat
betrouwbaarder is dan het alleen in de prompt vragen. Bij Anthropic gebeurt dat
via de systeemprompt, met een terugvaloptie als er toch geen geldig JSON terugkomt.

Controleren wat er actief is:

```bash
curl http://localhost:3001/api/coach/provider
# -> {"configured":true,"provider":"gemini","model":"gemini-2.5-flash"}
```

## Je bestaande data overzetten

1. In de huidige artifact-versie: Schema-tab → "Exporteer alles (JSON)".
2. Met de server draaiend:
   ```bash
   curl -X POST http://localhost:3001/api/import \
     -H "Content-Type: application/json" \
     --data @trainingscoach-backup-2026-XX-XX.json
   ```
3. Check `http://localhost:3001/api/cardio-logs` om te zien of je sessies er staan.

## 24/7 laten draaien

Gebruik een process manager zodat de server na een crash of reboot vanzelf weer opstart:

```bash
npm install -g pm2
pm2 start src/server.js --name trainingscoach
pm2 save
pm2 startup   # volg de instructies die dit commando toont
```

## Bereikbaar maken voor de Strava-webhook

Zodra je zover bent: gebruik een **Cloudflare Tunnel** of **Tailscale Funnel** om de
server veilig vanaf internet bereikbaar te maken, zonder poorten open te zetten op je
router. Dat is de aanbevolen route boven directe port-forwarding.

## Volgende stappen (in volgorde van logische prioriteit)

1. Frontend omzetten naar een Vite-project dat tegen deze API praat
2. Strava API-app registreren (developer portal) en de webhook-TODO's invullen
3. Cloudflare Tunnel opzetten zodra de webhook nodig is
4. (optioneel) simpele API-sleutel-auth toevoegen als je dit van buitenaf bereikbaar maakt
