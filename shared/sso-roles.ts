import { z } from "zod";

/**
 * Roles from the identity provider's groups, and the DNS record that proves an e-mail domain.
 *
 * A mapping names a group as the provider sends it (a name, or Entra ID's object id) and the role
 * it gives. At every sign-in the person's role follows their groups: the highest role any of them
 * maps to. Someone in no mapped group keeps their role — or, with "require a group", is refused,
 * which is how access is ended from the provider without SCIM.
 */

export const MAPPED_ROLES = ["viewer", "editor", "owner"] as const;
export type MappedRole = (typeof MAPPED_ROLES)[number];
const RANK: Record<MappedRole, number> = { viewer: 0, editor: 1, owner: 2 };

export const DEFAULT_GROUP_ATTRIBUTE = "groups";

export const roleMappingSchema = z.object({
  group: z.string().trim().min(1).max(256),
  role: z.enum(MAPPED_ROLES),
});
export type RoleMapping = z.infer<typeof roleMappingSchema>;

/** The groups a token's claims or an assertion's attributes carry under one name: a list, or one value. */
export function groupsOf(source: Record<string, unknown>, attribute: string | null | undefined): string[] {
  const value = source[attribute?.trim() || DEFAULT_GROUP_ATTRIBUTE];
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.filter((g): g is string => typeof g === "string" && g.trim() !== "").map((g) => g.trim());
}

/** The highest role the groups map to, or null when none of them is mapped. Groups compare without case. */
export function roleFromGroups(groups: string[], mappings: RoleMapping[]): MappedRole | null {
  const held = new Set(groups.map((g) => g.toLowerCase()));
  let best: MappedRole | null = null;
  for (const mapping of mappings) {
    if (!held.has(mapping.group.toLowerCase())) continue;
    if (best === null || RANK[mapping.role] > RANK[best]) best = mapping.role;
  }
  return best;
}

/** The TXT record an owner publishes to prove a domain: name and value. */
export function domainVerificationRecord(domain: string, token: string): { name: string; value: string } {
  return { name: `_wfm-verification.${domain}`, value: `wfm-verification=${token}` };
}
