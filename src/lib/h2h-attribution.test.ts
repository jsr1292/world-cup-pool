import { describe, it, expect } from 'vitest';
import { computeAttribution, type ItemPoints } from './h2h-attribution.js';

const item = (key: string, category: any, you: number, them: number, label = key): ItemPoints =>
  ({ key, label, category, you, them });

describe('computeAttribution', () => {
  it('signs the gap as you − them (behind, ahead, level)', () => {
    // yourTotal = 0+1+6+1 = 8; theirTotal = 8+4+0+0 = 12; gap = -4 (behind).
    const behind = computeAttribution([
      item('pos:F', 'posicion', 0, 8), item('pos:B', 'posicion', 1, 4),
      item('ko:r16:0', 'eliminatorias', 6, 0), item('res:1', 'resultados', 1, 0),
    ]);
    expect(behind.yourTotal).toBe(8);
    expect(behind.theirTotal).toBe(12);
    expect(behind.gap).toBe(-4);

    const ahead = computeAttribution([item('a', 'resultados', 5, 2)]);
    expect(ahead.gap).toBe(3);

    const level = computeAttribution([item('a', 'resultados', 4, 4)]);
    expect(level.gap).toBe(0);
  });

  it('category deltas sum to the gap and are in fixed order', () => {
    const a = computeAttribution([
      item('pos:F', 'posicion', 0, 8),
      item('ko:final:0', 'eliminatorias', 14, 0),
      item('res:1', 'resultados', 1, 0),
      item('res:2', 'resultados', 0, 1),
    ]);
    expect(a.categories.map((c) => c.category)).toEqual(['posicion', 'eliminatorias', 'resultados']);
    expect(a.categories.reduce((s, c) => s + c.delta, 0)).toBe(a.gap);
    expect(a.categories.find((c) => c.category === 'posicion')!.delta).toBe(-8);
    expect(a.categories.find((c) => c.category === 'eliminatorias')!.delta).toBe(14);
    expect(a.categories.find((c) => c.category === 'resultados')!.delta).toBe(0);
  });

  it('orders swings by |delta| desc; a group-position swing outranks a smaller champion delta', () => {
    const a = computeAttribution([
      item('pos:F', 'posicion', 0, 8, 'Grupo F · posición'),   // delta -8
      item('ko:final:0', 'eliminatorias', 6, 0, 'Campeón'),    // delta +6
      item('pos:B', 'posicion', 4, 1, 'Grupo B · posición'),   // delta +3
      item('res:1', 'resultados', 1, 1),                       // delta 0 → excluded
    ]);
    expect(a.swings.map((s) => s.key)).toEqual(['pos:F', 'ko:final:0', 'pos:B']);
    expect(a.swings.every((s) => s.delta !== 0)).toBe(true);
  });

  it('caps swings and breaks ties deterministically', () => {
    const items = [
      item('res:3', 'resultados', 1, 0), item('res:1', 'resultados', 1, 0),
      item('res:2', 'resultados', 1, 0), item('res:5', 'resultados', 1, 0),
      item('res:4', 'resultados', 1, 0), item('res:6', 'resultados', 1, 0),
    ];
    const a = computeAttribution(items, { maxSwings: 3 });
    expect(a.swings).toHaveLength(3);
    // all |delta|=1, same category → tiebreak by key asc, stable across runs
    expect(a.swings.map((s) => s.key)).toEqual(['res:1', 'res:2', 'res:3']);
    expect(computeAttribution(items, { maxSwings: 3 }).swings.map((s) => s.key)).toEqual(['res:1', 'res:2', 'res:3']);
  });

  it('identical sides → gap 0, no swings, zero category deltas', () => {
    const a = computeAttribution([
      item('pos:A', 'posicion', 4, 4), item('ko:r16:0', 'eliminatorias', 3, 3),
    ]);
    expect(a.gap).toBe(0);
    expect(a.swings).toEqual([]);
    expect(a.categories.every((c) => c.delta === 0)).toBe(true);
  });

  it('breaks equal |delta| ties by category order, not key order', () => {
    // Both deltas are +5. Plain keys 'a'/'z' are chosen so key order alone would
    // put 'a' first — the category tiebreak (posicion before resultados) must
    // override that and put the posicion item ('z') first. Prefixed keys like
    // 'pos:'/'res:' would let the key fallback pass this by accident.
    const a = computeAttribution([
      item('a', 'resultados', 5, 0),
      item('z', 'posicion', 5, 0),
    ]);
    expect(a.swings.map((s) => s.key)).toEqual(['z', 'a']);
  });

  it('defaults maxSwings to 5 when opts is omitted', () => {
    const items = [
      item('res:1', 'resultados', 1, 0), item('res:2', 'resultados', 1, 0),
      item('res:3', 'resultados', 1, 0), item('res:4', 'resultados', 1, 0),
      item('res:5', 'resultados', 1, 0), item('res:6', 'resultados', 1, 0),
    ];
    const a = computeAttribution(items);
    expect(a.swings.length).toBe(5);
  });

  it('handles empty input without throwing', () => {
    const a = computeAttribution([]);
    expect(a.gap).toBe(0);
    expect(a.swings).toEqual([]);
    expect(a.categories.every((c) => c.delta === 0)).toBe(true);
    expect(a.yourTotal).toBe(0);
    expect(a.theirTotal).toBe(0);
  });
});
