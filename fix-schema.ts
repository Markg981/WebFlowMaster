import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function fixSchema() {
  console.log("Fixing user_settings table...");
  try {
    await db.execute(sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS language text DEFAULT 'en' NOT NULL`);
    console.log("Added 'language' column.");
    
    await db.execute(sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now() NOT NULL`);
    console.log("Added 'updated_at' column.");

    console.log("Schema fix completed successfully!");
  } catch (error) {
    console.error("Failed to fix schema:");
    console.error(error);
  }
}

fixSchema();
