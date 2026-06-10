// Full tournament simulation (LOCAL ONLY): play all 104 matches through the
// REAL admin results API and verify every entry's points after each stage
// against an INDEPENDENT calculator written from the rules spec (not the
// engine code). Entries: A = perfect, B = designed partial, C = empty.
import pg from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
const BASE = 'http://localhost:5179';
const db = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:5433/worldcup_local' });
await db.connect();
const report = [];
const note = (s, ok, d) => { report.push({ s, ok, d }); console.log(`${ok ? '✓' : '✗ FAIL'} [${s}] ${d}`); };

// ── seed users / pool / entries ───────────────────────────────────────────────
const admin = Number((await db.query(`INSERT INTO users (username,email,display_name,password_hash,email_verified_at,is_admin) VALUES ('simadmin','simadmin@t.l','Sim Admin','$2a$10$abcdefghijklmnopqrstuv',NOW(),true) RETURNING id`)).rows[0].id);
const u2 = Number((await db.query(`INSERT INTO users (username,email,display_name,password_hash,email_verified_at,is_admin) VALUES ('simuser','simuser@t.l','Sim User','$2a$10$abcdefghijklmnopqrstuv',NOW(),false) RETURNING id`)).rows[0].id);
const poolId = Number((await db.query(`INSERT INTO pools (name,invite_code,share_token,created_by,allow_multiple_predictions) VALUES ('Sim Pool','simc0de1',$1,$2,true) RETURNING id`, [randomUUID(), admin])).rows[0].id);
await db.query('INSERT INTO pool_members (pool_id,user_id,has_paid) VALUES ($1,$2,true),($1,$3,true)', [poolId, admin, u2]);
// enable the group-position bonus (2 pts per exact position) on top of defaults
await db.query(`INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1,'group_position',2)`, [poolId]);
const RULES = { match_outcome: 1, group_position: 2, knockout_r32: 2, knockout_r16: 3, knockout_qf: 4, knockout_sf: 6, knockout_final: 6, knockout_winner: 8, third_place: 6 };

const mkEntry = async (uid, label) => Number((await db.query(`INSERT INTO predictions (user_id,pool_id,label,total_score) VALUES ($1,$2,$3,0) RETURNING id`, [uid, poolId, label])).rows[0].id);
const eA = await mkEntry(admin, '');       // perfect
const eB = await mkEntry(admin, 'B');      // partial — same user as A (multi-entry independence)
const eC = await mkEntry(u2, '');          // empty
const token = randomBytes(24).toString('hex');
await db.query('INSERT INTO sessions (user_id,token,expires_at) VALUES ($1,$2,$3)', [admin, token, new Date(Date.now() + 7 * 86400e3).toISOString()]);
const api = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `session=${token}` }, body: JSON.stringify(body) }).then(async r => ({ s: r.status, b: await r.json().catch(() => ({})) }));

// ── tournament plan ───────────────────────────────────────────────────────────
const groups = (await db.query("SELECT DISTINCT group_name g FROM teams WHERE group_name IS NOT NULL ORDER BY g")).rows.map(r => r.g);
const teamsByGroup = {};
for (const g of groups) teamsByGroup[g] = (await db.query('SELECT id FROM teams WHERE group_name=$1 ORDER BY id', [g])).rows.map(r => Number(r.id));
const groupMatches = (await db.query("SELECT id, group_name, home_team_id, away_team_id FROM matches WHERE phase='group' ORDER BY id")).rows
  .map(m => ({ id: Number(m.id), g: m.group_name, h: Number(m.home_team_id), a: Number(m.away_team_id) }));
const koMatches = {};
for (const ph of ['r32', 'r16', 'qf', 'sf', 'final', '3rd']) {
  koMatches[ph] = (await db.query('SELECT id FROM matches WHERE phase=$1 ORDER BY sort_order, id', [ph])).rows.map(r => Number(r.id));
}

// Planned group results: in every group, by seed order t0>t1>t2>t3 (9/6/3/0 pts,
// no standings ties). Result for (h,a): winner by lower seed index, loser 0.
const seedIdx = (g, t) => teamsByGroup[g].indexOf(t);
const plannedGroupResult = (m) => (seedIdx(m.g, m.h) < seedIdx(m.g, m.a) ? { hs: 2, as: 0 } : { hs: 0, as: 2 });

