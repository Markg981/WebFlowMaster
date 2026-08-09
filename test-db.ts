import { privilegedDb } from "./server/db";
import { userSettings } from "./shared/schema";

console.log("Checking User Settings...");
(async () => {
  try {
    const result = await privilegedDb.select().from(userSettings).limit(10);
    console.log("User Settings in DB:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("Failed to check DB:", e);
    process.exit(1);
  }
})();
