// Pure gap attribution for the head-to-head view. Given both entries' points on
// every scorable item (already localized labels), it returns the signed gap
// (you − them), the per-category deltas that sum to it, and the individual picks
// that swung it most. No I/O, no team lookups, no i18n — trivially testable.

export type H2hCategory = 'posicion' | 'eliminatorias' | 'resultados';

export interface ItemPoints {
  /** Stable id, e.g. "pos:F", "ko:r16:0", "res:123". */
  key: string;
  /** Display label, already localized by the caller. */
  label: string;
  category: H2hCategory;
  you: number;
  them: number;
}

export interface Swing {
  key: string; label: string; category: H2hCategory;
  delta: number; you: number; them: number;
}
export interface CategoryDelta { category: H2hCategory; you: number; them: number; delta: number }

export interface Attribution {
  gap: number;          // yourTotal − theirTotal
  yourTotal: number;
  theirTotal: number;
  categories: CategoryDelta[];  // always in CATEGORY_ORDER
  swings: Swing[];              // |delta| desc, delta != 0, capped
}

// Display order: positions first (the biggest category in this pool's scoring),
// then knockout, then group results.
const CATEGORY_ORDER: H2hCategory[] = ['posicion', 'eliminatorias', 'resultados'];

export function computeAttribution(items: ItemPoints[], opts?: { maxSwings?: number }): Attribution {
  const maxSwings = opts?.maxSwings ?? 5;

  let yourTotal = 0, theirTotal = 0;
  const byCat = new Map<H2hCategory, { you: number; them: number }>();
  for (const c of CATEGORY_ORDER) byCat.set(c, { you: 0, them: 0 });

  for (const it of items) {
    yourTotal += it.you;
    theirTotal += it.them;
    const acc = byCat.get(it.category)!;
    acc.you += it.you;
    acc.them += it.them;
  }

  const categories: CategoryDelta[] = CATEGORY_ORDER.map((category) => {
    const { you, them } = byCat.get(category)!;
    return { category, you, them, delta: you - them };
  });

  const swings: Swing[] = items
    .map((it) => ({ key: it.key, label: it.label, category: it.category, delta: it.you - it.them, you: it.you, them: it.them }))
    .filter((s) => s.delta !== 0)
    .sort((a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.key.localeCompare(b.key))
    .slice(0, maxSwings);

  return { gap: yourTotal - theirTotal, yourTotal, theirTotal, categories, swings };
}
