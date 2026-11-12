'use strict';

// 괴물 서바이벌 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const evs = (st, t) => st.events.filter((e) => e.t === t);
const run = (st, secs, inp = {}) => { for (let i = 0; i < Math.round(secs * 60) && st.phase === 'play'; i++) L.step(st, 1 / 60, inp); return st; };
const fresh = (opts = {}) => { const st = L.newGame(L.rng(opts.seed || 1), opts); st.spawnT = 1e9; return st; };       // 저절로 나오는 괴물은 끄고 시작
const mk = (st, type, x, y) => { const e = L.spawnEnemy(st, type, x, y); return e; };
const open = (st) => { if (st.phase === 'levelup') L.choose(st, 0); };

test('the player moves at a fixed speed in any direction (diagonals are not faster) and stands still without input', () => {
  const st = fresh(); run(st, 1, { dx: 1, dy: 0 });
  assert.ok(Math.abs(st.p.x - L.PLAYER.speed) < 1, 'speed ' + st.p.x);
  const d = fresh(); run(d, 1, { dx: 1, dy: 1 });
  assert.ok(Math.abs(Math.hypot(d.p.x, d.p.y) - L.PLAYER.speed) < 1, 'diagonal speed ' + Math.hypot(d.p.x, d.p.y));
  const s = fresh(); run(s, 1, {}); assert.strictEqual(s.p.x, 0);
  const half = fresh(); run(half, 1, { dx: 0.5, dy: 0 }); assert.ok(Math.abs(half.p.x - L.PLAYER.speed / 2) < 1, 'a half push is half speed');
  const mv = fresh(); const ev = []; for (let i = 0; i < 120; i++) { L.step(mv, 1 / 60, { dx: 1, dy: 0 }); ev.push(...evs(mv, 'move')); } assert.strictEqual(ev.length, 1, 'move signal once');
});

test('monsters chase the player, stay apart from each other, and hurt on touch with a moment of safety after a hit', () => {
  const st = fresh(); const e = mk(st, 'zombie', 80, 0); const d0 = e.x;
  run(st, 1, {}); assert.ok(e.x < d0 && e.speed > 0, 'moved toward the player');
  const t = fresh(); mk(t, 'zombie', 3, 0); L.step(t, 1 / 60, {});
  assert.ok(t.p.hp < t.p.maxhp, 'touching hurts'); const hp = t.p.hp; L.step(t, 1 / 60, {}); assert.ok(t.p.hp >= hp, 'no second hit while invincible');
  assert.ok(t.p.invuln > 0.3);
  const c = fresh(); for (let i = 0; i < 12; i++) mk(c, 'zombie', 90 + (i % 3), 90 + (i % 4)); run(c, 0.2, {});
  let minD = 1e9; for (let i = 0; i < c.enemies.length; i++) for (let j = i + 1; j < c.enemies.length; j++) minD = Math.min(minD, Math.hypot(c.enemies[i].x - c.enemies[j].x, c.enemies[i].y - c.enemies[j].y));
  assert.ok(minD > 2, 'pushed apart (' + minD.toFixed(1) + ')');
});

test('the magic bolt flies at the nearest monster, kills it and drops a gem; more levels fire more bolts', () => {
  const st = fresh(); const near = mk(st, 'bat', 40, 0), far = mk(st, 'bat', 120, 10); near.speed = far.speed = 0;
  st.cd.bolt = 0; L.step(st, 1 / 60, {});
  assert.strictEqual(st.shots.length, 1); assert.ok(st.shots[0].vx > 0 && Math.abs(st.shots[0].vy) < 5, 'aimed at the near one');
  run(st, 1, {});
  assert.ok(near.hp <= 0 || !st.enemies.includes(near), 'the near bat died'); assert.ok(st.kills >= 1); assert.ok(st.gems.length >= 1 || st.p.xp >= 1);
  const l3 = fresh(); l3.weapons.bolt = 3; for (let i = 0; i < 3; i++) { const e = mk(l3, 'zombie', 40 + i * 30, 20 * (i - 1)); e.speed = 0; } l3.cd.bolt = 0; L.step(l3, 1 / 60, {});
  assert.strictEqual(l3.shots.length, 2, 'level three fires two bolts'); const l4 = fresh(); l4.weapons.bolt = 4; for (let i = 0; i < 3; i++) { const e = mk(l4, 'zombie', 40 + i * 30, 20 * (i - 1)); e.speed = 0; } l4.cd.bolt = 0; L.step(l4, 1 / 60, {});
  assert.strictEqual(l4.shots.length, 3, 'level four fires three');
  const p5 = fresh(); p5.weapons.bolt = 5; const a = mk(p5, 'zombie', 40, 0), b = mk(p5, 'zombie', 55, 0); a.speed = b.speed = 0; a.hp = b.hp = 5; p5.cd.bolt = 0; L.step(p5, 1 / 60, {}); run(p5, 0.8, {});
  assert.ok(p5.kills >= 2, 'a piercing bolt kills both in a line (' + p5.kills + ')');
});

