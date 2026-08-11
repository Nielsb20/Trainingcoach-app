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
- **AI-coach** die bovenop die harde cijfers analyse, tips en een cardiovoorstel geeft —
  werkt met Google Gemini (gratis tier) of Anthropic, omschakelbaar via `.env`
- **Schemavoorstel van de coach**: je legt in Schema je doelen en randvoorwaarden vast
  (doel, beschikbare dagen, tijd per sessie, materiaal, blessures), en de coach ontwerpt
  daar een weekindeling bij — welke trainingsdagen, welke oefeningen, welke sets en reps.
  Zie "Je schema laten ontwerpen" hieronder

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
nano .env                 # vul één API-sleutel in (GEMINI_API_KEY of ANTHROPIC_API_KEY)
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

## Je schema laten ontwerpen

Tot nu toe stelde je het schema zelf samen en deed de coach voorstellen *binnen* dat schema.
Bovenaan het tabblad **Schema** kun je nu ook het schema zelf laten ontwerpen.

Je vult daar in wat je wilt bereiken en waar je aan vastzit: je doel, of de nadruk op kracht
of cardio ligt, hoeveel dagen per week je hebt, hoe lang een sessie mag duren, op welke
weekdagen je kunt, welk materiaal je hebt en welke blessures of oefeningen je wilt vermijden.
Die randvoorwaarden zijn geen suggesties voor het model: het schema moet erbinnen passen.

Je beschikbare weekdagen worden daarbij in code afgedwongen, niet alleen in de prompt
gevraagd. Plant de coach toch iets op een dag die je niet hebt aangevinkt, dan wordt die
dag eruit gehaald en zie je bovenaan het voorstel staan wat er is aangepast en waarom.

**Vaste afspraken zet je vast met het slotje.** Een trainingsdag of cardiomoment dat je
thuis of met een clubgenoot hebt afgesproken, klik je vast in het schema. De coach mag dan
nog steeds bepalen wát je die dag doet — dat is juist zijn werk — maar hij verplaatst het
niet, laat het niet vervallen, en schuift het niet naar een ander tijdstip. Doet een
voorstel dat toch, dan wordt het teruggezet en staat erbij dat het is teruggezet. Dat
onderscheid is er niet voor niets: "wanneer kan ik" is iets anders dan "dit is afgesproken
met iemand anders", en alleen het tweede is onbespreekbaar.

De coach krijgt daarnaast je huidige schema, je trainingsgeschiedenis, de berekende
trainingsbelasting, je herstelgegevens en je geplande evenementen mee — plus hoeveel je de
afgelopen acht weken werkelijk hebt getraind. Dat laatste is er expres bij: een schema met
vijf krachtdagen is niets waard voor iemand die er structureel twee haalt.

Wat je terugkrijgt is een **voorstel**, geen wijziging:

- je ziet eerst wat het zou veranderen — welke dagen erbij komen, welke wijzigen, en vooral
  welke oefeningen uit je schema zouden verdwijnen;
- neem je het over, dan wordt je vorige schema bewaard en zet je het met één knop terug;
- wijs je het af met een reden, dan gaat die reden mee in de volgende aanvraag, zodat je niet
  volgende week hetzelfde plan terugkrijgt.

Je gelogde trainingen blijven bij dit alles onaangeroerd: het schema is de referentie waartegen
je logt, niet de logs zelf. Een oefening die uit het schema verdwijnt, blijft dus gewoon in je
geschiedenis staan.

De automatische coachruns (Schema → Coach) raken je schema niet aan. Die maken alleen
weekvoorstellen in de planning; een schema komt er alleen als je er zelf om vraagt.

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

## Back-ups

De server schrijft elke nacht een volledige kopie naar
`trainingscoach-server/data/backups/` en bewaart standaard 30 dagen. Draaide de
Pi 's nachts niet, dan gebeurt het alsnog zodra hij weer aan gaat. In
**Schema → Back-up** zie je wanneer de laatste kopie is gemaakt.

Terugzetten kan met de knop "Herstel vanuit back-up" — de bestanden hebben
dezelfde vorm als de handmatige export.

Belangrijk: die kopieën staan op dezelfde SD-kaart als de database. Voor
bescherming tegen een kapotte kaart download je af en toe zelf een export en
bewaar je die ergens anders.

## Beveiliging

Er zit geen wachtwoord op deze server: alles wat hem kan bereiken, kan je
gegevens lezen en verwijderen. Houd hem daarom binnen je eigen netwerk.

Sinds kort staat CORS uit, zodat een willekeurige website die je bezoekt niet
via je browser bij je Pi kan. Interface en API draaien op dezelfde herkomst, dus
je hebt het niet nodig. Draai je de interface bewust op een ander adres, zet dan
`CORS_ORIGIN` op dat exacte adres — nooit op `*`.

## Status en vervolgstappen

Draait in gebruik op een Raspberry Pi. `npm test` in de servermap voert 31
testbestanden uit, waaronder:

- de rekenkern (TSS=100 bij een uur op FTP, Karvonen-zones, hoogtemeters met ruisfilter)
- het databaseschema (inserts, foreign keys, cascade-delete)
- de planner (afvinken, verplaatsen, overslaan, stabiliteit van voorstellen)
- de schemavoorstellen (opschonen van wat het model teruggeeft, het verschil met je
  huidige schema, en of overnemen terug te draaien is)
- back-ups, kostenrem en de API-antwoorden zelf

De suite draait bewust onder meerdere tijdzones; datumfouten die alleen buiten
UTC zichtbaar zijn, hebben hier eerder echte bugs opgeleverd.

Nog te doen:
1. Strava-webhook afmaken (`server/src/routes/stravaWebhook.js` bevat de structuur
   en TODO's; vereist een geregistreerde Strava API-app)
2. Authenticatie. Nu is de server onbeschermd, dus alleen geschikt binnen je
   eigen netwerk — zie "Beveiliging" hierboven

## Belangrijk bij aanpassingen

`calculations.js` draait op twee plekken: de server bouwt er de coachpayload
mee, de browser tekent er grafieken en tabellen mee zonder tussenkomst van de
API. Er is één bron van waarheid:

- **Bewerk `trainingscoach-server/src/lib/calculations.js`.**
- `trainingscoach-frontend/src/lib/calculations.js` wordt daaruit *gegenereerd*
  en begint met "GENERATED FILE — DO NOT EDIT". Het enige verschil is de
  modulesyntax (CommonJS op de server, ES modules in Vite).
- Genereren gebeurt automatisch bij `npm run build` en `npm run dev`; handmatig
  kan met `npm run sync:calc` in de frontend-map.
- `npm test` op de server bevat een parity-test die faalt zodra de twee uit
  elkaar lopen, dus een vergeten regeneratie komt niet ongemerkt door.

Helpers die alleen de interface nodig heeft (`uid`, `defaultTimeOfDay`,
`timeOfDayLabel`) staan in `frontend/src/lib/uiHelpers.js`, buiten de
gegenereerde rekenkern.

Voorheen werden beide bestanden met de hand bijgehouden onder de regel "houd ze
identiek". Dat hield geen stand: de browserversie miste uiteindelijk de hele
histogram- en vermogenscurve-sectie.
