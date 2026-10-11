-- migrations/0004_budget.sql
-- One monthly budget per group chat. No row = no budget (/budget off deletes it).
CREATE TABLE budgets (
  chat_id       INTEGER PRIMARY KEY,
  amount        INTEGER NOT NULL CHECK (amount > 0),  -- whole VND per calendar month (ICT)
  warned_month  TEXT NOT NULL,                         -- "YYYY-MM" (ICT) that warned_level belongs to
  warned_level  INTEGER NOT NULL DEFAULT 0,            -- highest warning sent in warned_month: 0, 80 or 100
  updated_at    TEXT NOT NULL                          -- ISO 8601 UTC
);