// R32 geometry (mirror of bracket-2026.ts) to build realistic entry brackets.
const R32_MAP = [
  ['E', 1, '?', 3], ['I', 1, '?', 3], ['A', 2, 'B', 2], ['F', 1, 'C', 2],
  ['K', 2, 'L', 2], ['H', 1, 'J', 2], ['D', 1, '?', 3], ['G', 1, '?', 3],
  ['C', 1, 'F', 2], ['E', 2, 'I', 2], ['A', 1, '?', 3], ['L', 1, '?', 3],
  ['J', 1, 'H', 2], ['D', 2, 'G', 2], ['B', 1, '?', 3], ['K', 1, '?', 3],
];
const THIRD_GROUP_MAP = { 0: ['A','B','C','D','F'], 1: ['C','D','F','G','H'], 6: ['B','E','F','I','J'], 7: ['A','E','H','I','J'], 10: ['C','E','F','H','I'], 11: ['E','H','I','J','K'], 14: ['E','F','G','I','J'], 15: ['D','E','I','J','L'] };
const pos = (g, p) => teamsByGroup[g][p - 1]; // standings = seed order by design

// A's r32: direct (t1g,t1p) team advances in every match; wildcard occupants =
// 3rd of the FIRST eligible group, distinct by construction? ensure distinct:
const usedThirds = new Set();
const occupantFor = (mi) => {
  for (const g of THIRD_GROUP_MAP[mi]) { const t = pos(g, 3); if (!usedThirds.has(t)) { usedThirds.add(t); return t; } }
  throw new Error('no occupant');
};
const A_r32 = []; // per match: { adv, occ } — adv stored at slot 2i+1, occ at 2i+2 (wildcards)
for (let i = 0; i < 16; i++) {
  const [g1, p1, g2] = [R32_MAP[i][0], R32_MAP[i][1], R32_MAP[i][2]];
  const adv = pos(g1, p1);
  const occ = g2 === '?' ? occupantFor(i) : null;
  A_r32.push({ adv, occ });
}
// W0 = wildcard match 0: actual winner will be its OCCUPANT (phantom-points test).
const W0 = 0;
const W0_direct = A_r32[W0].adv, W0_occ = A_r32[W0].occ;

// Actual r32 winners: A's advancers, except W0 where the occupant wins.
const actualR32Winners = A_r32.map((x, i) => (i === W0 ? W0_occ : x.adv));
// A's later rounds: winners of adjacent pairs (always the lower match index side).
const A_r16 = [0, 2, 4, 6, 8, 10, 12, 14].map(i => A_r32[i].adv); // note: A predicted W0_direct here
const A_qf = [0, 2, 4, 6].map(i => A_r16[i]);
const A_sf = [0, 2].map(i => A_qf[i]);
const A_final = A_sf[0]; // champion pick
const A_3rd = A_qf[1];   // a semifinal loser candidate — must be an actual 3rd-match winner (we'll make it so)

// Actual knockout winners (sets per phase) — follow A except:
//  - r32: occupant wins W0 (A's r16 pick W0_direct therefore CANNOT win r16…
//    so actual r16 winners use the occupant's path winner instead of W0_direct)
const actualR16Winners = A_r16.map(t => (t === W0_direct ? W0_occ : t));
const actualQFWinners = A_qf.map(t => (t === W0_direct ? W0_occ : t));   // W0_direct isn't in A_qf? it is A_r16[0] -> A_qf[0]! handle
const actualSFWinners = A_sf.map(t => (t === W0_direct ? W0_occ : t));
const actualChampion = A_final === W0_direct ? W0_occ : A_final;
const actualRunnerUp = (() => { const semiWinners = actualSFWinners; return semiWinners.find(t => t !== actualChampion) ?? actualSFWinners[1]; })();
const actual3rdWinner = A_3rd === W0_direct ? W0_occ : A_3rd;

// B's picks: r32 — agrees with A on matches 1..8 (not W0); for W0 advances the
// OCCUPANT (odd slot empty); matches 9..15 picks pos-4 teams (guaranteed losers).
const B_r32 = [];
for (let i = 0; i < 16; i++) {
  if (i === W0) B_r32.push({ adv: null, occ: W0_occ }); // advanced the third
  else if (i <= 8) B_r32.push({ adv: A_r32[i].adv, occ: A_r32[i].occ });
  else B_r32.push({ adv: pos(R32_MAP[i][0], 4), occ: null }); // wrong: 4th-place team
}
// B r16: agrees with A on 4 (indices 1..4 of A_r16 — avoiding A_r16[0]=W0_direct), rest = B's own losers
const B_r16 = A_r16.map((t, i) => (i >= 1 && i <= 4 ? t : pos(groups[i], 4)));
const B_qf = A_qf.map((t, i) => (i >= 1 && i <= 2 ? t : pos(groups[i + 4], 4)));
const B_sf = A_sf.map((t, i) => (i === 1 ? t : pos(groups[9], 4)));
const B_final = actualRunnerUp; // picked the eventual runner-up as champion
const B_3rd = pos(groups[10], 4); // wrong

