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
 * How far above its weakest token pair a multi-token score may rise. One unrelated token caps
 * the score, so a weak pair cannot be averaged away by a strong one (or by a shared prefix).
 */
const WEAKEST_PAIR_HEADROOM = 0.1;

/**
 * Best one-to-one pairing of each token of `shorter` with a token of `longer` (greedy).
 * Returns the mean pair score and the weakest pair score.
 */
function pairTokens(
  shorter: readonly string[],
  longer: readonly string[],
): { mean: number; weakest: number } {
  const available = [...longer];
  let total = 0;
  let weakest = 1;
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
    weakest = Math.min(weakest, bestScore);
  }
  return { mean: total / shorter.length, weakest };
}

/**
 * Similarity of two personal names as an integer 0–100.
 *
 * - Same number of tokens: the best of whole-string, token-sorted and token-paired
 *   Jaro–Winkler (typos, reordered names).
 * - Different number of tokens, two or more on each side: token-paired only — every token of
 *   the shorter name must find a close partner in the longer one (missing middle names), less a
 *   small penalty per extra token.
 * - In both cases the score is held down by the weakest token pair, so sharing a first name is
 *   never enough: "Paul Ondo" does not match "Paula E. Governadora", nor "Joao Silva"
 *   "Joao Santos".
 * - A single token against a full name: whole-string score scaled down by the length ratio, so
 *   a lone first name never matches a full name.
 *
 * Whole-string Jaro–Winkler is deliberately not used across different token counts: its prefix
 * bonus rates a short name that merely starts like a long one as a near match.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (a === '' || b === '') return 0;
  if (a === b) return 100;
  const aTokens = a.split(' ');
  const bTokens = b.split(' ');
  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];

  let best: number;
  if (shorter.length >= 2) {
    const { mean, weakest } = pairTokens(shorter, longer);
    if (shorter.length === longer.length) {
      const sortedA = [...aTokens].sort().join(' ');
      const sortedB = [...bTokens].sort().join(' ');
      best = Math.max(jaroWinkler(a, b), jaroWinkler(sortedA, sortedB), mean);
    } else {
      // Small penalty per unmatched extra token so "A B" vs "A B C D E" is not a perfect match.
      best = mean - Math.min((longer.length - shorter.length) * 0.03, 0.12);
    }
    best = Math.min(best, weakest + WEAKEST_PAIR_HEADROOM);
  } else if (longer.length === 1) {
    best = jaroWinkler(a, b);
  } else {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    best = jaroWinkler(a, b) * Math.sqrt(ratio);
  }
  return Math.round(Math.min(Math.max(best, 0), 1) * 100);
}