test('blades orbit the player and hit monsters they sweep through, but not more often than every 0.4 seconds', () => {
  const st = fresh(); st.weapons.bolt = 0; st.weapons.blades = 1; const e = mk(st, 'ogre', 32, 0); e.speed = 0; e.hp = e.maxhp = 1000;
  run(st, 0.05, {});
  assert.strictEqual(st.bladePos.length, 2, 'two blades');
  const a0 = st.bladeAngle; run(st, 0.5, {}); assert.ok(st.bladeAngle > a0 + 1, 'they spin');
  const hits = 1000 - e.hp; assert.ok(hits > 0, 'the ogre was hit');
  let r = 0; for (const [bx, by] of st.bladePos) r = Math.hypot(bx - st.p.x, by - st.p.y); assert.ok(Math.abs(r - L.WEAPONS.blades.radius[0]) < 0.5, 'blades keep their distance');
  const tick = fresh(); tick.weapons.bolt = 0; tick.weapons.blades = 2; const t2 = mk(tick, 'ogre', 34, 0); t2.speed = 0; t2.hp = t2.maxhp = 1e6; run(tick, 2, {});
  const per = (1e6 - t2.hp) / 6; assert.ok(per <= 2 / 0.4 + 1, 'hit rate is limited (' + per.toFixed(1) + ' hits in 2s)');
});

test('lightning strikes random monsters on screen, a fire patch burns what stands in it over time, an axe goes up and over and passes through', () => {
  const st = fresh(); st.weapons.bolt = 0; st.weapons.lightning = 2; for (let i = 0; i < 5; i++) { const e = mk(st, 'zombie', 40 + i * 15, 30); e.speed = 0; e.hp = e.maxhp = 200; } st.cd.lightning = 0; L.step(st, 1 / 60, {});
  assert.strictEqual(st.kills, 0); assert.ok(st.enemies.filter((e) => e.hp < e.maxhp).length === 2, 'two struck'); assert.ok(evs(st, 'thunder').length === 1);
  const off = fresh(); off.weapons.bolt = 0; off.weapons.lightning = 1; const far = mk(off, 'zombie', 400, 0); far.speed = 0; off.cd.lightning = 0; L.step(off, 1 / 60, {}); assert.strictEqual(far.hp, far.maxhp, 'not on screen: not struck');
  const f = fresh(); f.weapons.bolt = 0; f.weapons.fire = 1; const t = mk(f, 'ogre', 60, 0); t.speed = 0; t.hp = t.maxhp = 500; f.cd.fire = 0; L.step(f, 1 / 60, {}); assert.strictEqual(f.zones.length, 1);
  run(f, 2, {}); const burned = 500 - t.hp; assert.ok(burned > 10, 'burning (' + burned.toFixed(0) + ')');
  f.cd.fire = 1e9; run(f, 3.5, {}); assert.strictEqual(f.zones.length, 0, 'the fire goes out');
  const ax = fresh(); ax.weapons.bolt = 0; ax.weapons.axe = 1; ax.cd.axe = 0; const e1 = mk(ax, 'zombie', 25, -20), e2 = mk(ax, 'zombie', 25, 60); e1.speed = e2.speed = 0; e1.hp = e1.maxhp = e2.hp = e2.maxhp = 400;
  L.step(ax, 1 / 60, {}); assert.strictEqual(ax.shots.length, 1); const s = ax.shots[0]; assert.ok(s.vy < 0, 'thrown upward'); let top = 0, ydown = false;
  for (let i = 0; i < 150; i++) { L.step(ax, 1 / 60, {}); if (ax.shots[0]) { top = Math.min(top, ax.shots[0].y); if (ax.shots[0].vy > 0) ydown = true; } }
  assert.ok(top < -20 && ydown, 'goes up then comes down');
});

