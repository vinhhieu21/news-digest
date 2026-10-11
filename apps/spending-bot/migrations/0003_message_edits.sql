-- migrations/0003_message_edits.sql
-- Editing an /add message updates the expense it created, so a Telegram message maps to at most one expense.
-- message_id is NULL for non-Telegram sources; NULLs never conflict in a UNIQUE index.
CREATE UNIQUE INDEX ux_expenses_message ON expenses(chat_id, message_id);

ALTER TABLE expenses ADD COLUMN updated_at TEXT;  -- ISO 8601 UTC; set when the /add message is edited
ALTER TABLE expenses ADD COLUMN edit_date INTEGER;  -- Telegram edit_date of the applied edit; older edits are ignored
