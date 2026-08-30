-- Additive: the legacy default association and every existing board/file stay
-- untouched. Names belong to the catalog so older tabs cannot undo a rename
-- when saving board content with their old hardcoded notebook title.
CREATE TABLE IF NOT EXISTS lab_notebook_catalog (
  board_id TEXT PRIMARY KEY NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  name_revision INTEGER NOT NULL DEFAULT 1,
  creation_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_email, creation_key)
);
INSERT OR IGNORE INTO lab_notebook_catalog (board_id, owner_email, name, created_at)
  SELECT boards.id, boards.owner_email, boards.name, lab_notebooks.created_at FROM lab_notebooks
  JOIN boards ON boards.id = lab_notebooks.board_id
    AND boards.owner_email = lab_notebooks.owner_email;
PRAGMA optimize;