// ── insert predictions (direct SQL; the save path is already battle-tested) ──
async function insertEntry(pid, { perfect }) {
  // group scorelines: A exact; B right outcome for groups A–F, wrong for G–L
  for (const m of groupMatches) {
    const r = plannedGroupResult(m);
    let hs = r.hs, as = r.as;
    if (!perfect && groups.indexOf(m.g) >= 6) { hs = r.as; as = r.hs; } // reversed outcome
    await db.query('INSERT INTO match_predictions (prediction_id,match_id,home_score,away_score) VALUES ($1,$2,$3,$4)', [pid, m.id, hs, as]);
  }
  // standings: A exact; B swaps pos1/pos2 in groups D–L
  for (const g of groups) {
    const t = teamsByGroup[g];
    let o = [t[0], t[1], t[2], t[3]];
    if (!perfect && groups.indexOf(g) >= 3) o = [t[1], t[0], t[2], t[3]];
    await db.query('INSERT INTO group_predictions (prediction_id,group_name,position_1,position_2,position_3,position_4) VALUES ($1,$2,$3,$4,$5,$6)', [pid, g, o[0], o[1], o[2], o[3]]);
  }
  // bracket
  const r32 = perfect ? A_r32 : B_r32;
  for (let i = 0; i < 16; i++) {
    if (r32[i].adv != null) await db.query('INSERT INTO bracket_predictions (prediction_id,phase,slot,team_id) VALUES ($1,$2,$3,$4)', [pid, 'r32', 2 * i + 1, r32[i].adv]);
    if (r32[i].occ != null) await db.query('INSERT INTO bracket_predictions (prediction_id,phase,slot,team_id) VALUES ($1,$2,$3,$4)', [pid, 'r32', 2 * i + 2, r32[i].occ]);
  }
  const put = async (phase, arr) => { for (let i = 0; i < arr.length; i++) if (arr[i] != null) await db.query('INSERT INTO bracket_predictions (prediction_id,phase,slot,team_id) VALUES ($1,$2,$3,$4)', [pid, phase, i + 1, arr[i]]); };
  await put('r16', perfect ? A_r16 : B_r16);
  await put('qf', perfect ? A_qf : B_qf);
  await put('sf', perfect ? A_sf : B_sf);
  await put('final', [perfect ? A_final : B_final]);
  await put('3rd', [perfect ? A_3rd : B_3rd]);
}
await insertEntry(eA, { perfect: true });
await insertEntry(eB, { perfect: false });
console.log(`seeded pool ${poolId}: A=${eA} B=${eB} C=${eC} | W0 direct=${W0_direct} occ=${W0_occ} champion=${actualChampion} runnerUp=${actualRunnerUp}`);

