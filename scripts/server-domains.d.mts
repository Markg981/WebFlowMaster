/** One area of server/: its modules may import only domains of a lower rank. */
export interface ServerDomain {
  name: string;
  rank: number;
  purpose: string;
  /** Paths under server/ without `.ts`; `dir/*` takes a whole directory. */
  modules: string[];
}

export const SERVER_DOMAINS: ServerDomain[];

/** Server modules that are not production code and so belong to no domain. */
export const NOT_IN_A_DOMAIN: RegExp;

/** The domain of a module by its path relative to server/, or null when it has none. */
export function domainOf(relativePath: string): string | null;
