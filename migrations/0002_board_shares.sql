-- A share is an opaque, read-only capability link to a board that already
-- belongs to its private owner. The board content stays in `boards`; this
-- table only remembers which saved board and assembly the link opens.
CREATE TABLE IF NOT EXISTS board_shares (
  token TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  assembly_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS board_shares_by_board
  ON board_shares(board_id);
