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
- `src/routes/analysis.js` — zoneverdeling per week en de vermogenscurve
- `src/routes/planned.js` — gepland vs. daadwerkelijk gedaan
- `src/lib/llmProvider.js` — providerlaag: ondersteunt **Google Gemini** én **Anthropic**,
  omschakelbaar via één instelling in `.env`
- `src/routes/strava.js` + `src/lib/strava.js` — volledige Strava-integratie: OAuth,
  automatische tokenvernieuwing, webhook-ontvangst en handmatige synchronisatie
- `scripts/strava-subscription.js` — hulpscript om het webhook-abonnement te beheren
- `src/routes/importExport.js` — importeert het exacte JSON-formaat van de
  "Exporteer alles (JSON)"-knop uit de artifact-versie, dus je kunt je huidige data
  1-op-1 overzetten

## De frontend

De React-UI staat in het aparte project `trainingscoach-frontend`. Die bouw je met
`npm run build`, wat rechtstreeks naar de `public/`-map hier schrijft — daarna
serveert deze server zowel de UI als de API op één poort. Zie de README daar.

## Wat hier nog NIET staat
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

## Volgende stappen

1. Strava-webhook publiek bereikbaar maken (zie hieronder) als je automatische import wilt
2. Authenticatie toevoegen — nodig zodra je de app buiten je eigen netwerk gebruikt of deelt

## Strava koppelen

De koppeling bestaat uit twee losse delen, met verschillende eisen:

| | Wat het doet | Publiek bereikbaar nodig? |
|---|---|---|
| **OAuth** | Jouw server mag data ophalen | Nee — de omleiding loopt via jouw browser |
| **Webhook** | Strava seint jouw server in bij een nieuwe rit | Ja — Strava's servers bellen jouw server |

Je kunt dus prima met deel 1 beginnen en deel 2 later doen. Zonder webhook werkt
alles ook, alleen druk je zelf op "Nu synchroniseren" in plaats van dat het
vanzelf binnenkomt.

### Deel 1 — OAuth (werkt binnen je LAN)

1. Registreer een API-app op https://www.strava.com/settings/api
   - **Authorization Callback Domain**: het IP of de hostnaam van je Pi, bijv. `192.168.1.121`
     (alleen het domein/IP, zonder `http://` en zonder pad)
2. Zet de gegevens in `.env`:
   ```
   STRAVA_CLIENT_ID=12345
   STRAVA_CLIENT_SECRET=...
   STRAVA_WEBHOOK_VERIFY_TOKEN=verzin-hier-iets-willekeurigs
   ```
3. Herstart de server (`pm2 restart trainingscoach`)
4. Ga in de app naar **Schema → Strava** en klik op "Verbinden met Strava"
5. Na het goedkeuren kun je op "Nu synchroniseren" klikken om je laatste activiteiten op te halen

Krachttrainingen worden overgeslagen (dat is geen cardio), en activiteiten die al
geïmporteerd zijn worden niet nog eens toegevoegd.

**Al eerder geïmporteerde ritten worden herkend.** Als je eerder de Strava
CSV-export of GPX-bestanden hebt ingeladen, staan dezelfde ritten daar al onder
een ander intern ID. De synchronisatie herkent die (zelfde dag, zelfde sport,
afstand en duur binnen 5%) en vervangt de bestaande versie in plaats van er een
tweede naast te zetten — de Strava-versie is rijker, want die bevat het verloop
binnen de sessie.

Zijn er tóch dubbelen ontstaan, dan ruimt dit ze op:

```bash
npm run dedupe            # proefdraai: laat alleen zien wat het zou doen
npm run dedupe -- --apply # daadwerkelijk opruimen
```

Bij elk paar wordt de rijkste versie behouden (die met verloopdata wint).

### Deel 2 — Webhook (vereist publieke bereikbaarheid)

Nodig is een publiek adres dat naar deze server verwijst. Een Cloudflare Tunnel is
hiervoor de aanbevolen route: geen poorten open op je router, en je kunt het beperken
tot alleen het webhook-pad.

```bash
# op de Pi
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
cloudflared tunnel login
cloudflared tunnel create trainingscoach
# koppel een hostname aan de tunnel en laat 'm wijzen naar http://localhost:3001
```

Registreer daarna het abonnement bij Strava:

```bash
cd ~/Trainingcoach-app/trainingscoach-server
node scripts/strava-subscription.js create https://jouw-tunnel-adres
node scripts/strava-subscription.js status     # controleren
node scripts/strava-subscription.js delete     # weer opzeggen
```

Strava roept bij het aanmaken direct je callback-URL aan ter verificatie, dus de
server én de tunnel moeten op dat moment draaien.

