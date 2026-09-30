-- A local Appium (shared/browser-grids.ts): a grid of provider 'local_appium' reached through a pool
-- of local agents, which is named here; its address is the one the agent's machine uses.
ALTER TABLE "browser_grids" ADD COLUMN "agent_pool" text;
