-- Migration to add language preference to user_settings table
ALTER TABLE user_settings
ADD COLUMN language TEXT DEFAULT 'en' NOT NULL;

-- Optional: Update existing rows to have a default language if needed,
-- though the DEFAULT 'en' should handle new rows and potentially existing ones
-- depending on the SQLite version and how ALTER TABLE ADD COLUMN with DEFAULT works.
-- For safety, an explicit update for existing rows might be desired by some teams:
-- UPDATE user_settings SET language = 'en' WHERE language IS NULL;
-- However, with 'NOT NULL' and 'DEFAULT', this explicit update is often not necessary for SQLite.
