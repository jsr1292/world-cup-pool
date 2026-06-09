import { describe, it, expect } from 'vitest';
import { resolveSelectedPrediction } from '$lib/server/queries.js';

// The shared resolver used by the predict, bracket and results stages to map
// ?entry=<param> to a single entry. Keeping the three stages on this one
// function is what guarantees the same dropdown selection loads the SAME entry
// everywhere.
describe('resolveSelectedPrediction', () => {
	const preds = [
		{ id: 10, label: '' },        // default/principal entry (empty label)
		{ id: 11, label: 'Alt' },
		{ id: 12, label: 'Casa' },
	];

	it('returns the first/default entry when the param is absent or empty', () => {
		expect(resolveSelectedPrediction(preds, null)?.id).toBe(10);
		expect(resolveSelectedPrediction(preds, '')?.id).toBe(10);
		expect(resolveSelectedPrediction(preds, undefined)?.id).toBe(10);
	});

	it('selects by exact id (unambiguous, preferred)', () => {
		expect(resolveSelectedPrediction(preds, '11')?.id).toBe(11);
		expect(resolveSelectedPrediction(preds, '12')?.id).toBe(12);
	});

	it('selects the default entry by its id even though its label is empty', () => {
		// This is the case the old label-based selector got wrong (empty label).
		expect(resolveSelectedPrediction(preds, '10')?.id).toBe(10);
	});

	it('falls back to a case-insensitive, trimmed label match (legacy URLs)', () => {
		expect(resolveSelectedPrediction(preds, 'Alt')?.id).toBe(11);
		expect(resolveSelectedPrediction(preds, 'alt')?.id).toBe(11);
		expect(resolveSelectedPrediction(preds, '  Casa  ')?.id).toBe(12);
	});

	it('falls back to the first entry when nothing matches', () => {
		expect(resolveSelectedPrediction(preds, '999')?.id).toBe(10);  // no such id → label? no → first
		expect(resolveSelectedPrediction(preds, 'nope')?.id).toBe(10);
	});

	it('prefers an id match over a coincidental numeric label', () => {
		const p2 = [{ id: 5, label: 'x' }, { id: 9, label: '5' }];
		// '5' matches id 5 first (id-preferred), not the entry whose label is "5".
		expect(resolveSelectedPrediction(p2, '5')?.id).toBe(5);
	});

	it('returns null for an empty list', () => {
		expect(resolveSelectedPrediction([], '10')).toBeNull();
		expect(resolveSelectedPrediction([], null)).toBeNull();
	});
});
