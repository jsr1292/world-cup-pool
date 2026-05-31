import './load-env.js';
import { query, getClient } from './db.js';
import { normalizeTeamName, TEAM_ALIASES } from './team-normalize.js';

// 48 confirmed qualified teams for FIFA World Cup 2026.
// Groups based on December 5, 2025 FIFA draw.
//
// §3.10 — Ranks last verified: 2026-04. FIFA publishes ranking refreshes
// monthly; values here may differ from the official pre-tournament ranking.
// Two teams currently share rank 48 (Ivory Coast, Qatar) — this is a known
// duplicate, not a typo. Refresh before kickoff by re-running
// `npm run seed` (the script is idempotent: it upserts by team name).
const teams = [
  // Group A (FIFA official draw)
  { name: 'Czech Republic', flag_code: 'CZ', group_name: 'A', fifa_rank: 44 },
  { name: 'Mexico', flag_code: 'MX', group_name: 'A', fifa_rank: 15 },
  { name: 'South Africa', flag_code: 'ZA', group_name: 'A', fifa_rank: 55 },
  { name: 'South Korea', flag_code: 'KR', group_name: 'A', fifa_rank: 22 },

  // Group B
  { name: 'Bosnia and Herzegovina', flag_code: 'BA', group_name: 'B', fifa_rank: 62 },
  { name: 'Canada', flag_code: 'CA', group_name: 'B', fifa_rank: 27 },
  { name: 'Qatar', flag_code: 'QA', group_name: 'B', fifa_rank: 48 },
  { name: 'Switzerland', flag_code: 'CH', group_name: 'B', fifa_rank: 17 },

  // Group C
  { name: 'Brazil', flag_code: 'BR', group_name: 'C', fifa_rank: 5 },
  { name: 'Haiti', flag_code: 'HT', group_name: 'C', fifa_rank: 59 },
  { name: 'Morocco', flag_code: 'MA', group_name: 'C', fifa_rank: 11 },
  { name: 'Scotland', flag_code: 'SCT', group_name: 'C', fifa_rank: 36 },

  // Group D
  { name: 'Australia', flag_code: 'AU', group_name: 'D', fifa_rank: 26 },
  { name: 'Paraguay', flag_code: 'PY', group_name: 'D', fifa_rank: 46 },
  { name: 'Turkey', flag_code: 'TR', group_name: 'D', fifa_rank: 42 },
  { name: 'United States', flag_code: 'US', group_name: 'D', fifa_rank: 14 },

  // Group E
  { name: 'Curaçao', flag_code: 'CW', group_name: 'E', fifa_rank: 66 },
  { name: 'Ecuador', flag_code: 'EC', group_name: 'E', fifa_rank: 23 },
  { name: 'Germany', flag_code: 'DE', group_name: 'E', fifa_rank: 9 },
  { name: 'Ivory Coast', flag_code: 'CI', group_name: 'E', fifa_rank: 48 },

  // Group F
  { name: 'Japan', flag_code: 'JP', group_name: 'F', fifa_rank: 18 },
  { name: 'Netherlands', flag_code: 'NL', group_name: 'F', fifa_rank: 7 },
  { name: 'Sweden', flag_code: 'SE', group_name: 'F', fifa_rank: 38 },
  { name: 'Tunisia', flag_code: 'TN', group_name: 'F', fifa_rank: 65 },

  // Group G
  { name: 'Belgium', flag_code: 'BE', group_name: 'G', fifa_rank: 8 },
  { name: 'Egypt', flag_code: 'EG', group_name: 'G', fifa_rank: 34 },
  { name: 'Iran', flag_code: 'IR', group_name: 'G', fifa_rank: 20 },
  { name: 'New Zealand', flag_code: 'NZ', group_name: 'G', fifa_rank: 85 },

  // Group H
  { name: 'Cape Verde', flag_code: 'CV', group_name: 'H', fifa_rank: 72 },
  { name: 'Saudi Arabia', flag_code: 'SA', group_name: 'H', fifa_rank: 53 },
  { name: 'Spain', flag_code: 'ES', group_name: 'H', fifa_rank: 1 },
  { name: 'Uruguay', flag_code: 'UY', group_name: 'H', fifa_rank: 16 },

  // Group I
  { name: 'France', flag_code: 'FR', group_name: 'I', fifa_rank: 3 },
  { name: 'Iraq', flag_code: 'IQ', group_name: 'I', fifa_rank: 67 },
  { name: 'Norway', flag_code: 'NO', group_name: 'I', fifa_rank: 29 },
  { name: 'Senegal', flag_code: 'SN', group_name: 'I', fifa_rank: 19 },

  // Group J
  { name: 'Algeria', flag_code: 'DZ', group_name: 'J', fifa_rank: 35 },
  { name: 'Argentina', flag_code: 'AR', group_name: 'J', fifa_rank: 2 },
  { name: 'Austria', flag_code: 'AT', group_name: 'J', fifa_rank: 24 },
  { name: 'Jordan', flag_code: 'JO', group_name: 'J', fifa_rank: 63 },

  // Group K
  { name: 'Colombia', flag_code: 'CO', group_name: 'K', fifa_rank: 13 },
  { name: 'DR Congo', flag_code: 'CD', group_name: 'K', fifa_rank: 57 },
  { name: 'Portugal', flag_code: 'PT', group_name: 'K', fifa_rank: 6 },
  { name: 'Uzbekistan', flag_code: 'UZ', group_name: 'K', fifa_rank: 64 },

  // Group L
  { name: 'Croatia', flag_code: 'HR', group_name: 'L', fifa_rank: 10 },
  { name: 'England', flag_code: 'ENG', group_name: 'L', fifa_rank: 4 },
  { name: 'Ghana', flag_code: 'GH', group_name: 'L', fifa_rank: 49 },
  { name: 'Panama', flag_code: 'PA', group_name: 'L', fifa_rank: 30 },
];

