-- SQLite schema for Trainingscoach.
-- Single-user by design (matches the current app); the `profile` table is a
-- single row. Session-shaped time series (the per-second GPX bucket profile)
-- are stored as JSON blobs rather than fully normalized — they're written
-- once, read as a whole, and never queried relationally, so normalizing
-- them would add complexity without benefit at this scale.

PRAGMA foreign_keys = ON;

-- Personal profile: max HR, resting HR, FTP. Always exactly one row (id=1).
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_hr INTEGER,
  resting_hr INTEGER,
  ftp INTEGER
);
INSERT OR IGNORE INTO profile (id, max_hr, resting_hr, ftp) VALUES (1, NULL, NULL, NULL);

-- Strength training schema (the fixed weekly split)
CREATE TABLE IF NOT EXISTS schema_days (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schema_exercises (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES schema_days(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps INTEGER NOT NULL DEFAULT 8,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Fixed weekly cardio slots
CREATE TABLE IF NOT EXISTS schema_cardio_days (
  id TEXT PRIMARY KEY,
  weekday TEXT NOT NULL,
  type TEXT NOT NULL,
  notes TEXT
);

-- Strength workout logs
CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,             -- YYYY-MM-DD
  time_of_day TEXT,               -- 'ochtend' | 'middag' | 'avond'
  day_id TEXT,
  day_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_log_exercises (
  id TEXT PRIMARY KEY,
  workout_log_id TEXT NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workout_log_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id TEXT NOT NULL REFERENCES workout_log_exercises(id) ON DELETE CASCADE,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Cardio logs (manual entry, CSV bulk import, and GPX import all land here)
CREATE TABLE IF NOT EXISTS cardio_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time_of_day TEXT,
  type TEXT NOT NULL,
  duration_min REAL,              -- moving time
  total_duration_min REAL,        -- elapsed time incl. stops (GPX-derived sessions only)
  distance_km REAL,
  avg_hr INTEGER,
  max_hr INTEGER,
  avg_power INTEGER,
  max_power INTEGER,
  weighted_avg_power INTEGER,     -- Normalized Power
  avg_cadence INTEGER,
  max_cadence INTEGER,
  elevation_gain_m INTEGER,
  elevation_loss_m INTEGER,
  pace TEXT,
  calories INTEGER,
  notes TEXT,
  profile_json TEXT,              -- JSON array of {tMin, gemHartslag, gemSnelheidKmu, gemVermogen, gemCadans, hoogte} buckets, or NULL
  source TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'csv_import' | 'gpx_import'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cardio_logs_date ON cardio_logs(date);

-- Body weight
CREATE TABLE IF NOT EXISTS weight_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  body_fat_pct REAL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_weight_logs_date ON weight_logs(date);

-- Planned events / races
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT,
  target TEXT,
  notes TEXT
);

-- AI coach feedback history
CREATE TABLE IF NOT EXISTS coach_history (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,             -- ISO timestamp
  question TEXT,
  analyse TEXT,
  tips_json TEXT,                 -- JSON array of strings
  waarschuwing TEXT,
  cardio_voorstel_json TEXT,      -- JSON array of {dag, type, invulling}
  raw_feedback TEXT               -- fallback plain-text if the model didn't return valid JSON
);

-- Strava OAuth tokens. Single-user like the rest of the app, so exactly one
-- row (id=1). Access tokens expire after ~6 hours; the refresh token is
-- long-lived and is used to mint new access tokens without re-authorising.
CREATE TABLE IF NOT EXISTS strava_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,          -- unix seconds, from Strava
  athlete_id INTEGER,
  athlete_name TEXT,
  connected_at TEXT
);
INSERT OR IGNORE INTO strava_tokens (id) VALUES (1);

-- Log of activities pulled in via the webhook, so a re-delivered event
-- doesn't create a duplicate session.
CREATE TABLE IF NOT EXISTS strava_imported_activities (
  strava_activity_id INTEGER PRIMARY KEY,
  cardio_log_id TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Derived analysis data, computed once at import from the raw streams.
-- Stored as histograms/curves rather than raw per-second series: a fraction of
-- the size, and time-in-zone can be recomputed from a histogram whenever the
-- athlete's max HR or FTP changes.
ALTER TABLE cardio_logs ADD COLUMN hr_histogram_json TEXT;
ALTER TABLE cardio_logs ADD COLUMN power_histogram_json TEXT;
ALTER TABLE cardio_logs ADD COLUMN power_curve_json TEXT;

-- Cardio sessions the coach proposed, so "planned vs actual" can be tracked.
CREATE TABLE IF NOT EXISTS planned_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,              -- YYYY-MM-DD the session is planned for
  weekday TEXT,                    -- as the coach phrased it
  type TEXT NOT NULL,
  description TEXT NOT NULL,       -- the coach's "invulling"
  source_coach_entry_id TEXT,      -- which coach answer produced this
  completed_cardio_log_id TEXT,    -- filled in when matched to an actual session
  status TEXT NOT NULL DEFAULT 'gepland',  -- 'gepland' | 'gedaan' | 'overgeslagen'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_planned_sessions_date ON planned_sessions(date);

-- Daily wellness / recovery metrics. Deliberately source-agnostic: rows can
-- come from an automatic Garmin fetch, a CSV export, or manual entry. The
-- coach only cares that the numbers are there, not where they came from —
-- which matters because the unofficial Garmin route is known to break.
CREATE TABLE IF NOT EXISTS wellness_logs (
  date TEXT PRIMARY KEY,           -- one row per day
  resting_hr INTEGER,
  hrv_ms INTEGER,                  -- overnight HRV (RMSSD-style, ms)
  sleep_minutes INTEGER,
  sleep_score INTEGER,             -- 0-100 if the device reports one
  body_battery_max INTEGER,
  body_battery_min INTEGER,
  stress_avg INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wellness_logs_date ON wellness_logs(date);

-- Planned sessions gained a 'voorgesteld' (proposed) state: coach suggestions
-- land there first so they can be reviewed against what's already committed,
-- rather than silently stacking on top of it.
ALTER TABLE planned_sessions ADD COLUMN duration_min INTEGER;
ALTER TABLE planned_sessions ADD COLUMN intensity TEXT;

-- Which generation of derived analysis a stored activity was imported with.
-- Bumping ANALYSIS_VERSION in strava.js makes the sync re-fetch older rows
-- instead of skipping them as "already imported" — which is exactly what went
-- wrong when histograms and the power curve were added after the first import.
ALTER TABLE strava_imported_activities ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 0;
