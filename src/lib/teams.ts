// Map our flag_code values → flagcdn.com codes. Most are ISO 3166-1 alpha-2;
// England/Scotland/Wales use GB subdivision codes.
const FLAGCDN_CODE: Record<string, string> = { ENG: 'gb-eng', SCT: 'gb-sct', WAL: 'gb-wls' };

/** Normalize a team flag_code to a flagcdn slug, or '' if unknown. */
export function flagSlug(code: string): string {
	if (!code) return '';
	const up = code.toUpperCase();
	if (FLAGCDN_CODE[up]) return FLAGCDN_CODE[up];
	if (/^[A-Z]{2}$/.test(up)) return up.toLowerCase();
	return '';
}

/**
 * Flag as an <img> (from flagcdn.com), sized to 1em so it scales with the
 * surrounding font-size. Render with {@html flagEmoji(code)}.
 *
 * Why not emoji: Windows ships no flag-emoji font, so regional-indicator
 * emoji render blank/as letters there. An <img> renders on every platform.
 * The slug is whitelisted to [a-z-] (see flagSlug), so the returned string
 * contains no user-controllable HTML and is safe to inject via {@html}.
 */
export function flagEmoji(code: string): string {
	const slug = flagSlug(code);
	if (!slug) return '';
	// Fixed 3:2 box + object-fit:cover so every flag renders at the SAME size
	// regardless of its native aspect ratio (otherwise wide flags like Qatar
	// look elongated next to square ones like Switzerland). Sized in em so it
	// scales with the surrounding font-size. draggable=false + pointer-events
	// :none so the image never hijacks the custom team drag-and-drop.
	return `<img src="https://flagcdn.com/h40/${slug}.png" alt="" loading="lazy" decoding="async" draggable="false" style="height:1em;width:1.5em;object-fit:cover;display:inline-block;vertical-align:-0.12em;border-radius:2px;pointer-events:none;">`;
}

export function shortName(name: string): string {
	const MAP: Record<string, string> = {
		'United States': 'USA',
		'South Korea': 'S. Korea',
		'South Africa': 'S. Africa',
		"Ivory Coast": "Côte d'Ivoire",
		'New Zealand': 'N. Zealand',
		'Cape Verde': 'Cape Verde',
		'Czech Republic': 'Czechia',
		'Saudi Arabia': 'S. Arabia',
		'Bosnia and Herzegovina': 'Bosnia',
		'DR Congo': 'DR Congo',
		'North Macedonia': 'N. Macedonia',
	};
	return MAP[name] ?? (name ? name.substring(0, 14) : '');
}
