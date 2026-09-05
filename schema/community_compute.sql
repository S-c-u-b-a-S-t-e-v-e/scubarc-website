PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contributors (
  contributor_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  virginia_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (virginia_opt_in IN (0,1)),
  locality TEXT NOT NULL DEFAULT '',
  consent_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(contributor_id),
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  logical_processors INTEGER NOT NULL CHECK (logical_processors BETWEEN 1 AND 256),
  wasm_support INTEGER NOT NULL CHECK (wasm_support IN (0,1)),
  webgpu_support INTEGER NOT NULL CHECK (webgpu_support IN (0,1)),
  device_class TEXT NOT NULL CHECK (device_class IN ('desktop','mobile')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','paused','revoked'))
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  public_benefit INTEGER NOT NULL DEFAULT 1 CHECK (public_benefit IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','complete'))
);

CREATE TABLE IF NOT EXISTS work_units (
  work_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  work_type TEXT NOT NULL,
  seed INTEGER NOT NULL,
  iterations INTEGER NOT NULL,
  expected_result INTEGER NOT NULL,
  replication_factor INTEGER NOT NULL DEFAULT 3 CHECK (replication_factor BETWEEN 1 AND 10),
  verified_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('open','verified','expired','cancelled'))
);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_units(work_id),
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued','verified','rejected','expired')),
  UNIQUE(work_id, node_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(assignment_id),
  work_id TEXT NOT NULL REFERENCES work_units(work_id),
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  result_value INTEGER NOT NULL,
  runtime_ms INTEGER NOT NULL,
  client_version TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified','rejected','quarantined'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_contributor ON nodes(contributor_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_work_status_expires ON work_units(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_assignments_work ON assignments(work_id);
CREATE INDEX IF NOT EXISTS idx_assignments_node ON assignments(node_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(verification_status);

-- Game schema (versioned for Commonwealth Surf v0, extensible for future modes)
CREATE TABLE IF NOT EXISTS game_runs (
  run_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  contributor_id TEXT NOT NULL REFERENCES contributors(contributor_id),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT 'surf',
  game_version TEXT NOT NULL DEFAULT 'surf-0.1',
  contest_day TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','completed','expired','rejected')),
  server_score INTEGER NOT NULL DEFAULT 0,
  distance_cm INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  terminal_reason TEXT,
  prize_eligible INTEGER NOT NULL DEFAULT 1 CHECK (prize_eligible IN (0,1))
);

CREATE TABLE IF NOT EXISTS game_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES game_runs(run_id),
  sequence INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS leaderboard (
  entry_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES game_runs(run_id),
  contributor_id TEXT NOT NULL REFERENCES contributors(contributor_id),
  nickname TEXT NOT NULL,
  game_type TEXT NOT NULL,
  contest_day TEXT NOT NULL,
  server_score INTEGER NOT NULL,
  achieved_at TEXT NOT NULL,
  prize_eligible INTEGER NOT NULL DEFAULT 1 CHECK (prize_eligible IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_game_runs_node ON game_runs(node_id);
CREATE INDEX IF NOT EXISTS idx_game_runs_status ON game_runs(status);
CREATE INDEX IF NOT EXISTS idx_game_runs_expires ON game_runs(expires_at);
CREATE INDEX IF NOT EXISTS idx_game_runs_contest ON game_runs(contest_day, game_type);
CREATE INDEX IF NOT EXISTS idx_game_events_run ON game_events(run_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(game_type, contest_day, server_score DESC, achieved_at ASC);
