-- A board keeps one durable owner, while explicitly invited people can read
-- or edit that same board. The email is normalized to lower case by the API;
-- NOCASE also protects older/manual rows from accidental duplicates.
CREATE TABLE IF NOT EXISTS board_collaborators (
  board_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (board_id, email),
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE INDEX IF NOT EXISTS board_collaborators_by_email
  ON board_collaborators(email, board_id);