// Verify count
if (teams.length !== 48) {
  throw new Error(`Expected 48 teams, got ${teams.length}`);
}

// Verify each group has exactly 4 teams
const groups: Record<string, number> = {};
for (const t of teams) {
  groups[t.group_name] = (groups[t.group_name] || 0) + 1;
}
for (const [g, c] of Object.entries(groups)) {
  if (c !== 4) throw new Error(`Group ${g} has ${c} teams, expected 4`);
}

const insertSql = `
  INSERT INTO teams (name, flag_code, group_name, fifa_rank)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (name) DO UPDATE SET
    flag_code  = EXCLUDED.flag_code,
    group_name = EXCLUDED.group_name,
    fifa_rank  = EXCLUDED.fifa_rank
`;

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const row of teams) {
      await client.query(insertSql, [row.name, row.flag_code, row.group_name, row.fifa_rank]);
    }

    // Seed team_aliases so the live-score sync can resolve external (API-Football
    // / FIFA) team names that differ from ours. Idempotent: upsert by alias.
    for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
      const { rows: tr } = await client.query('SELECT id FROM teams WHERE name = $1', [canonical]);
      if (tr.length === 0) continue; // alias for a team not in this seed — skip
      const teamId = tr[0].id;
      for (const alias of aliases) {
        const norm = normalizeTeamName(alias);
        if (!norm) continue;
        await client.query(
          `INSERT INTO team_aliases (team_id, alias_normalized, source)
           VALUES ($1, $2, 'seed')
           ON CONFLICT (alias_normalized) DO UPDATE SET team_id = EXCLUDED.team_id`,
          [teamId, norm]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await query('SELECT COUNT(*) as c FROM teams') as { rows: { c: number }[] };
  console.log(`✓ Seeded ${result.rows[0].c} teams in ${Object.keys(groups).length} groups`);
}

// §4.10 — Be explicit about both success and failure exit codes so CI/CD
// reliably distinguishes them.
if (import.meta.url === `file://${process.argv[1]}`) {
seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
