-- The languages a plan runs each test in (shared/locales.ts). Empty, the default, is what every
-- plan did before: one pass per browser, in the browser's own language.
ALTER TABLE "test_plans" ADD COLUMN "locales" jsonb DEFAULT '[]'::jsonb NOT NULL;
