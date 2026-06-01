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

// Spanish display names for the teams, keyed by the English name stored in the
// DB (team.name). Kept reasonably short so they fit the compact group/bracket
// cards. This is display-only — the stored English name still drives schedule
// matching and all name-based logic, so changing these never affects scoring.
const ES_NAME: Record<string, string> = {
	'Czech Republic': 'Chequia',
	'Mexico': 'México',
	'South Africa': 'Sudáfrica',
	'South Korea': 'Corea del Sur',
	'Bosnia and Herzegovina': 'Bosnia',
	'Canada': 'Canadá',
	'Qatar': 'Catar',
	'Switzerland': 'Suiza',
	'Brazil': 'Brasil',
	'Haiti': 'Haití',
	'Morocco': 'Marruecos',
	'Scotland': 'Escocia',
	'Australia': 'Australia',
	'Paraguay': 'Paraguay',
	'Turkey': 'Turquía',
	'United States': 'EE. UU.',
	'Curaçao': 'Curazao',
	'Ecuador': 'Ecuador',
	'Germany': 'Alemania',
	'Ivory Coast': 'C. de Marfil',
	'Japan': 'Japón',
	'Netherlands': 'P. Bajos',
	'Sweden': 'Suecia',
	'Tunisia': 'Túnez',
	'Belgium': 'Bélgica',
	'Egypt': 'Egipto',
	'Iran': 'Irán',
	'New Zealand': 'N. Zelanda',
	'Cape Verde': 'Cabo Verde',
	'Saudi Arabia': 'Arabia Saudí',
	'Spain': 'España',
	'Uruguay': 'Uruguay',
	'France': 'Francia',
	'Iraq': 'Irak',
	'Norway': 'Noruega',
	'Senegal': 'Senegal',
	'Algeria': 'Argelia',
	'Argentina': 'Argentina',
	'Austria': 'Austria',
	'Jordan': 'Jordania',
	'Colombia': 'Colombia',
	'DR Congo': 'RD Congo',
	'Portugal': 'Portugal',
	'Uzbekistan': 'Uzbekistán',
	'Croatia': 'Croacia',
	'England': 'Inglaterra',
	'Ghana': 'Ghana',
	'Panama': 'Panamá',
};

/** Spanish display name for a team (falls back to the given name). */
export function shortName(name: string): string {
	return ES_NAME[name] ?? (name ? name.substring(0, 14) : '');
}
