/**
 * Split a watchlist role keyword into tokens for title matching.
 * Tokens shorter than 2 characters are dropped (noise).
 */
export function roleKeywordTokens(keyword: string | null | undefined): string[] {
  if (!keyword?.trim()) return [];
  return keyword
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * True if the job title matches the watchlist keyword: all tokens must appear as
 * substrings (case-insensitive). Empty or token-less keyword matches any title.
 */
export function titleMatchesRoleKeyword(
  title: string,
  roleKeyword: string | null | undefined
): boolean {
  const tokens = roleKeywordTokens(roleKeyword);
  if (tokens.length === 0) return true;
  const lower = title.toLowerCase();
  return tokens.every((t) => lower.includes(t.toLowerCase()));
}
