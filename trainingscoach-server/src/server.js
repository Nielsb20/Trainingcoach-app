"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("node:path");

const { initSchema } = require("./db/db");

initSchema();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // GPX-derived profiles + bulk imports can be sizeable

const { router: schemaRoutes } = require("./routes/schema");
const { router: workoutLogRoutes } = require("./routes/workoutLogs");
const { router: cardioLogRoutes } = require("./routes/cardioLogs");
const { router: weightLogRoutes } = require("./routes/weightLogs");
const { router: eventRoutes } = require("./routes/events");
const coachRoutes = require("./routes/coach");
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  scheduler.start();
  console.log(`Trainingscoach-server draait op http://localhost:${PORT}`);
  console.log(`  API health check: http://localhost:${PORT}/api/health`);
});
