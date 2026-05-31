/**
 * Canonical team-name normalization, shared by the alias seeder and the
 * live-score sync. Lowercases, strips diacritics, drops punctuation, and
 * collapses whitespace so "Côte d'Ivoire", "Cote d Ivoire" and "cote d'ivoire"
 * all map to the same key.
 */
export function normalizeTeamName(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')     // punctuation → space
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Known external names (API-Football / FIFA) that differ from our seeded team
 * names → our canonical team name. Seeded into `team_aliases` so the sync can
 * resolve them. Extend as you spot unmatched names in the sync logs.
 */
export const TEAM_ALIASES: Record<string, string[]> = {
  'Czech Republic': ['Czechia'],
  'South Korea': ['Korea Republic', 'Republic of Korea', 'Korea South'],
  'United States': ['USA', 'United States of America'],
  'Ivory Coast': ["Côte d'Ivoire", "Cote d'Ivoire"],
  'DR Congo': ['Congo DR', 'Democratic Republic of the Congo', 'DR Congo', 'Congo-Kinshasa'],
  'Curaçao': ['Curacao'],
  'Cape Verde': ['Cabo Verde'],
  'Bosnia and Herzegovina': ['Bosnia', 'Bosnia & Herzegovina', 'Bosnia-Herzegovina'],
  'Turkey': ['Türkiye', 'Turkiye'],
  'Iran': ['IR Iran', 'Iran Islamic Republic'],
  'United Arab Emirates': ['UAE'],
};
