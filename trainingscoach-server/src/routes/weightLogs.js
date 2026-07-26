"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

function serialize(row) {
  return { id: row.id, date: row.date, weight_kg: row.weight_kg, body_fat_pct: row.body_fat_pct, notes: row.notes };
}

// GET /api/weight-logs
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM weight_logs ORDER BY date ASC").all();
  res.json(rows.map(serialize));
});

// POST /api/weight-logs
router.post("/", (req, res) => {
  const entry = req.body;
  try {
    db.prepare("INSERT INTO weight_logs (id, date, weight_kg, body_fat_pct, notes) VALUES (?, ?, ?, ?, ?)").run(
      entry.id,
      entry.date,
      entry.weight_kg,
      entry.body_fat_pct ?? null,
      entry.notes ?? null
    );
    res.status(201).json(serialize(db.prepare("SELECT * FROM weight_logs WHERE id = ?").get(entry.id)));
  } catch (err) {
    res.status(500).json({ error: "Kon gewicht niet opslaan", details: err.message });
  }
});

// DELETE /api/weight-logs/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM weight_logs WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = { router, serialize };
