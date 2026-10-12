// The changelog this installation ships, from GET /api/whats-new (server/platform/changelog.ts).
export type WhatsNewEntry = { text: string; pr: number | null; url: string | null };
export type WhatsNewRelease = {
  version: string;
  date: string | null;
  sections: Array<{ title: string; entries: WhatsNewEntry[] }>;
};
export type WhatsNew = { stamp: string | null; releases: WhatsNewRelease[] };

export const fetchWhatsNew = async (): Promise<WhatsNew> => {
  const response = await fetch('/api/whats-new');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to load what is new');
  }
  return response.json();
};
