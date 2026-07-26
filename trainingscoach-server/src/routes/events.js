"use strict";

const express = require("express");
const { db } = require("../db/db");

const router = express.Router();

function serialize(row) {
  return { id: row.id, name: row.name, date: row.date, type: row.type, target: row.target, notes: row.notes };
}

// GET /api/events
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM events ORDER BY date ASC").all();
  res.json(rows.map(serialize));
});

// POST /api/events
router.post("/", (req, res) => {
  const entry = req.body;
  try {
    db.prepare("INSERT INTO events (id, name, date, type, target, notes) VALUES (?, ?, ?, ?, ?, ?)").run(
      entry.id,
      entry.name,
      entry.date,
      entry.type ?? null,
      entry.target ?? null,
      entry.notes ?? null
    );
    res.status(201).json(serialize(db.prepare("SELECT * FROM events WHERE id = ?").get(entry.id)));
  } catch (err) {
    res.status(500).json({ error: "Kon evenement niet opslaan", details: err.message });
  }
});

// DELETE /api/events/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = { router, serialize };
