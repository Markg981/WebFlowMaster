// client/src/lib/settings.ts
export interface UserSettings {
  theme: "light" | "dark";
  defaultTestUrl: string | null;
  playwrightBrowser: "chromium" | "firefox" | "webkit";
  playwrightHeadless: boolean;
  playwrightDefaultTimeout: number;
  playwrightWaitTime: number;
  language?: string; // Add language preference (e.g., "en", "it")
}

export const fetchSettings = async (): Promise<UserSettings> => {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    throw new Error("Failed to fetch settings");
  }
  // Ensure the returned data structure matches UserSettings,
  // especially for fields like defaultTestUrl which might be '' from backend
  // and needs to be handled if your type expects `string | null`.
  // The current UserSettings type is fine with how settings-page.tsx handles it.
  const settings = await response.json();
  // Ensure language has a default value if not present
  if (!settings.language) {
    settings.language = "en"; // Default to English
  }
  return settings;
};