// ── INDEPENDENT expected calculator (from the rules spec) ────────────────────
const finished = { group: new Map(), ko: new Map() }; // group: matchId -> {h,a,hs,as,g}; ko: matchId -> {phase, winner, finalists?}
function expectedFor(pid, picks) {
  let total = 0;
  // 1) match outcome points (group matches, finished only)
  for (const [mid, r] of finished.group) {
    const p = picks.scores.get(mid);
    if (!p) continue;
    const real = r.hs > r.as ? '1' : r.hs < r.as ? '2' : 'X';
    const mine = p.hs > p.as ? '1' : p.hs < p.as ? '2' : 'X';
    if (real === mine) total += RULES.match_outcome;
  }
  // 2) group position bonus — only for groups with all 6 matches finished
  const finCount = {}; for (const r of finished.group.values()) finCount[r.g] = (finCount[r.g] ?? 0) + 1;
  for (const g of groups) {
    if (finCount[g] !== 6) continue;
    const actual = teamsByGroup[g]; // standings = seed order by construction
    const mine = picks.standings.get(g);
    if (!mine) continue;
    for (let i = 0; i < 4; i++) if (mine[i] === actual[i]) total += RULES.group_position;
  }
  // 3) bracket: set-based winners per phase; occupant-skip; final runner-up rule
  const winners = {}; const finalists = new Set();
  for (const k of finished.ko.values()) {
    (winners[k.phase] ??= new Set()).add(k.winner);
    if (k.phase === 'final') { finalists.add(k.homeTeam); finalists.add(k.awayTeam); }
  }
  for (const bp of picks.bracket) {
    if (bp.phase === 'r32' && bp.slot % 2 === 0 && picks.bracket.some(x => x.phase === 'r32' && x.slot === bp.slot - 1)) continue; // non-advancing occupant
    const w = winners[bp.phase];
    if (w && w.has(bp.team)) {
      total += bp.phase === '3rd' ? RULES.third_place : RULES[`knockout_${bp.phase}`];
      if (bp.phase === 'final') total += RULES.knockout_winner;
    } else if (bp.phase === 'final' && finalists.has(bp.team)) {
      total += RULES.knockout_final;
    }
  }
  return total;
}
async function loadPicks(pid) {
  const scores = new Map((await db.query('SELECT match_id,home_score hs,away_score "as" FROM match_predictions WHERE prediction_id=$1', [pid])).rows.map(r => [Number(r.match_id), { hs: r.hs, as: r.as }]));
  const standings = new Map((await db.query('SELECT group_name g,position_1 a,position_2 b,position_3 c,position_4 d FROM group_predictions WHERE prediction_id=$1', [pid])).rows.map(r => [r.g, [r.a, r.b, r.c, r.d].map(Number)]));
  const bracket = (await db.query('SELECT phase,slot,team_id FROM bracket_predictions WHERE prediction_id=$1 AND team_id IS NOT NULL', [pid])).rows.map(r => ({ phase: r.phase, slot: Number(r.slot), team: Number(r.team_id) }));
  return { scores, standings, bracket };
}
const PICKS = { [eA]: await loadPicks(eA), [eB]: await loadPicks(eB), [eC]: await loadPicks(eC) };
async function verify(stage) {
  const rows = (await db.query('SELECT id,total_score FROM predictions WHERE pool_id=$1 ORDER BY id', [poolId])).rows;
  const got = Object.fromEntries(rows.map(r => [Number(r.id), Number(r.total_score)]));
  const exp = { [eA]: expectedFor(eA, PICKS[eA]), [eB]: expectedFor(eB, PICKS[eB]), [eC]: expectedFor(eC, PICKS[eC]) };
  const ok = got[eA] === exp[eA] && got[eB] === exp[eB] && got[eC] === exp[eC];
  note(stage, ok, `A got=${got[eA]} exp=${exp[eA]} | B got=${got[eB]} exp=${exp[eB]} | C got=${got[eC]} exp=${exp[eC]}`);
  return ok;
}

// ── play the tournament through the REAL admin API ───────────────────────────
async function enterGroupResult(m) {
  const r = plannedGroupResult(m);
  const res = await api('/api/admin/results', { match_id: m.id, home_score: r.hs, away_score: r.as });
  if (res.s !== 200) throw new Error(`result ${m.id} -> ${res.s} ${JSON.stringify(res.b)}`);
  finished.group.set(m.id, { ...r, g: m.g });
}
async function enterKO(phase, matchId, homeTeam, awayTeam, winner, viaPens = false) {
  const body = viaPens
    ? { match_id: matchId, home_score: 1, away_score: 1, penalty_winner_id: winner, home_team_id: homeTeam, away_team_id: awayTeam }
    : { match_id: matchId, home_score: winner === homeTeam ? 2 : 0, away_score: winner === homeTeam ? 0 : 2, home_team_id: homeTeam, away_team_id: awayTeam };
  const res = await api('/api/admin/results', body);
  if (res.s !== 200) throw new Error(`ko ${phase}/${matchId} -> ${res.s} ${JSON.stringify(res.b)}`);
  finished.ko.set(matchId, { phase, winner, homeTeam, awayTeam });
}

// S1: first 3 matches of group A only
console.log('\n— S1: 3 matches of group A —');
for (const m of groupMatches.filter(x => x.g === 'A').slice(0, 3)) await enterGroupResult(m);
await verify('S1-partial-group');

// S2: rest of the group stage
console.log('— S2: all 72 group matches —');
for (const m of groupMatches) if (!finished.group.has(m.id)) await enterGroupResult(m);
await verify('S2-groups-complete');

