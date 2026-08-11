"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("node:path");

const { initSchema, repairOrphanedCompletions } = require("./db/db");

initSchema();
repairOrphanedCompletions();

const app = express();

/**
 * CORS is off by default, and that is a security decision rather than an
 * oversight.
 *
 * This server has no authentication: anything that can reach it can read and
 * delete a full training history. `cors()` with no options answers every origin
 * with `Access-Control-Allow-Origin: *`, which means any web page you happen to
 * visit while on the same network could read that history straight out of your
 * browser.
 *
 * Nothing needs it. In production this process serves the built interface
 * itself, so the requests are same-origin. In development Vite proxies /api to
 * this port (see vite.config.js), which is same-origin too.
 *
 * Set CORS_ORIGIN if you deliberately run the interface on another host —
 * a specific origin, never "*".
 */
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  if (corsOrigin === "*") {
    console.warn(
      "[cors] CORS_ORIGIN=* laat elke website je gegevens lezen. Vul het adres van je interface in."
    );
  }
  app.use(cors({ origin: corsOrigin }));
  console.log(`[cors] toegestaan vanaf: ${corsOrigin}`);
}

app.use(express.json({ limit: "10mb" })); // GPX-derived profiles + bulk imports can be sizeable

const { router: schemaRoutes } = require("./routes/schema");
const { router: workoutLogRoutes } = require("./routes/workoutLogs");
const { router: cardioLogRoutes } = require("./routes/cardioLogs");
const { router: weightLogRoutes } = require("./routes/weightLogs");
const { router: eventRoutes } = require("./routes/events");
const coachRoutes = require("./routes/coach");
const schemaProposalRoutes = require("./routes/schemaProposal");
const importExportRoutes = require("./routes/importExport");
const analysisRoutes = require("./routes/analysis");
const { router: plannedRoutes } = require("./routes/planned");
const { router: wellnessRoutes } = require("./routes/wellness");
const automationRoutes = require("./routes/automation");
const sessionDetailRoutes = require("./routes/sessionDetail");
const scheduler = require("./lib/scheduler");
const { router: stravaRoutes } = require("./routes/strava");

app.use("/api/schema", schemaRoutes);
app.use("/api/workout-logs", workoutLogRoutes);
app.use("/api/cardio-logs", cardioLogRoutes);
app.use("/api/weight-logs", weightLogRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/coach", coachRoutes);
app.use("/api/coach", schemaProposalRoutes); // /api/coach/goals, /api/coach/schema-proposals
app.use("/api/analysis", analysisRoutes);
app.use("/api/planned", plannedRoutes);
app.use("/api/wellness", wellnessRoutes);
app.use("/api/automation", automationRoutes);
app.use("/api/sessions", sessionDetailRoutes);
app.use("/api", importExportRoutes); // /api/export, /api/import
app.use("/api/strava", stravaRoutes); // OAuth, webhook, sync

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Serve a built frontend if present (see README — this expects the React
// app to be built into ../public via `npm run build` in the frontend project).
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), (err) => {
    if (err) res.status(404).send("Frontend nog niet gebouwd — zie README.md. API draait wel op /api/*.");
  });
});

/**
 * Last-resort error handler.
 *
 * Without one, Express answers an unexpected throw with its default page,
 * which includes a stack trace — internal paths and all — and leaves the
 * interface showing a wall of HTML where it expected JSON. Every route gets a
 * predictable JSON error instead, with the detail kept to the log.
 *
 * Must stay last: Express only treats a four-argument middleware as an error
 * handler, and only if it is registered after the routes it covers.
 */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[fout] ${req.method} ${req.path}:`, err);
  res.status(err.status || 500).json({
    error: err.status && err.status < 500 ? err.message : "Er ging iets mis op de server.",
  });
});

// A rejected promise nobody caught would otherwise terminate the process on
// current Node versions, taking the whole app down over one failed request.
// Logged loudly rather than silently swallowed: it always points at a bug.
process.on("unhandledRejection", (reason) => {
  console.error("[fout] onafgehandelde promise-afwijzing:", reason);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  scheduler.start();
  console.log(`Trainingscoach-server draait op http://localhost:${PORT}`);
  console.log(`  API health check: http://localhost:${PORT}/api/health`);
});
