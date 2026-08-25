-- Archiving is intentionally a board-level state, not a deletion. Existing
-- board rows (and their public share links) remain intact and visible again
-- when the owner restores the board.
ALTER TABLE boards ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0, 1));

-- Saved-board lists are normally filtered by both owner and archive state.
CREATE INDEX IF NOT EXISTS boards_by_owner_archive_and_updated
  ON boards(owner_email, archived, updated_at DESC);
