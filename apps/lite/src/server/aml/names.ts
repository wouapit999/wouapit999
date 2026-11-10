/**
 * Fuzzy name matching for sanctions / PEP screening: Unicode-normalised, order-insensitive,
 * tolerant of typos and missing middle names. Pure functions, no I/O.
 */

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Jaro similarity in [0, 1]. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro–Winkler similarity in [0, 1] (prefix scale 0.1, up to 4 characters). */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix += 1;
  return base + prefix * 0.1 * (1 - base);
}

/**
 * Similarity of two personal names as an integer 0–100: the best of whole-string,
 * token-sorted and token-set (best pairing of each token of the shorter name) Jaro–Winkler.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (a === '' || b === '') return 0;
  if (a === b) return 100;
  const aTokens = a.split(' ');
  const bTokens = b.split(' ');
  const sortedA = [...aTokens].sort().join(' ');
  const sortedB = [...bTokens].sort().join(' ');
  let best = Math.max(jaroWinkler(a, b), jaroWinkler(sortedA, sortedB));

  // Token-set score: every token of the shorter name must find a close partner in the other.
  // Requires at least two tokens on both sides so a lone first name never matches a full name.
  if (aTokens.length >= 2 && bTokens.length >= 2) {
    const [shorter, longer] =
      aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
    const available = [...longer];
    let total = 0;
    for (const token of shorter) {
      let bestIndex = -1;
      let bestScore = 0;
      available.forEach((candidate, index) => {
        const score = jaroWinkler(token, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0) available.splice(bestIndex, 1);
      total += bestScore;
    }
    // Small penalty per unmatched extra token so "A B" vs "A B C D E" is not a perfect match.
    const penalty = Math.min((longer.length - shorter.length) * 0.03, 0.12);
    best = Math.max(best, total / shorter.length - penalty);
  }
  return Math.round(Math.min(best, 1) * 100);
}
