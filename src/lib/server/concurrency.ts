// §2.6 — Bounded-concurrency worker pool, extracted from sync-scores so
// admin/results and admin/fifa-sync can share it.
export async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	const queue = items.slice();
	const runners: Promise<void>[] = [];
	for (let i = 0; i < Math.min(limit, queue.length); i++) {
		runners.push((async () => {
			while (queue.length > 0) {
				const item = queue.shift()!;
				try { await worker(item); } catch (e) { console.error('[worker]', e); }
			}
		})());
	}
	await Promise.all(runners);
}
