"use strict";

/**
 * Strava integration routes.
 *
 * Two things happen here, with different reachability requirements:
 *
 *  - OAuth (/authorize, /callback): the redirect is followed by YOUR browser,
 *    not by Strava's servers, so this works fine on a LAN address. No public
 *    exposure needed.
 *
 *  - Webhook (/webhook): Strava's servers call this directly, so this one path
 *    does need to be reachable from the internet (e.g. via a Cloudflare Tunnel).
 *    It accepts nothing but an activity ID and never returns data, so exposing
 *    just this route is low-risk compared to opening the whole app.
 */

const express = require("express");
const { db } = require("../db/db");
const strava = require("../lib/strava");
const calc = require("../lib/calculations");

const router = express.Router();

const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "changeme";

/* --------------------------------- OAuth -------------------------------- */

// GET /api/strava/status
router.get("/status", (req, res) => {
  res.json(strava.connectionStatus());
});

// GET /api/strava/authorize -> redirects the browser to Strava's consent screen
router.get("/authorize", (req, res) => {
  try {
    // Build the callback from the request itself, so it works on whatever
    // address you happen to be using (LAN IP, hostname, tunnel).
    const redirectUri = `${req.protocol}://${req.get("host")}/api/strava/callback`;
    res.redirect(strava.buildAuthorizeUrl(redirectUri));
  } catch (err) {
    res.status(400).send(`Strava-configuratie onvolledig: ${err.message}`);
  }
});

// GET /api/strava/callback?code=... -> Strava sends the browser back here
router.get("/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Strava-autorisatie geweigerd: ${error}`);
  if (!code) return res.status(400).send("Geen autorisatiecode ontvangen van Strava.");

  try {
    const data = await strava.exchangeCodeForTokens(code);
    const name = `${data.athlete?.firstname || ""} ${data.athlete?.lastname || ""}`.trim();
    // Plain HTML rather than JSON: a human lands here via a browser redirect.
    res.send(`<!doctype html><html lang="nl"><head><meta charset="utf-8">
      <title>Strava gekoppeld</title>
      <style>body{font-family:system-ui,sans-serif;background:#14181C;color:#E8E6E1;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        div{text-align:center}a{color:#4FA8A0}</style></head>
      <body><div><h1>Strava gekoppeld</h1>
      <p>Verbonden als ${name || "onbekende atleet"}.</p>
      <p><a href="/">Terug naar Trainingscoach</a></p></div></body></html>`);
  } catch (err) {
    res.status(500).send(`Koppelen mislukt: ${err.message}`);
  }
});

// POST /api/strava/disconnect
router.post("/disconnect", (req, res) => {
  strava.disconnect();
  res.json({ ok: true });
});

/* ------------------------------ import core ----------------------------- */

const CARDIO_COLUMNS = [
  "id", "date", "time_of_day", "type", "sub_type", "surface", "duration_min", "total_duration_min", "distance_km",
  "avg_hr", "max_hr", "avg_power", "max_power", "weighted_avg_power", "avg_cadence", "max_cadence",
  "elevation_gain_m", "elevation_loss_m", "pace", "calories", "notes", "profile_json", "source",
  "hr_histogram_json", "power_histogram_json", "power_curve_json", "gear_id", "gear_name",
];

function insertSession(session, source) {
  const row = {
    id: session.id,
    date: session.date,
    time_of_day: session.timeOfDay || null,
    type: session.type,
    sub_type: session.sub_type ?? null,
    surface: session.surface ?? null,
    gear_id: session.gear_id ?? null,
    gear_name: session.gear_name ?? null,
    duration_min: session.duration_min ?? null,
    total_duration_min: session.total_duration_min ?? null,
    distance_km: session.distance_km ?? null,
    avg_hr: session.avg_hr ?? null,
    max_hr: session.max_hr ?? null,
    avg_power: session.avg_power ?? null,
    max_power: session.max_power ?? null,
    weighted_avg_power: session.weighted_avg_power ?? null,
    avg_cadence: session.avg_cadence ?? null,
    max_cadence: session.max_cadence ?? null,
    elevation_gain_m: session.elevation_gain_m ?? null,
    elevation_loss_m: session.elevation_loss_m ?? null,
    pace: session.pace ?? null,
    calories: session.calories ?? null,
    notes: session.notes ?? null,
    profile_json: session.profile ? JSON.stringify(session.profile) : null,
    source,
    hr_histogram_json: session.hr_histogram ? JSON.stringify(session.hr_histogram) : null,
    power_histogram_json: session.power_histogram ? JSON.stringify(session.power_histogram) : null,
    power_curve_json: session.power_curve ? JSON.stringify(session.power_curve) : null,
  };
  db.prepare(
    `INSERT OR REPLACE INTO cardio_logs (${CARDIO_COLUMNS.join(", ")})
     VALUES (${CARDIO_COLUMNS.map(() => "?").join(", ")})`
  ).run(...CARDIO_COLUMNS.map((c) => row[c]));
}

