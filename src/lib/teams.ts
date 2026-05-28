export function flagEmoji(code: string): string {
	if (!code) return '';
	if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
	if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
	if (code.length !== 2) {
		console.warn('[flagEmoji] unknown flag code:', code);
		return '🏳️';
	}
	return code
		.toUpperCase()
		.split('')
		.map(c => String.fromCodePoint(c.codePointAt(0)! + 127397))
		.join('');
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
