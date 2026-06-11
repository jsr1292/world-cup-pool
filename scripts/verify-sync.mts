// Live verification of the FIFA auto-sync (LOCAL scratch DB with prod-copied data).
// NOTE: assumes a FRESH scratch restore — re-running against an already-ingested
// DB makes check 3 report updated=0 (the row is already correct).
import process from 'node:process';
// 1) Resolve ALL 48 real FIFA team names against teams+aliases.
// 2) Run the real syncScores(): the in-play match must be skipped, nothing written.
// 3) Re-run with the live match shimmed to "finished": it must ingest onto the
//    right fixture row with our home/away orientation preserved.
process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/sync_drill';
import { query } from '../src/lib/server/db.js';
import { normalizeTeamName } from '../src/lib/server/team-normalize.js';
import { syncScores } from '../src/lib/server/live-scores.js';

const note = (s: string, ok: boolean, d: string) => console.log(`${ok ? '✓' : '✗ FAIL'} [${s}] ${d}`);
const calRes = await fetch('https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=500&language=en', { headers: { Accept: 'application/json' } });
const cal = await calRes.json();

// 1) name coverage
{
  const { rows } = await query(`SELECT id, name AS canon FROM teams UNION ALL SELECT team_id, alias_normalized FROM team_aliases`);
  const resolver = new Map(rows.map((r: any) => [normalizeTeamName(r.canon), r.id]));
  const names = new Set<string>();
  for (const m of cal.Results) {
    const h = m.Home?.TeamName?.[0]?.Description, a = m.Away?.TeamName?.[0]?.Description;
    if (h) names.add(h); if (a) names.add(a);
  }
  const unmatched = [...names].filter((n) => !resolver.has(normalizeTeamName(n)));
  note('name-coverage', unmatched.length === 0, `${names.size - unmatched.length}/${names.size} FIFA names resolve${unmatched.length ? ' — MISSING: ' + unmatched.join(', ') : ''}`);
}

// 2) real syncScores: live match skipped, no writes
{
  const before = (await query("SELECT COUNT(*)::int c FROM matches WHERE status='finished'")).rows[0].c;
  const r = await syncScores();
  const after = (await query("SELECT COUNT(*)::int c FROM matches WHERE status='finished'")).rows[0].c;
  note('live-skipped', r.updated === 0 && r.errors === 0 && before === after && r.unmatched.length === 0,
    `updated=${r.updated} skipped=${r.skipped} errors=${r.errors} unmatched=[${r.unmatched.join(',')}] finished ${before}->${after}`);
}

// 3) shim the live match to finished → must ingest correctly
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const res = await realFetch(url, init);
    if (String(url).includes('api.fifa.com')) {
      const body = JSON.parse(JSON.stringify(cal));
      for (const m of body.Results) {
        if (m.MatchStatus === 3) { m.MatchStatus = 0; } // pretend the live match just ended
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return res;
  }) as any;

  const r = await syncScores();
  globalThis.fetch = realFetch;

  const { rows } = await query(`
    SELECT m.home_score, m.away_score, m.status, m.fifa_id, m.group_name,
           ht.name AS home, at.name AS away
    FROM matches m JOIN teams ht ON ht.id=m.home_team_id JOIN teams at ON at.id=m.away_team_id
    WHERE m.status='finished'`);
  const m = rows[0];
  const ok = r.updated === 1 && r.errors === 0 && rows.length === 1 &&
    ((m.home === 'Mexico' && m.home_score === 1 && m.away === 'South Africa' && m.away_score === 0) ||
     (m.home === 'South Africa' && m.home_score === 0 && m.away === 'Mexico' && m.away_score === 1));
  note('ingest-on-finish', ok,
    `updated=${r.updated} → ${m?.home} ${m?.home_score}-${m?.away_score} ${m?.away} (group ${m?.group_name}, fifa_id=${m?.fifa_id}, orientation preserved from our fixture row)`);

  // idempotency: second run with same shim → unchanged, no extra writes
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).includes('api.fifa.com')) {
      const body = JSON.parse(JSON.stringify(cal));
      for (const mm of body.Results) if (mm.MatchStatus === 3) mm.MatchStatus = 0;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return realFetch(url, init);
  }) as any;
  const r2 = await syncScores();
  globalThis.fetch = realFetch;
  note('resync-idempotent', r2.updated === 0 && r2.errors === 0, `second run: updated=${r2.updated} skipped=${r2.skipped} (no-op as designed)`);
}
process.exit(0);
