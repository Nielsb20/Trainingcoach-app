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
| (planning verhuisd naar het eigen tabblad **Planning**) | |

**Bestaande sessies bijwerken.** Sessies die je vóór deze functie hebt
geïmporteerd missen de histogrammen, waardoor de analyse leeg blijft. Gewoon
opnieuw synchroniseren helpt niet: die slaat ze over als "al geïmporteerd".

Daarom houdt de app per activiteit bij met welke analyseversie hij is verwerkt.
Staat er iets verouderds tussen, dan verschijnt bij **Schema → Strava** een knop
om het bij te werken. Dat gaat in blokken van 25 vanwege Strava's limiet van 100
verzoeken per kwartier, dus bij een lange historie klik je een paar keer — de
voortgang blijft bewaard.

Voegen we later iets nieuws toe dat uit de ruwe data komt, dan volstaat het om
`ANALYSIS_VERSION` in `src/lib/strava.js` op te hogen; de backfill komt dan
vanzelf weer in beeld.

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

**Eerst een keer handmatig inloggen.** De automatische taak werkt op de tokens
die bij die eerste login worden opgeslagen; zonder die tokens zou het script om
je wachtwoord moeten vragen, en een cron-taak heeft geen terminal. Draait het
script zonder tokens vanuit cron, dan stopt het met een uitleg in plaats van dat
het blijft hangen.

Automatisch elke ochtend, via `crontab -e`:

```
0 9 * * * cd ~/Trainingcoach-app/trainingscoach-server && npm run garmin -- --days 3 >> ~/garmin-fetch.log 2>&1
```

Negen uur is bewuster gekozen dan zeven: je horloge synchroniseert de nacht
meestal pas als je 's ochtends je telefoon oppakt, dus vroeger draaien levert
vaak nog niets op. `--days 3` haalt de laatste drie dagen op, zodat een gemiste
run zichzelf inhaalt.

Wat het ophaalt: rusthartslag, HRV, slaapduur en -score, Body Battery, stress,
en gewicht + vetpercentage van een Index-weegschaal.

### Bekende valkuilen

**Ontbrekende velden.** Garmin verplaatst velden tussen endpoints, en op
persoonlijke accounts geven `get_stats`, `get_user_summary` en `get_rhr_day`
een 403 terug. De gegevens zitten daarom elders:

| Waarde | Komt uit |
|---|---|
| Slaapduur | `get_sleep_data` |
| Rusthartslag | `get_sleep_data` (bovenin het antwoord, niet in `dailySleepDTO`) |
| Stress | `get_stress_data` |
| Body Battery | `get_body_battery` (uit `bodyBatteryValuesArray`) |
| HRV | `get_hrv_data`, alleen als je horloge dit meet |

Klopt er iets niet, draai dan `scripts/garmin-fields.py`. Dat toont per endpoint
welke velden Garmin nu daadwerkelijk teruggeeft, zodat de toewijzing te
corrigeren is zonder gokken.

**"Display name is not set"** — dit is geen instelling die je zelf kunt
aanzetten. Garmin heeft de instelbare weergavenaam vervangen door een vast
profiel-ID; nieuwere accounts hebben dat veld simpelweg niet meer. De
bibliotheek gaat nog uit van het oude model.

Het script haalt de naam daarom zelf op uit je profiel en vult hem in voordat
het gegevens ophaalt. Lukt dat niet, dan blijven alleen rusthartslag, Body
Battery en stress leeg — slaap, HRV en gewicht komen gewoon binnen.

**"De sessie kon niet bruikbaar worden opgeslagen"** — de automatische taak kan dan niet
inloggen (cron heeft geen terminal), dus die faalt elke ochtend. Het script toont welke manieren het geprobeerd heeft. Sinds garth in maart 2026
is stopgezet schrijft de ingebouwde opslag lege bestanden weg; het script valt
daarom terug op het zelf uitlezen en wegschrijven van de tokens. Controleer na
een run dat `~/.garminconnect` bestanden bevat die **niet** 0 bytes groot zijn —
lege bestanden zien er goed uit maar werken niet.

### Als het niet werkt

**"429 — IP rate limited by Garmin"**
Garmin heeft je IP-adres tijdelijk geblokkeerd. Dit is hun botbeveiliging en
staat los van deze code. Wacht een uur en probeer opnieuw — en probeer vooral
NIET herhaaldelijk in te loggen, want dat verlengt de blokkade alleen maar.

