-- A monotonically increasing revision lets a client prove which saved version
-- it edited. This is the optimistic-concurrency guard for cloud autosave.
ALTER TABLE boards ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1);