/**
 * Fetches one activity (plus its streams) and stores it as a cardio session.
 * Skips strength training and anything already imported, unless forced.
 */
async function importActivity(activityId, { source = "strava", force = false } = {}) {
  if (!force && strava.wasImported(activityId)) {
    return { skipped: true, reason: "al eerder geïmporteerd" };
  }

  const activity = await strava.fetchActivity(activityId);

  if (strava.isStrengthActivity(activity.sport_type || activity.type)) {
    strava.markImported(activityId, null); // remember, so we don't re-check every time
    return { skipped: true, reason: "krachttraining, geen cardio" };
  }

  // Streams are a separate call and can fail (e.g. a manually entered activity
  // with no recorded data); the summary alone is still worth storing.
  let streams = null;
  try {
    streams = await strava.fetchStreams(activityId);
  } catch (err) {
    console.warn(`[strava] geen streams voor activiteit ${activityId}: ${err.message}`);
  }

  const session = strava.stravaToSession(activity, streams);

  // The same ride may already be present from the CSV archive import or a GPX
  // upload, under a different id. Replace that row rather than adding a second
  // one — the Strava version is richer (it carries the within-session profile).
  const existing = strava.findExistingSimilarSession(session);
  let replaced = null;
  if (existing) {
    db.prepare("DELETE FROM cardio_logs WHERE id = ?").run(existing.id);
    replaced = existing.id;
  }

  insertSession(session, source);
  strava.markImported(activityId, session.id);
  return { imported: true, session, replaced };
}

/* -------------------------------- webhook ------------------------------- */

// GET /api/strava/webhook - one-time subscription verification handshake
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[strava] webhook-verificatie geslaagd");
    return res.json({ "hub.challenge": challenge });
  }
  console.warn("[strava] webhook-verificatie geweigerd (verkeerde verify_token)");
  res.status(403).end();
});

// POST /api/strava/webhook - activity created/updated/deleted
router.post("/webhook", (req, res) => {
  // Strava expects a fast 200 and retries if it doesn't get one, so acknowledge
  // first and do the fetching afterwards.
  res.status(200).end();

  const event = req.body || {};
  if (event.object_type !== "activity") return;

  const activityId = event.object_id;

  if (event.aspect_type === "delete") {
    const logId = `strava-${activityId}`;
    db.prepare("DELETE FROM cardio_logs WHERE id = ?").run(logId);
    db.prepare("DELETE FROM strava_imported_activities WHERE strava_activity_id = ?").run(activityId);
    console.log(`[strava] activiteit ${activityId} verwijderd`);
    return;
  }

  // 'update' events fire for things like a renamed activity, so re-import and
  // overwrite rather than skipping on the dedup check.
  const force = event.aspect_type === "update";

  importActivity(activityId, { source: "strava_webhook", force })
    .then((result) => {
      if (result.imported) console.log(`[strava] activiteit ${activityId} geïmporteerd`);
      else console.log(`[strava] activiteit ${activityId} overgeslagen: ${result.reason}`);
    })
    .catch((err) => console.error(`[strava] import van ${activityId} mislukt: ${err.message}`));
});

/* ----------------------------- manual sync ------------------------------ */