Zodra een login lukt worden de tokens opgeslagen in `~/.garminconnect`, waarna
volgende runs de login helemaal overslaan. Het risico op rate limiting zit dus
vooral bij die eerste keer.

**Andere loginfouten**
Probeer eerst `./scripts/garmin-venv/bin/pip install --upgrade garminconnect`.
Helpt dat niet, dan heeft Garmin waarschijnlijk opnieuw iets gewijzigd en moet
je wachten tot de bibliotheek is bijgewerkt.

In beide gevallen: handmatige invoer bij **Herstel** blijft gewoon werken. Dat
is precies waarom deze twee dingen los van elkaar staan.


## Planning: voorstellen beoordelen in plaats van blind overnemen

Coachvoorstellen komen binnen als **voorstel**, niet als vaststaand plan. Dat
lost twee problemen op die er eerst in zaten:

1. **Stapelen.** Twee keer om advies vragen zette voorheen twee overlappende
   weken naast elkaar. Nu vervangt nieuw advies eerdere voorstellen die je niet
   hebt geaccepteerd; wat je al accepteerde blijft staan.
2. **De coach werkte blind.** De payload bevatte je planning niet, dus hij stelde
   elke keer een verse week voor alsof er niets lag. Nu krijgt hij
   `huidigePlanning` mee, met de instructie erop voort te bouwen in plaats van
   eroverheen — en om niet twee zware dagen achter elkaar te zetten.

### De middenweg: interactief, maar stabiel

Een plan werkt alleen als het blijft staan. Drie mechanismen zorgen dat de coach
kan bijsturen zonder je week telkens te herschrijven:

| Mechanisme | Wat het doet |
|---|---|
| **Vastzetten** (slotje) | Een sessie die vaststaat — clubrit, vaste afspraak. De coach stelt op die dag niets voor en kan hem niet vervangen. |
| **Wijziging vs. nieuw** | Staat er al iets op een dag, dan komt een voorstel binnen als *wijziging*, met oude en nieuwe invulling naast elkaar. Je ziet dus wat je zou opgeven. |
| **Afwijzingen onthouden** | Wijs je iets af, dan krijgt de coach dat mee — inclusief eventuele reden — zodat hij niet volgende week hetzelfde voorstelt. |

Daarbovenop krijgt de coach de instructie dat stabiliteit vóór optimalisatie
gaat: lege dagen aanvullen, gevulde dagen met rust laten, en als hij tóch iets
wil wijzigen daar expliciet een reden bij noemen.

**Je planning verandert nooit vanzelf.** Doe je niets met een voorstel, dan
blijft alles zoals het was. Je kunt ook zelf trainingen inplannen zonder de coach.

Uitgevoerde trainingen worden automatisch afgevinkt tegen je logs — je hoeft
niets bij te houden. Gaat een training niet door, dan kun je hem zelf op
**Overslaan** zetten, ook als de dag nog loopt: 's ochtends al besluiten dat het
niet doorgaat is normaal, en wachten tot middernacht helpt niemand.

**Verplaatsen** kan met het kalender-icoon: kies een andere dag en de sessie
verhuist mee, inclusief omschrijving en de koppeling met het coachantwoord
waaruit hij komt. Verplaats je naar een dag waarop je al getraind hebt, dan
wordt hij meteen afgevinkt.

**Automatisch afvinken is soepel in het matchen.** De coach schrijft
"Fietsen (Herstel)" terwijl Strava een kale "Fietsen" logt — dat telt gewoon als
dezelfde sessie. En heb je gefietst terwijl er hardlopen gepland stond, dan is
dat een gewisselde training, geen gemiste: het telt als gedaan.

Een handmatige keuze wint altijd van de automaat. Train je toch nog nadat je iets
op overgeslagen hebt gezet, dan blijft je keuze staan — met **Ongedaan maken**
zet je hem terug op gepland, waarna hij alsnog automatisch wordt afgevinkt.


## Krachttraining en de coach

De coach ziet je krachttrainingen wel degelijk, maar het is goed te weten wat
daar precies mee gebeurt:

**Wat de coach krijgt:**
- Je laatste 8 sessies met alle oefeningen, gewichten en herhalingen
- Progressie per oefening sinds je eerste log
- `krachtcontext`: hoe lang geleden je voor het laatst trainde, welke oefeningen
  dat waren, en hoeveel sessies je deed in de afgelopen 7 en 28 dagen