test('gems are pulled in from a distance, experience fills the bar, and a level up asks for a choice of three different things', () => {
  const st = fresh(); st.gems.push({ id: 900, x: 20, y: 0, xp: 2, fly: 0 }); run(st, 1, {});
  assert.strictEqual(st.gems.length, 0); assert.ok(st.p.xp >= 2, 'collected');
  const far = fresh(); far.gems.push({ id: 901, x: 100, y: 0, xp: 2, fly: 0 }); run(far, 0.5, {}); assert.strictEqual(far.gems.length, 1, 'out of reach stays');
  const m = fresh(); m.passives.magnet = 5; m.gems.push({ id: 902, x: 70, y: 0, xp: 2, fly: 0 }); run(m, 1, {}); assert.strictEqual(m.gems.length, 0, 'the magnet reaches farther');
  const lv = fresh(); lv.p.xp = lv.p.need - 1; L.addXp(lv, 1);
  assert.strictEqual(lv.phase, 'levelup'); assert.strictEqual(lv.choices.length, 3); assert.strictEqual(new Set(lv.choices.map((c) => c.key)).size, 3, 'three different choices'); assert.strictEqual(lv.p.level, 2);
  L.step(lv, 1 / 60, { dx: 1 }); assert.strictEqual(lv.p.x, 0, 'the game waits during the choice');
  const w = fresh(); w.p.xp = w.p.need - 1; L.addXp(w, 1); const i = w.choices.findIndex((c) => c.kind === 'weapon'); const key = i >= 0 ? w.choices[i].key : null;
  L.choose(w, i >= 0 ? i : 0); assert.strictEqual(w.phase, 'play'); if (key) assert.ok(w.weapons[key] >= 1);
  const bad = fresh(); assert.strictEqual(L.choose(bad, 0), false, 'cannot choose when nothing is offered');
});

test('weapons and abilities stop at level five, passives change the numbers, and a full set offers healing instead', () => {
  const st = fresh(); for (const k of Object.keys(st.weapons)) st.weapons[k] = 5; for (const k of Object.keys(st.passives)) st.passives[k] = 5;
  const c = L.makeChoices(st); assert.ok(c.every((x) => x.kind === 'heal'), 'only healing when everything is maxed');
  st.p.hp = 10; st.p.xp = st.p.need - 1; L.addXp(st, 1); L.choose(st, 0); assert.ok(st.p.hp > 40, 'healed');
  const p = fresh(); p.passives.power = 2; assert.ok(Math.abs(L.dmgMul(p) - 1.3) < 1e-9); p.passives.haste = 5; assert.ok(Math.abs(L.cdMul(p) - 0.6) < 1e-9); p.passives.speed = 5; assert.ok(Math.abs(L.speedMul(p) - 1.4) < 1e-9);
  const v = fresh(); v.p.xp = v.p.need - 1; L.addXp(v, 1); v.choices = [{ kind: 'passive', key: 'vitality', level: 1 }, v.choices[1], v.choices[2]]; const mh = v.p.maxhp; L.choose(v, 0); assert.strictEqual(v.p.maxhp, mh + 20);
  const two = fresh(); two.p.xp = two.p.need * 2 + 20; L.addXp(two, 0); assert.ok(two.pending >= 2); L.choose(two, 0); assert.strictEqual(two.phase, 'levelup', 'a second level up is offered right after');
});

