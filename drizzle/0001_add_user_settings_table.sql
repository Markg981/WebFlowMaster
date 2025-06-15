-- Migration to create the user_settings table

CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY NOT NULL,
  theme TEXT DEFAULT 'light' NOT NULL,
  default_test_url TEXT,
  playwright_browser TEXT DEFAULT 'chromium' NOT NULL,
  playwright_headless INTEGER DEFAULT 1 NOT NULL, -- Boolean stored as 0 or 1
  playwright_default_timeout INTEGER DEFAULT 30000 NOT NULL,
  playwright_wait_time INTEGER DEFAULT 1000 NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