**Wat de coach daarmee doet:** hij plant geen zware intervalsessie of lange
duurrit op de dag na een beentraining. Bovenlichaamwerk is veel minder
beperkend, dus daar wordt anders mee omgegaan.

**Belangrijk: CTL, ATL en TSB zijn uitsluitend op cardio gebaseerd.**
Krachttraining zit er niet in, simpelweg omdat er geen vermogensmeter voor
bestaat en er geen algemeen aanvaarde omrekening is naar TSS. Krachtbelasting
optellen bij cardio-TSS zou een schijnnauwkeurigheid geven in een getal dat de
coach als hard aanneemt. Daarom staat het bewust apart: een gunstige TSB
betekent niet automatisch dat je fris bent, en de coach heeft de instructie om
altijd óók naar de krachtcontext te kijken.

**Optioneel: duur en RPE.** Vul je bij een krachttraining de duur en een
zwaarte-inschatting (RPE 1–10) in, dan berekent de app sRPE (duur x RPE) — de
gangbare maat voor krachtbelasting zonder vermogensmeter. De coach gebruikt dat
als extra signaal voor je totale weekbelasting. Vul je het niet in, dan blijft
het leeg in plaats van dat er een getal wordt geschat.

In het tabblad **Planning** zie je je gelogde krachttrainingen tussen de
cardiovoorstellen staan, zodat je week compleet is.


## Planning: kracht én cardio, verder vooruit

De coach plant nu beide disciplines. Naast `cardioVoorstel` levert hij ook
`krachtVoorstel`, gebaseerd op het schema dat je bij **Schema** hebt opgegeven.

**Jij bepaalt wanneer, de coach bepaalt wat.** Per trainingsdag in je schema vink je aan op
welke weekdag(en) je die doet — dezelfde training twee keer per week kan gewoon.
De coach plant die dag dan exact daar, en verzint er geen eigen rotatie omheen,
ook niet als een andere volgorde hem theoretisch beter lijkt. Alleen bij een
duidelijk signaal (zoals oververmoeidheid) mag hij afwijken, en dan moet hij de
reden expliciet benoemen.

Vink je geen weekdagen aan, dan mag de coach zelf een verstandige verdeling
voorstellen op basis van je recente logs.

De cardio wordt afgestemd op je vaste krachtdagen in plaats van andersom: staat
er dinsdag een zware beentraining, dan plant hij geen zware rit op woensdag.

**Kracht en cardio op dezelfde dag botsen niet.** Conflictdetectie werkt per
discipline, want een gymsessie plus een rit is een normale dubbele dag.

**Afvinken kijkt naar de juiste bron:** cardioplannen worden gematcht tegen je
cardiologs, krachtplannen tegen je krachtlogs. Doe je Dag A terwijl Dag B
gepland stond, dan telt dat gewoon als gedaan — een gewisselde schemadag is geen
gemiste training.

**Bladeren.** Het Planning-tabblad toont twee weken tegelijk, met knoppen om
vooruit en terug te gaan. Handig, want de coach plant regelmatig drie weken
vooruit en dat paste niet in een vast venster.


## Je week vullen zonder de coach

Heb je vaste dagen in je schema staan, dan hoeft daar geen AI aan te pas te
komen. In het tabblad **Planning** staat de knop **"Vul aan vanuit mijn schema"**,
die de zichtbare periode vult met je vaste krachtdagen en cardiomomenten.

Twee eigenschappen die dit veilig maken:

- **Het vult alleen lege plekken.** Bestaande sessies — geaccepteerde
  coachvoorstellen, zelf ingeplande trainingen, vastgezette afspraken — worden
  nooit overschreven.
- **Twee keer klikken is onschadelijk.** De tweede keer voegt niets toe.

De coach bouwt daar vervolgens op voort in plaats van naast: hij vult aan wat
ontbreekt en stelt alleen wijzigingen voor als daar een reden voor is.

## Tijdstip van trainen

Per trainingsdag (kracht) en per cardiomoment kun je een tijdstip opgeven:
ochtend, middag of avond. Dat is geen cosmetisch detail — de coach rekent
daarmee de werkelijke hersteltijd uit in plaats van in hele dagen te denken.