// POST /api/strava/sync  { limit?: number }
// Pulls recent activities on demand — useful for backfilling and for testing
// the connection without waiting for a webhook to fire.
router.post("/sync", async (req, res) => {
  if (!strava.isConnected()) {
    return res.status(400).json({ error: "Strava is nog niet gekoppeld." });
  }
  const limit = Math.min(Number(req.body?.limit) || 10, 50);

  try {
    const activities = await strava.fetchRecentActivities(limit);
    const results = { imported: 0, skipped: 0, failed: 0, details: [] };

    for (const summary of activities) {
      try {
        const result = await importActivity(summary.id, { source: "strava_sync" });
        if (result.imported) {
          results.imported++;
          results.details.push({ id: summary.id, name: summary.name, status: "geïmporteerd" });
        } else {
          results.skipped++;
          results.details.push({ id: summary.id, name: summary.name, status: result.reason });
        }
      } catch (err) {
        results.failed++;
        results.details.push({ id: summary.id, name: summary.name, status: `mislukt: ${err.message}` });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/strava/import/:id - pull one specific activity
router.post("/import/:id", async (req, res) => {
  try {
    const result = await importActivity(Number(req.params.id), { source: "strava_manual", force: true });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/* -------------------------------- materiaal ----------------------------- */

/**
 * GET/PUT /api/strava/sporttype-betekenis
 *
 * Of het sporttype uit Strava over de fiets gaat of over de ondergrond. Dat
 * hangt af van hoe de sporter zijn Garmin-profielen gebruikt en is niet uit de
 * gegevens af te leiden, dus het is een keuze. Een eigen routepaar omdat het
 * Strava-specifiek is en in het Strava-blok thuishoort, los van het profiel
 * met hartslag en FTP.
 */
router.get("/sporttype-betekenis", (req, res) => {
  res.json({ betekenis: strava.sportTypeMeaning() });
});

router.put("/sporttype-betekenis", (req, res) => {
  const betekenis = req.body?.betekenis;
  if (!["fiets", "ondergrond"].includes(betekenis)) {
    return res.status(400).json({ error: 'Kies "fiets" of "ondergrond".' });
  }
  db.prepare("UPDATE profile SET strava_sport_type_means = ? WHERE id = 1").run(betekenis);
  // Geldt vanaf de volgende import; wat er al ligt verandert niet vanzelf.
  res.json({ betekenis, verouderd: strava.isConnected() ? strava.findOutdatedImports().length : 0 });
});

/**
 * GET /api/strava/materiaal
 *
 * Je fietsen, met het type dat eraan hangt en hoeveel ritten erop staan.
 *
 * Twee bronnen door elkaar: wat Strava kent (ook een fiets waar je dit seizoen
 * nog niet op zat) en wat er in de geïmporteerde ritten voorkomt (ook een
 * fiets die je in Strava hebt verwijderd). Beide horen in de lijst, anders kun
 * je nét de fiets niet koppelen die je zoekt.
 */
router.get("/materiaal", async (req, res) => {
  const telling = db
    .prepare(
      `SELECT gear_id, gear_name, COUNT(*) AS aantal, MAX(date) AS laatst
       FROM cardio_logs WHERE gear_id IS NOT NULL GROUP BY gear_id`
    )
    .all();
  // Waar dit materiaal onder hangt. Schoenen en fietsen zitten in dezelfde
  // lijst van Strava, en een paar ASICS een fietstype laten kiezen is onzin
  // die bovendien niets doet — de koppeling raakt alleen fietssessies.
  const sportPerGear = new Map(
    db
      .prepare("SELECT DISTINCT gear_id, type FROM cardio_logs WHERE gear_id IS NOT NULL")
      .all()
      .map((r) => [r.gear_id, calc.baseSportOf(r.type)])
  );
  const bekend = new Map(db.prepare("SELECT * FROM strava_gear").all().map((g) => [g.id, g]));

  // Strava erbij halen mag mislukken — dan tonen we wat we zelf al weten in
  // plaats van een leeg scherm met een foutmelding.
  let vanStrava = [];
  if (strava.isConnected()) {
    try {
      vanStrava = await strava.fetchAthleteGear();
      vanStrava.forEach((g) => strava.rememberGear(g.id, g.name));
    } catch (err) {
      console.warn(`[strava] materiaal niet opgehaald: ${err.message}`);
    }
  }

  const ids = new Set([...bekend.keys(), ...telling.map((t) => t.gear_id), ...vanStrava.map((g) => g.id)]);
  const lijst = [...ids].map((id) => {
    const gebruik = telling.find((t) => t.gear_id === id);
    const strava_ = vanStrava.find((g) => g.id === id);
    return {
      id,
      naam: strava_?.name || bekend.get(id)?.name || gebruik?.gear_name || id,
      fiets: bekend.get(id)?.sub_type || null,
      aantalRitten: gebruik?.aantal || 0,
      laatsteRit: gebruik?.laatst || null,
      afstandKm: strava_?.afstandKm ?? null,
      inStrava: !!strava_,
      // Afgeleid uit de sessies waar het onder hangt, niet uit Strava's
      // id-prefix: dat laatste is een conventie, dit is wat er echt mee gedaan
      // is. Onbekend materiaal (nog geen sessies) telt als fiets, want daar
      // gaat deze koppeling over.
      sport: sportPerGear.get(id) || "Fietsen",
    };
  });
  lijst.sort((a, b) => b.aantalRitten - a.aantalRitten || a.naam.localeCompare(b.naam));

  // Ritten zonder fiets kunnen niet via deze weg gelabeld worden; dat is iets
  // om te melden, niet om stilletjes weg te laten.
  const zonderMateriaal = db
    .prepare(
      `SELECT COUNT(*) AS aantal FROM cardio_logs
       WHERE gear_id IS NULL AND LOWER(type) LIKE 'fiets%'`
    )
    .get().aantal;

  // Waar die ritten vandaan kwamen bepaalt of er nog iets aan te doen is.
  // Een rit uit de Strava-API kan opnieuw opgehaald worden en krijgt dan
  // alsnog zijn fiets; een rit uit een CSV-archief of een GPX-bestand niet,
  // want in die bestanden staat geen materiaal. Dat verschil is het antwoord
  // op "waarom pakt hij zo vaak geen fiets", dus het hoort erbij.
  const zonderMateriaalPerBron = db
    .prepare(
      `SELECT source, COUNT(*) AS aantal FROM cardio_logs
       WHERE gear_id IS NULL AND LOWER(type) LIKE 'fiets%'
       GROUP BY source ORDER BY aantal DESC`
    )
    .all();

  // Waarom de lijst leeg kan zijn, zodat de interface dat kan uitleggen in
  // plaats van een leeg vak te tonen.
  //
  // Twee oorzaken, allebei normaal vlak na een update. Ritten die vóór deze
  // versie zijn geïmporteerd dragen geen fiets: die moeten eerst bijgewerkt
  // worden. En Strava geeft de lijst met fietsen alleen vrij met het scope
  // profile:read_all, dat deze app niet vraagt — we hebben het niet nodig,
  // want de fiets komt met elke rit mee, maar het betekent wel dat de lijst
  // zich vult via je ritten en niet in één klap.
  res.json({
    materiaal: lijst,
    zonderMateriaal,
    zonderMateriaalPerBron,
    verouderd: strava.isConnected() ? strava.findOutdatedImports().length : 0,
    vanStravaOpgehaald: vanStrava.length,
  });
});

/**
 * POST /api/strava/materiaal/ophalen  { paginas?: number }
 *
 * Haalt het materiaal op voor sessies die het nog niet hebben.
 *
 * Bestaat naast "Analysedata bijwerken" omdat dat alleen ritten kan die ooit
 * via de API zijn binnengekomen. Een archief dat met een CSV is geïmporteerd
 * staat daar niet in, terwijl diezelfde ritten in Strava wél een fiets hebben.
 * Deze route loopt de activiteitenlijst langs — 200 per aanroep in plaats van
 * twee aanroepen per rit — en koppelt op dag, sport, afstand en duur.
 *
 * Na het ophalen wordt de koppeling fiets -> type opnieuw toegepast, zodat de
 * labels er in dezelfde beweging op komen.
 */
router.post("/materiaal/ophalen", async (req, res) => {
  if (!strava.isConnected()) {
    return res.status(400).json({ error: "Strava is nog niet gekoppeld." });
  }
  const paginas = Math.min(Math.max(Number(req.body?.paginas) || 3, 1), 10);
  try {
    const resultaat = await strava.backfillGear({ maxPaginas: paginas });

    // De al gelegde koppelingen alsnog toepassen op wat er net is bijgekomen.
    let gelabeld = 0;
    db.prepare("SELECT id, sub_type FROM strava_gear WHERE sub_type IS NOT NULL")
      .all()
      .forEach((g) => {
        gelabeld += koppelMateriaal(g.id, g.sub_type, { toepassen: true });
      });

    res.json({ ...resultaat, gelabeld });
  } catch (err) {
    res.status(502).json({ error: "Materiaal ophalen mislukt", details: err.message });
  }
});

/**
 * Legt vast wat voor fiets dit Strava-materiaal is, en past dat desgewenst
 * meteen toe op alles wat er al mee gereden is.
 *
 * Los van de route omdat dit de schrijfactie is die ertoe doet, en een
 * hernoeming hem eerder stilletjes kapotmaakte: de route zat nergens onder
 * test, dus een niet-bestaande variabele kwam pas bij gebruik aan het licht.
 *
 * @returns {number} hoeveel sessies zijn bijgewerkt
 */
function koppelMateriaal(gearId, fiets, { naam = null, toepassen = true } = {}) {
  let bijgewerkt = 0;
  const schrijf = db.transaction(() => {
    db.prepare(
      `INSERT INTO strava_gear (id, name, sub_type) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET sub_type = excluded.sub_type, updated_at = datetime('now')`
    ).run(gearId, naam, fiets);

    if (!toepassen) return;
    // Alleen fietssessies: dezelfde schoenen onder een wandeling maken daar
    // geen racefietsrit van.
    const update = db.prepare("UPDATE cardio_logs SET sub_type = ? WHERE id = ?");
    db.prepare("SELECT id, type FROM cardio_logs WHERE gear_id = ?")
      .all(gearId)
      .forEach((rij) => {
        if (calc.baseSportOf(rij.type) !== "Fietsen") return;
        update.run(fiets, rij.id);
        bijgewerkt += 1;
      });
  });
  schrijf();
  return bijgewerkt;
}

/**
 * PUT /api/strava/materiaal/:id  { fiets, toepassenOpGeschiedenis }
 *
 * Zegt wát voor fiets dit is. Nadrukkelijk niet waar je ermee reed: dezelfde
 * mountainbike gaat 's zomers het bos in en 's winters over de weg, en die
 * twee in één keuze persen levert precies de verwarring op die dit veld moet
 * oplossen. De ondergrond staat per sessie.
 *
 * Standaard geldt de keuze ook voor wat er al ligt; dat is waarom dit de
 * moeite waard is, anders zou je jaren ritten één voor één moeten aanwijzen.
 */
router.put("/materiaal/:id", (req, res) => {
  const fiets = req.body?.fiets ?? req.body?.ondergrond ?? null;
  if (fiets !== null && !calc.BIKE_TYPES.find((s) => s.id === fiets)) {
    return res.status(400).json({
      error: `Onbekende fiets "${fiets}". Kies uit: ${calc.BIKE_TYPES.map((s) => s.id).join(", ")}.`,
    });
  }

  const bijgewerkt = koppelMateriaal(req.params.id, fiets, {
    naam: req.body?.naam || null,
    toepassen: req.body?.toepassenOpGeschiedenis !== false,
  });
  res.json({ id: req.params.id, fiets, bijgewerkt });
});

/**
 * GET /api/strava/backfill-status
 * How many stored activities predate the current analysis generation.
 */
router.get("/backfill-status", (req, res) => {
  if (!strava.isConnected()) {
    return res.json({ connected: false, verouderd: 0 });
  }
  const outdated = strava.findOutdatedImports();
  res.json({
    connected: true,
    verouderd: outdated.length,
    analyseVersie: strava.ANALYSIS_VERSION,
  });
});

/**
 * POST /api/strava/backfill  { limit?: number }
 *
 * Re-fetches activities that were imported before the current derived-analysis
 * generation existed, so histograms and power curves appear for your history
 * rather than only for rides imported from now on.
 *
 * Batched deliberately: each activity costs two Strava calls and their rate
 * limit is 100 per 15 minutes, so backfilling a large history has to be done
 * in chunks rather than in one go.
 */
router.post("/backfill", async (req, res) => {
  if (!strava.isConnected()) {
    return res.status(400).json({ error: "Strava is nog niet gekoppeld." });
  }
  const limit = Math.min(Number(req.body?.limit) || 25, 40);
  const outdated = strava.findOutdatedImports().slice(0, limit);

  if (outdated.length === 0) {
    return res.json({ bijgewerkt: 0, resterend: 0, klaar: true });
  }

  const results = { bijgewerkt: 0, mislukt: 0, details: [] };
  let rateLimited = false;

  for (const activityId of outdated) {
    try {
      const result = await importActivity(activityId, { source: "strava_backfill", force: true });
      if (result.imported) {
        results.bijgewerkt++;
        results.details.push({ id: activityId, status: "bijgewerkt" });
      } else {
        results.details.push({ id: activityId, status: result.reason });
      }
    } catch (err) {
      results.mislukt++;
      results.details.push({ id: activityId, status: `mislukt: ${err.message}` });
      if (/rate limit/i.test(err.message)) {
        rateLimited = true;
        break; // stop immediately; continuing would only extend the block
      }
    }
  }

  const resterend = strava.findOutdatedImports().length;
  res.json({
    ...results,
    resterend,
    klaar: resterend === 0,
    rateLimited,
    hint: rateLimited
      ? "Strava's limiet is bereikt. Wacht een kwartier en start opnieuw — de voortgang is bewaard."
      : resterend > 0
      ? `Nog ${resterend} activiteiten te gaan. Klik nogmaals om verder te gaan.`
      : null,
  });
});

module.exports = { router, importActivity, koppelMateriaal };
