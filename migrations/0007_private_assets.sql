-- A file inherits access from exactly one board. R2 itself remains private;
-- no global content-hash URL is an authorization credential.
CREATE TABLE IF NOT EXISTS private_assets (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (board_id, sha256, content_type),
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE INDEX IF NOT EXISTS private_assets_by_board ON private_assets(board_id);

-- Freeze historical ownership BEFORE clients can create new protected boards.
-- Merely pasting a known global URL into a new board must not claim its bytes.
-- The application never inserts grants; migrations are the only authority.
CREATE TABLE IF NOT EXISTS legacy_asset_grants (
  board_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  PRIMARY KEY (board_id, storage_key),
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE TABLE IF NOT EXISTS private_asset_migrations (id TEXT PRIMARY KEY);

INSERT OR IGNORE INTO legacy_asset_grants (board_id, storage_key)
SELECT board_id, storage_key FROM (
  SELECT boards.id AS board_id,
    CASE
      WHEN substr(reference.value, 1, 7) = '/media/' THEN substr(reference.value, 8)
      WHEN substr(reference.value, 1, length('https://osa.juliaaurorahart.com/media/')) = 'https://osa.juliaaurorahart.com/media/'
        THEN substr(reference.value, length('https://osa.juliaaurorahart.com/media/') + 1)
      ELSE NULL
    END AS storage_key
  FROM boards, json_tree(CASE WHEN json_valid(boards.content) THEN boards.content ELSE '{}' END, '$.snapshot') AS reference
  WHERE reference.type = 'text'
)
WHERE substr(storage_key, 1, 7) = 'images/'
  AND NOT EXISTS (SELECT 1 FROM private_asset_migrations WHERE id = 'legacy_grants_seeded')
  AND length(substr(storage_key, 8, 64)) = 64
  AND substr(storage_key, 8, 64) NOT GLOB '*[^0-9a-f]*'
  AND substr(storage_key, 72) IN ('.jpg', '.png', '.gif', '.webp', '.avif');

INSERT OR IGNORE INTO private_asset_migrations (id) VALUES ('legacy_grants_seeded');
