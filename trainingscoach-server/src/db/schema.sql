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

-- Stability controls for the plan. Without these, every coach answer behaves
-- like "here is your new week", which makes the plan feel unstable and
-- overwrites commitments the athlete has already made.
--   locked      - never touched by coach proposals (club ride, fixed commitment)
--   replaces_id - marks a proposal as a CHANGE to an existing session rather
--                 than a competing extra one
ALTER TABLE planned_sessions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planned_sessions ADD COLUMN replaces_id TEXT;
ALTER TABLE planned_sessions ADD COLUMN decline_reason TEXT;

-- Optional subjective load for strength sessions. There is no power meter in a
-- gym, so session-RPE (rate of perceived exertion x duration) is the accepted
-- way to quantify that load. Kept separate from cardio TSS rather than merged
-- into it: the two aren't the same unit, and silently adding them would corrupt
-- the CTL/ATL model that the coach treats as authoritative.
ALTER TABLE workout_logs ADD COLUMN rpe INTEGER;
ALTER TABLE workout_logs ADD COLUMN duration_min INTEGER;

-- Planned sessions now cover both disciplines. Cardio plans match against
-- cardio_logs when checking what was actually done; strength plans match
-- against workout_logs.
ALTER TABLE planned_sessions ADD COLUMN discipline TEXT NOT NULL DEFAULT 'cardio';
ALTER TABLE coach_history ADD COLUMN kracht_voorstel_json TEXT;

-- Fixed weekdays per strength training day. Cardio already had this via
-- schema_cardio_days; strength didn't, which forced the coach to infer a
-- rotation from the logs. Comma-separated because some people run the same
-- workout twice a week (e.g. "Dinsdag,Vrijdag").
ALTER TABLE schema_days ADD COLUMN weekdays TEXT;

-- Time of day per scheduled training. The gap between an evening gym session
-- and a morning ride is ~12 hours; the same pair the other way round is ~36.
-- That difference matters for recovery, so it belongs in the schedule rather
-- than only in the logs after the fact.
ALTER TABLE schema_days ADD COLUMN time_of_day TEXT;
ALTER TABLE schema_cardio_days ADD COLUMN time_of_day TEXT;
ALTER TABLE planned_sessions ADD COLUMN time_of_day TEXT;

-- Automatic coach consultation. Off by default: the athlete opts in, and even
-- then nothing is auto-accepted — runs produce proposals, which still need
-- reviewing in the planner.
CREATE TABLE IF NOT EXISTS coach_automation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  weekly_enabled INTEGER NOT NULL DEFAULT 0,
  weekly_weekday TEXT NOT NULL DEFAULT 'Zondag',
  weekly_hour INTEGER NOT NULL DEFAULT 19,
  signals_enabled INTEGER NOT NULL DEFAULT 0,
  cooldown_days INTEGER NOT NULL DEFAULT 3,
  last_weekly_run TEXT,
  last_signal_run TEXT,
  last_signal_reason TEXT,
  last_error TEXT
);
INSERT OR IGNORE INTO coach_automation (id) VALUES (1);

-- Why a coach answer exists: asked manually, the weekly slot, or a signal.
ALTER TABLE coach_history ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'handmatig';
ALTER TABLE coach_history ADD COLUMN trigger_reason TEXT;

-- Coach feedback on one specific session. Cached rather than regenerated on
-- every visit: the underlying ride never changes, so asking the model again
-- would cost tokens for an answer that should be identical.
CREATE TABLE IF NOT EXISTS session_feedback (
  cardio_log_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  analyse TEXT,
  tips_json TEXT,
  raw_feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Where a session was moved from, and when. Without this the coach sees a day
-- the athlete deliberately emptied as simply free, and fills it straight back
-- in — undoing a reorganisation they made on purpose.
ALTER TABLE planned_sessions ADD COLUMN moved_from TEXT;
ALTER TABLE planned_sessions ADD COLUMN moved_at TEXT;

-- What the athlete is actually training for. Events say "there is a race on
-- the 12th"; this says why the weeks before it look the way they do — get
-- stronger, lose weight, ride 150 km. Single row like `profile`: one athlete,
-- one set of goals.
--
-- Without this the coach can only ever comment on the schema it is given. With
-- it, it can propose the schema itself: the constraints (available days,
-- session length, equipment, injuries) are exactly what separates a plan that
-- fits this athlete from a generic template.
CREATE TABLE IF NOT EXISTS training_goals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  goal TEXT,                       -- free text: what the athlete wants to achieve
  focus TEXT,                      -- 'kracht' | 'cardio' | 'combi'
  strength_days_per_week INTEGER,
  cardio_days_per_week INTEGER,
  session_minutes INTEGER,         -- how long one strength session may take
  available_weekdays TEXT,         -- comma separated, empty = no restriction
  equipment TEXT,                  -- gym, home rack, dumbbells only, …
  experience TEXT,                 -- training age / level, in the athlete's words
  limitations TEXT,                -- injuries, niggles, exercises to avoid
  notes TEXT,
  updated_at TEXT
);
INSERT OR IGNORE INTO training_goals (id) VALUES (1);

-- Schemas the coach proposed, as proposals rather than edits.
--
-- Accepting one replaces the whole strength/cardio schema, which is the most
-- destructive write in the app — so the schema as it was is snapshotted into
-- previous_schema_json first and accepting stays undoable. A declined proposal
-- keeps its reason: it is fed back into the next request so the same rejected
-- plan does not come back unchanged.
CREATE TABLE IF NOT EXISTS schema_proposals (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,              -- ISO timestamp
  status TEXT NOT NULL DEFAULT 'voorgesteld',
                                   -- 'voorgesteld' | 'geaccepteerd' | 'afgewezen'
                                   -- | 'teruggedraaid' | 'vervangen' | 'mislukt'
  question TEXT,                   -- optional extra instruction from the athlete
  goals_json TEXT,                 -- the goals as they stood when this was asked
  proposal_json TEXT,              -- {days: [...], cardioDays: [...]}
  toelichting TEXT,                -- why this schema, in the coach's words
  opbouw_json TEXT,                -- JSON array: how it progresses over the weeks
  waarschuwing TEXT,
  raw_feedback TEXT,               -- fallback when the model returned no valid JSON
  decline_reason TEXT,
  applied_at TEXT,
  previous_schema_json TEXT        -- the schema this replaced, so accepting is undoable
);
CREATE INDEX IF NOT EXISTS idx_schema_proposals_date ON schema_proposals(date);

-- What had to be corrected in a proposal before it was fit to store: a weekday
-- the athlete never made available, a cardio slot that could not be placed.
-- The prompt states those constraints as hard rules and a model still broke
-- them, so they are enforced in code — and the corrections are kept here so the
-- athlete sees what was taken out instead of it happening silently.
ALTER TABLE schema_proposals ADD COLUMN correcties_json TEXT;

-- Vaste afspraken in het schema zelf.
--
-- "Beschikbare weekdagen" zegt wanneer iemand *kan* trainen; dit zegt dat een
-- moment al is afgesproken — met een trainingspartner, een club, of thuis met
-- kleine kinderen. Zulke dagen mag de coach niet verschuiven, ook niet naar een
-- andere dag die technisch beschikbaar is. De planner kent dit onderscheid al
-- via planned_sessions.locked; het schema kende het nog niet, waardoor een
-- schemavoorstel een afspraak kon verzetten die buiten de app is gemaakt.
--
-- De inhoud blijft wel aan de coach: hij bepaalt WAT je die dag doet, jij WANNEER.
ALTER TABLE schema_days ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schema_cardio_days ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