// S3: r32 — winner per planned set; one match decided on penalties; W0 = occupant wins
console.log('— S3: round of 32 —');
{
  const losers = groups.map(g => pos(g, 4)); // 12 guaranteed non-winners as opponents
  let li = 0;
  for (let i = 0; i < 16; i++) {
    const winner = actualR32Winners[i];
    const opponent = i === W0 ? W0_direct : (losers[li++ % losers.length] !== winner ? losers[(li - 1) % losers.length] : losers[li++ % losers.length]);
    await enterKO('r32', koMatches.r32[i], winner, opponent, winner, i === 3 /* one penalty shootout */);
  }
}
await verify('S3-r32');

// S4: r16 + qf with a correction: enter qf match 0 with the WRONG winner first
console.log('— S4: r16 + qf (with a result correction) —');
{
  const r16Pairs = actualR16Winners.map((w, i) => [w, actualR32Winners.find(t => t !== w && !actualR16Winners.includes(t)) ?? actualR32Winners[(i + 5) % 16]]);
  for (let i = 0; i < 8; i++) await enterKO('r16', koMatches.r16[i], actualR16Winners[i], r16Pairs[i][1], actualR16Winners[i]);
  // wrong result first on qf[0]: opponent wins
  const opp0 = actualR16Winners.find(t => t !== actualQFWinners[0]);
  await enterKO('qf', koMatches.qf[0], actualQFWinners[0], opp0, opp0);
  for (let i = 1; i < 4; i++) {
    const opp = actualR16Winners.find(t => t !== actualQFWinners[i] && t !== opp0) ?? actualR16Winners[7];
    await enterKO('qf', koMatches.qf[i], actualQFWinners[i], opp, actualQFWinners[i]);
  }
  await verify('S4a-qf-with-wrong-result');
  // CORRECTION: re-enter qf[0] with the right winner
  await enterKO('qf', koMatches.qf[0], actualQFWinners[0], opp0, actualQFWinners[0]);
  await verify('S4b-after-correction');
}

// S5: sf, 3rd, final (champion on penalties)
console.log('— S5: sf + 3rd + final —');
{
  const sfLosers = [];
  for (let i = 0; i < 2; i++) {
    const opp = actualQFWinners.find(t => t !== actualSFWinners[0] && t !== actualSFWinners[1] && !sfLosers.includes(t));
    sfLosers.push(opp);
    await enterKO('sf', koMatches.sf[i], actualSFWinners[i], opp, actualSFWinners[i]);
  }
  await enterKO('3rd', koMatches['3rd'][0], actual3rdWinner === sfLosers[0] ? sfLosers[0] : actual3rdWinner, actual3rdWinner === sfLosers[0] ? sfLosers[1] : (sfLosers.find(t => t !== actual3rdWinner) ?? sfLosers[1]), actual3rdWinner);
  await enterKO('final', koMatches.final[0], actualChampion, actualRunnerUp, actualChampion, true /* penalties! */);
}
await verify('S5-final');

// S6: idempotency — re-enter an identical result; totals must not move
console.log('— S6: idempotency + revert —');
{
  const before = (await db.query('SELECT id,total_score FROM predictions WHERE pool_id=$1 ORDER BY id', [poolId])).rows.map(r => `${r.id}:${r.total_score}`).join(',');
  const m = groupMatches[0]; await enterGroupResult(m);
  const after = (await db.query('SELECT id,total_score FROM predictions WHERE pool_id=$1 ORDER BY id', [poolId])).rows.map(r => `${r.id}:${r.total_score}`).join(',');
  note('S6a-idempotent', before === after, before === after ? 'identical totals after re-entering same result' : `before=${before} after=${after}`);
  // revert: un-finish one group-A match -> group A bonus must vanish + 1 outcome pt each
  await db.query("UPDATE matches SET status='scheduled', home_score=NULL, away_score=NULL WHERE id=$1", [groupMatches[0].id]);
  finished.group.delete(groupMatches[0].id);
  const m2 = groupMatches[1]; await enterGroupResult(m2); // trigger rescore via real path
  await verify('S6b-after-revert');
  // restore
  await enterGroupResult(groupMatches[0]);
  await verify('S6c-restored');
}

// S7: leaderboard order via the pool page data (A > B > C)
{
  const rows = (await db.query('SELECT id,total_score FROM predictions WHERE pool_id=$1 ORDER BY total_score DESC', [poolId])).rows.map(r => Number(r.id));
  note('S7-leaderboard', rows[0] === eA && rows[1] === eB && rows[2] === eC, `order=${rows.join('>')}`);
}

await db.end();
console.log('\n================ SUMMARY ================');
const fails = report.filter(r => !r.ok);
console.log(`${report.length} checks, ${fails.length} FAILED`);
for (const f of fails) console.log('  ✗', f.s, '—', f.d);