test('monsters come from just outside the screen, faster as time goes on, with new kinds over time, and swarms at 2, 4 and 6 minutes', () => {
  const st = L.newGame(L.rng(3)); st.p.invuln = 1e9; let inside = 0, total = 0;
  for (let i = 0; i < 60 * 20; i++) { const n = st.enemies.length; L.step(st, 1 / 60, {}); for (let k = n; k < st.enemies.length; k++) { total++; const e = st.enemies[k]; if (Math.abs(e.x) < L.VW / 2 && Math.abs(e.y) < L.VH / 2) inside++; } }
  assert.ok(total >= 10, 'monsters appear'); assert.strictEqual(inside, 0, 'never inside the screen');
  const rate = (t0) => { const s = L.newGame(L.rng(3)); s.t = t0; s.p.invuln = 1e9; s.p.hp = 1e9; let n = 0; for (let i = 0; i < 60 * 10; i++) { const b = s.enemies.length; s.enemies.forEach((e) => { e.hp = 0; }); s.enemies = []; L.step(s, 1 / 60, {}); n += s.enemies.length; if (b < 0) break; } return n; };
  assert.ok(rate(300) > rate(0) * 1.4, 'faster later');
  const kinds = (t0) => { const s = L.newGame(L.rng(5)); s.t = t0; s.p.invuln = 1e9; const set = new Set(); for (let i = 0; i < 60 * 15; i++) { s.enemies = []; L.step(s, 1 / 60, {}); s.enemies.forEach((e) => set.add(e.type)); } return set; };
  assert.ok(!kinds(5).has('ogre') && !kinds(5).has('skeleton'), 'early: only bats and zombies'); assert.ok(kinds(200).has('ogre') || kinds(300).has('ogre'), 'ogres later');
  const sw = L.newGame(L.rng(1)); sw.p.invuln = 1e9; sw.t = 119.9; const before = sw.enemies.length; for (let i = 0; i < 20; i++) L.step(sw, 1 / 60, {});
  assert.ok(sw.enemies.length >= before + 20, 'a swarm at two minutes (' + sw.enemies.length + ')');
  const far = L.newGame(L.rng(1)); far.spawnT = 1e9; const e = mk(far, 'zombie', 2000, 0); L.step(far, 1 / 60, {}); assert.ok(Math.hypot(e.x, e.y) < 400, 'a monster that fell far behind is brought back');
});

test('the boss comes at eight minutes with its own health, calls bats, and killing it wins the game and adds to the score', () => {
  const st = L.newGame(L.rng(2)); st.p.invuln = 1e9; st.t = L.BOSS_AT - 0.05; run(st, 0.5, {});
  assert.ok(st.boss && st.bossSpawned); assert.strictEqual(st.boss.hp, L.DIFF.normal.boss); assert.strictEqual(L.DIFF.easy.boss < L.DIFF.normal.boss, true);
  const n0 = st.enemies.length; run(st, 4.5, {}); assert.ok(st.enemies.filter((e) => e.type === 'bat').length > 0 && st.enemies.length > n0 - 5, 'it calls bats');
  const score0 = st.score; L.damage(st, st.boss, 99999, 0);
  assert.strictEqual(st.phase, 'winning'); for (let i = 0; i < 200 && st.phase !== 'win'; i++) L.step(st, 1 / 60, {});
  assert.strictEqual(st.phase, 'win'); assert.ok(st.won); assert.ok(st.score >= score0 + 3000);
  assert.strictEqual(st.enemies.filter((e) => e.hp > 0).length, 0, 'everything else vanishes');
});

test('dying ends the game, the tutorial never kills, and easy mode is gentler than normal', () => {
  const st = fresh(); st.p.hp = 1; mk(st, 'ogre', 2, 0); L.step(st, 1 / 60, {}); assert.strictEqual(st.phase, 'dead');
  const t = L.newGame(L.rng(1), { tutorial: true }); t.spawnT = 1e9; t.p.hp = 1; mk(t, 'ogre', 2, 0); L.step(t, 1 / 60, {}); assert.ok(t.phase === 'play' && t.p.hp >= 1);
  assert.strictEqual(t.p.need, 3, 'the first level up comes quickly in the tutorial');
  const e = L.newGame(L.rng(1), { diff: 'easy' }), n = L.newGame(L.rng(1), { diff: 'normal' }); assert.ok(e.p.maxhp > n.p.maxhp && L.DIFF.easy.ehp < L.DIFF.normal.ehp && L.DIFF.easy.spawn < L.DIFF.normal.spawn);
  assert.strictEqual(L.clock({ t: 125.4 }), '2:05');
});

