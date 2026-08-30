-- A private Lab notebook is an ordinary OSA board document with a separate
-- identity. The association keeps it out of project-board lists and gives its
-- files the same existing board access checks without mixing project data.
CREATE TABLE IF NOT EXISTS lab_notebooks (
  owner_email TEXT PRIMARY KEY NOT NULL,
  board_id TEXT NOT NULL UNIQUE REFERENCES boards(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