**Beveiliging:** de app zelf heeft geen authenticatie. Zet daarom in Cloudflare
alleen het pad `/api/strava/webhook` open en houd de rest privé — dat ene endpoint
accepteert niets anders dan een activiteits-ID en geeft nooit data terug.


## Analyse: zoneverdeling en vermogenscurve

Bij het importeren vanuit Strava wordt per sessie afgeleide analysedata berekend
en opgeslagen:

- **Histogrammen** — seconden per hartslagwaarde en per wattage
- **Vermogenscurve** — beste gemiddelde vermogen over 1s t/m 60min

Bewust histogrammen in plaats van ruwe secondedata: een paar honderd getallen per
sessie in plaats van tienduizenden, én je kunt er elke zoneverdeling uit afleiden.
Pas je later je FTP of max. hartslag aan, dan wordt je hele geschiedenis meteen
opnieuw ingedeeld in plaats van vast te zitten aan de zones van toen.

Te zien onder **Analyse** in de app:

| Tabblad | Wat het laat zien |
|---|---|
| Zoneverdeling | Tijd per zone per week — het beeld dat je nodig hebt voor gepolariseerd trainen |
| Vermogenscurve | Beste vermogen per tijdsduur, aller-tijden versus recent, plus een FTP-schatting |
| Gepland vs. gedaan | De cardiovoorstellen van de coach, automatisch afgevinkt op basis van je logs |

**Let op:** deze analyse werkt alleen voor sessies die na deze update zijn
geïmporteerd, want oudere sessies hebben de histogrammen nog niet. Synchroniseer
opnieuw met Strava om je geschiedenis bij te werken — bestaande sessies worden
vervangen, niet gedupliceerd.

De FTP-schatting gebruikt een gemeten uurinspanning als die er is, anders 95% van
je beste 20 minuten. Wijkt dat meer dan 15 W af van wat je hebt ingevuld, dan
krijg je een melding — die waarde voedt namelijk ook je vermogenszones en de
TSS-berekening.


## Herstelgegevens (Garmin)

Rusthartslag, HRV en slaap zijn de ontbrekende schakel in de coaching: zonder
herstelcontext kan de coach alleen naar belasting kijken, niet naar of je die
belasting aankunt. Onder **Herstel** in de app voer je die gegevens in, en de
coach vergelijkt ze met je eigen basislijn over de voorgaande drie weken.

### Handmatig (altijd betrouwbaar)

Vul in wat je hebt. Alleen ingevulde velden worden opgeslagen, dus je kunt een
dag later aanvullen zonder eerdere waarden te overschrijven.

### Automatisch ophalen uit Garmin (fragiel, optioneel)

**Lees dit eerst.** Garmin heeft geen API voor particulieren: het
partnerprogramma vereist een rechtspersoon en wijst persoonlijk gebruik af. De
enige route is een onofficiële bibliotheek, en die is aantoonbaar broos —
in maart 2026 wijzigde Garmin zijn authenticatie, waarna `garth` (waar vrijwel
het hele ecosysteem op leunde, inclusief alle JavaScript-varianten) werd
stopgezet. Alleen de Python-variant is hersteld.

Dat betekent: **dit kan zonder aankondiging stoppen met werken.** Het staat
daarom bewust apart van de rest van de applicatie. Valt het om, dan blijft alles
werken en voer je je gegevens handmatig in.

Installeren op de Pi:

```bash
sudo apt install -y python3-pip python3-venv
cd ~/Trainingcoach-app/trainingscoach-server/scripts
python3 -m venv garmin-venv
./garmin-venv/bin/pip install garminconnect
```

Gebruiken:

```bash
cd ~/Trainingcoach-app/trainingscoach-server
npm run garmin -- --days 7          # laatste 7 dagen ophalen
npm run garmin -- --days 30 --dry-run  # eerst kijken wat er komt
```

De eerste keer vraagt hij om je inloggegevens (en MFA-code indien ingesteld).
Daarna worden alleen tokens bewaard in `~/.garminconnect`, niet je wachtwoord.

Automatisch elke ochtend, via `crontab -e`:

```
0 7 * * * cd ~/Trainingcoach-app/trainingscoach-server && npm run garmin -- --days 3 >> ~/garmin-fetch.log 2>&1
```

Wat het ophaalt: rusthartslag, HRV, slaapduur en -score, Body Battery, stress,
en gewicht + vetpercentage van een Index-weegschaal.

**Als het stopt met werken:** probeer eerst
`./scripts/garmin-venv/bin/pip install --upgrade garminconnect`. Helpt dat niet,
dan heeft Garmin waarschijnlijk opnieuw iets gewijzigd en moet je wachten tot de
bibliotheek is bijgewerkt. Handmatige invoer blijft ondertussen gewoon werken.