Een avondtraining gevolgd door een ochtendsessie geeft ongeveer twaalf uur
herstel; dezelfde twee sessies andersom ruim zesendertig. De coach plant dus geen
zware ochtendrit na een zware avondtraining, ook al staan ze op verschillende
dagen. Vul je geen tijdstip in, dan rekent hij met hele dagen.


## Wat de coach met je krachttraining doet

De vaste dagen liggen vast, maar dat betekent niet dat de coach er verder niets
mee doet — de invulling is juist zijn werk:

- **Concrete gewichten.** Hij krijgt per oefening je laatst gelogde sets mee, dus
  hij kan zeggen "squat 3x5 op 102,5 kg, 2,5 kg meer dan vorige week" in plaats
  van iets vaags. Haalde je je herhalingen niet, dan ziet hij dat ook.
- **Stagnatie signaleren.** Blijft een oefening meerdere sessies hangen, dan
  benoemt hij dat en stelt hij iets voor: herhalingen aanpassen, een week
  terugschakelen, of aandacht voor techniek.
- **Afstemmen op de week.** Staat er een lange rit kort na een krachtdag, dan
  stelt hij een lichtere variant voor — minder volume, verder van falen af — in
  plaats van de sessie te schrappen.
- **Deload adviseren.** Wijzen je herstelgegevens of trainingsbelasting op
  oververmoeidheid, dan mag hij een lichtere week of het overslaan van een sessie
  adviseren. Maar alleen bij een duidelijk signaal, en altijd met de reden erbij,
  zodat je zelf kunt beoordelen of je het ermee eens bent.

Zo'n voorstel komt binnen als **wijziging** op de sessie die er al staat, met de
oude en nieuwe invulling naast elkaar. Je planning verandert pas als je
accepteert.


## Automatische planning

De coach kan uit zichzelf naar je gegevens kijken, in plaats van dat je er elke
keer om moet vragen. Aan te zetten bij **Schema → Coach**; standaard staat alles
uit.

**Wat er automatisch kan draaien:**

| | Wanneer | Waarvoor |
|---|---|---|
| **Wekelijkse planning** | Vaste dag en tijd, bijv. zondagavond | Je komende week inplannen — voorspelbaar ritme |
| **Bij een signaal** | Alleen als er iets afwijkt | Tussentijds bijsturen wanneer dat nodig is |

**De signalen** (allemaal gemeten tegen je eigen basislijn, niet tegen absolute
waarden):

- TSB onder -25 — flink opgebouwde vermoeidheid
- TSB tien dagen boven +20 — ruimte om op te bouwen
- Rusthartslag twee dagen op rij minstens 5 slagen boven je basislijn
- HRV twee dagen op rij onder 90% van je basislijn
- Twee of meer gemiste sessies in een week
- Een evenement binnen veertien dagen

Een wachttijd (standaard 3 dagen) voorkomt dat hetzelfde signaal dagelijks
terugkomt. Verschijnt er een *ander* signaal, dan mag dat wel meteen — er is dan
iets nieuws te melden.

**Waar het landt:**

- **Voorstellen** komen in het tabblad **Planning**, met een teller in het
  zijmenu zodat je ziet dat er iets klaarstaat
- **De onderbouwing** staat in het tabblad **Coach**, gemarkeerd als automatisch,
  met de aanleiding erbij ("TSB is -29")

**Wat er niet gebeurt:** niets wordt automatisch geaccepteerd. Vastgezette
sessies blijven ongemoeid, geaccepteerde plannen worden niet overschreven, en
eerdere afwijzingen blijven meetellen. Precies dezelfde regels als wanneer je
zelf een vraag stelt.

Bij **Schema → Coach** zie je ook welke signalen er op dít moment zijn, zodat je
kunt beoordelen of de drempels bij je passen voordat je iets aanzet. En met "Nu
weekplanning maken" test je de opzet zonder tot zondag te wachten.


## Evenementen in de planning

Geplande evenementen staan nu ook in het Planning-tabblad, op hun eigen dag, met
het vlag-icoon. Daarnaast verschijnt bovenaan altijd een aftelling naar het
eerstvolgende evenement — ook als dat buiten de zichtbare twee weken valt, want
juist dan vergeet je makkelijk dat het eraan komt. Binnen veertien dagen kleurt
die melding om, als signaal dat het tijd is om af te bouwen.

De coach kiest zijn planningshorizon nu op basis van je evenementen: staat er een
evenement binnen drie weken, dan plant hij door tot en met die dag, zodat je de
hele opbouw en afbouw in één keer ziet.