test('balance check: standing still always dies early, and a kiting player survives much longer, more easily on easy', () => {
  const { runBot } = botKit();
  for (const diff of ['easy', 'normal']) { for (let seed = 1; seed <= 3; seed++) { const r = runBot(seed, diff, 'idle'); assert.ok(r.t < (diff === 'easy' ? 320 : 220), `${diff} idle dies by ${r.t.toFixed(0)}s`); } }
  const ease = [1, 2, 3, 4].map((s) => runBot(s, 'easy', 'smart')), norm = [1, 2, 3, 4].map((s) => runBot(s, 'normal', 'smart'));
  const avg = (a) => a.reduce((x, r) => x + r.t, 0) / a.length;
  assert.ok(avg(ease) > 300, 'a kiting player lasts well past five minutes on easy (' + avg(ease).toFixed(0) + 's)');
  assert.ok(avg(norm) > 240, 'and past four minutes on normal (' + avg(norm).toFixed(0) + 's)');
  assert.ok(avg(ease) >= avg(norm) - 1, 'easy is not harder than normal');
});

test('the same seed and moves always give the same game, and a long random run keeps everything finite', () => {
  const play = (seed) => { const st = L.newGame(L.rng(seed)); const rr = L.rng(77); for (let i = 0; i < 60 * 40 && st.phase !== 'dead'; i++) { open(st); L.step(st, 1 / 60, { dx: rr() - 0.5, dy: rr() - 0.5 }); } return [st.kills, st.p.level, Math.round(st.p.x * 100), Math.round(st.p.hp * 100), st.enemies.length].join(); };
  assert.strictEqual(play(5), play(5), 'deterministic'); assert.notStrictEqual(play(5), play(6));
  const st = L.newGame(L.rng(9)); st.p.invuln = 1e9; const rr = L.rng(3);
  for (let i = 0; i < 60 * 300 && st.phase !== 'win'; i++) { open(st); L.step(st, 1 / 60, { dx: rr() - 0.5, dy: rr() - 0.5 }); assert.ok(Number.isFinite(st.p.x) && Number.isFinite(st.p.hp)); for (const e of st.enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) assert.fail('bad enemy'); if (i % 600 === 0) assert.ok(st.enemies.length <= 400 && st.gems.length <= 500); }
});

// ---------- 시험용 봇: 가까운 괴물에게서 멀어지고 경험치로 간다 ----------
function botKit() {
  const move = (st) => {
    const p = st.p; let ax = 0, ay = 0;
    for (const e of st.enemies) { const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1; if (d < 90) { const w = (90 - d) / 90 / d * (e.type === 'ogre' || e.type === 'boss' ? 2 : 1); ax += dx * w; ay += dy * w; } }
    let g = null, gd = 1e9; for (const q of st.gems) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < gd) { gd = d; g = q; } }
    if (g && gd < 140 && Math.hypot(ax, ay) < 0.9) { const dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy) || 1; ax += dx / d * 0.6; ay += dy / d * 0.6; }
    if (Math.hypot(ax, ay) < 0.05) { const a = st.t * 0.5; ax = Math.cos(a) * 0.4; ay = Math.sin(a) * 0.4; }
    return { dx: ax, dy: ay };
  };
  const pick = (st) => { const c = st.choices; const order = (x) => x.kind === 'weapon' ? (x.level === 1 ? 0 : 2) : x.key === 'vitality' ? 1 : 3; let best = 0; for (let k = 1; k < c.length; k++) if (order(c[k]) < order(c[best])) best = k; L.choose(st, best); };
  const runBot = (seed, diff, mode) => {
    const st = L.newGame(L.rng(seed), { diff });
    for (let i = 0; i < 60 * 620 && st.phase !== 'dead' && st.phase !== 'win'; i++) { if (st.phase === 'levelup') { pick(st); continue; } L.step(st, 1 / 60, mode === 'idle' ? {} : move(st)); }
    return { t: st.t, phase: st.phase, won: st.won };
  };
  return { runBot };
}
