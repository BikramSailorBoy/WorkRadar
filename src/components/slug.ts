import { items } from "@/lib/data";

/** "jira:PAY-412" -> "jira-PAY-412". Prefixes never contain "-", so the first "-" is the separator. */
export const slugOf = (id: string) => id.replace(":", "-");

const bySlug = new Map(items.map((i) => [slugOf(i.id), i.id]));

/** Accepts a slug, an encoded id ("jira%3APAY-412") or a raw id. */
export function idFromSlug(slug: string): string | undefined {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  if (bySlug.has(s)) return bySlug.get(s);
  if (items.some((i) => i.id === s)) return s;
  const lower = s.toLowerCase();
  for (const [k, v] of bySlug) if (k.toLowerCase() === lower) return v;
  return undefined;
}

export const itemHref = (id: string) => `/item/${slugOf(id)}`;
