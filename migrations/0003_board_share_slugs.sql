-- A short public name makes an assembly link practical to say, type, and
-- recognize. The original token remains so existing links keep working.
ALTER TABLE board_shares ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS board_shares_by_slug
  ON board_shares(slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS board_shares_by_board_and_assembly
  ON board_shares(board_id, assembly_id);
