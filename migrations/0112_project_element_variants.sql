-- Locator variants of a repository element (run comparison, release 3): the same element where
-- one environment's build renders it differently, chosen by a run's `uiVariant` variable.
-- `{ "<variant>": { "selector": "...", "frameSelector": "..." } }`; empty means the element has
-- one locator, which is every element written before this.
ALTER TABLE project_elements ADD COLUMN variants jsonb NOT NULL DEFAULT '{}'::jsonb;
