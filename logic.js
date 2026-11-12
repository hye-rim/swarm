'use strict';
// 괴물 서바이벌 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 끝없이 넓은 바닥에서 사방에서 몰려오는 괴물을 피해 다니며, 자동으로 나가는 무기로 쓰러뜨리고, 경험치를 모아 레벨을 올려 무기와 능력을 고른다.
// 좌표는 픽셀. 플레이어는 화면 가운데에 있고 세계가 움직인다. 같은 난수(시드)와 같은 움직임이면 항상 같은 판이 된다.
const LOGIC_SW = (() => {
  const VW = 240, VH = 288;
  const BOSS_AT = 480;                                       // 8분이 되면 대왕이 나타난다. 쓰러뜨리면 이긴다
  const DIFF = {
    easy: { name: '쉬움', hp: 130, ehp: 0.7, spawn: 0.7, dmg: 0.75, boss: 700 },
    normal: { name: '보통', hp: 100, ehp: 0.85, spawn: 0.9, dmg: 0.9, boss: 1000 },
  };
  const PLAYER = { r: 5, speed: 62, regen: 0.4, invuln: 0.45, pickup: 34 };
  const ENEMY = {
    bat: { r: 3.5, hp: 2, speed: 50, dmg: 4, xp: 1 },
    zombie: { r: 5, hp: 8, speed: 24, dmg: 6, xp: 1 },
    skeleton: { r: 5, hp: 14, speed: 33, dmg: 8, xp: 2 },
    ogre: { r: 9, hp: 60, speed: 19, dmg: 14, xp: 6 },
    boss: { r: 17, hp: 1200, speed: 27, dmg: 22, xp: 60 },
  };
  // 무기: 레벨 1~5 마다 값이 늘어난다. cd = 쉬는 시간(초), dmg = 피해
  const WEAPONS = {
    bolt: { name: '마법 화살', icon: '🔮', desc: ['가장 가까운 괴물에게 화살을 쏜다', '화살 2개', '피해 +50%', '화살 3개', '피해 +30%, 관통 2'],
      cd: [1.0, 1.0, 0.95, 0.95, 0.8], n: [1, 2, 2, 3, 3], dmg: [8, 8, 12, 12, 16], pierce: [0, 0, 0, 0, 2] },
    blades: { name: '회전 칼날', icon: '🌀', desc: ['칼날이 몸 둘레를 돈다', '피해 +30%', '칼날 3개', '피해 +25%', '칼날 4개, 더 빠르게'],
      n: [2, 2, 3, 3, 4], dmg: [6, 8, 8, 10, 12], radius: [32, 34, 36, 38, 42], spin: [2.6, 2.7, 2.8, 3.0, 3.6] },
    lightning: { name: '번개', icon: '⚡', desc: ['무작위 괴물에게 번개가 친다', '번개 2번', '피해 +20%', '번개 3번', '번개 4번, 피해 +25%'],
      cd: [2.2, 2.0, 1.8, 1.6, 1.3], n: [1, 2, 2, 3, 4], dmg: [20, 20, 24, 24, 30] },
    fire: { name: '불꽃 장판', icon: '🔥', desc: ['괴물이 많은 곳에 불이 번진다', '오래 탄다', '장판 2개', '더 넓고 세게', '장판 3개'],
      cd: [3.0, 3.0, 3.0, 2.8, 2.6], n: [1, 1, 2, 2, 3], dps: [10, 12, 12, 16, 18], radius: [18, 19, 20, 25, 27], life: [3, 4, 4, 4.5, 5] },
    axe: { name: '도끼', icon: '🪓', desc: ['도끼를 높이 던져 괴물을 뚫는다', '더 자주', '도끼 2개', '피해 +30%', '도끼 3개'],
      cd: [2.0, 1.7, 1.7, 1.6, 1.4], n: [1, 1, 2, 2, 3], dmg: [14, 14, 14, 18, 20] },
  };
  const PASSIVES = {
    power: { name: '힘', icon: '💪', desc: '피해 +15%', max: 5 },
    speed: { name: '빠른 발', icon: '👟', desc: '이동 속도 +8%', max: 5 },
    magnet: { name: '자석', icon: '🧲', desc: '경험치를 더 멀리서 빨아들인다', max: 5 },
    vitality: { name: '튼튼함', icon: '❤️', desc: '최대 체력 +20, 조금 회복', max: 5 },
    haste: { name: '재빠름', icon: '⏱️', desc: '무기 쉬는 시간 -8%', max: 5 },
  };
  const WEAPON_MAX = 5;
  const needFor = (level) => 5 + 4 * level;

  const rng = (seed) => {                                    // mulberry32 (시험용 고정 난수)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function newGame(rand = Math.random, opts = {}) {
    const d = DIFF[opts.diff] || DIFF.normal;
    const st = {
      rand, diff: opts.diff in DIFF ? opts.diff : 'normal', d, tutorial: !!opts.tutorial, t: 0, events: [], phase: 'play',
      p: { x: 0, y: 0, r: PLAYER.r, hp: d.hp, maxhp: d.hp, face: 1, fx: 1, fy: 0, invuln: 0, level: 1, xp: 0, need: opts.tutorial ? 3 : needFor(1), moved: false, walked: 0 },
      enemies: [], shots: [], gems: [], zones: [], fx: [], seq: 1, kills: 0, score: 0, won: false, pending: 0, choices: null,
      weapons: { bolt: 1, blades: 0, lightning: 0, fire: 0, axe: 0 }, passives: { power: 0, speed: 0, magnet: 0, vitality: 0, haste: 0 },
      cd: { bolt: 0.3, lightning: 1, fire: 1.5, axe: 1 }, bladeAngle: 0, spawnT: 0.5, burstDone: [], bossSpawned: false, boss: null, grid: new Map(),
    };
    if (opts.weapon && WEAPONS[opts.weapon]) { st.weapons.bolt = 0; st.weapons[opts.weapon] = 1; }
    return st;
  }
  const dmgMul = (st) => 1 + 0.15 * st.passives.power;
  const cdMul = (st) => 1 - 0.08 * st.passives.haste;
  const speedMul = (st) => 1 + 0.08 * st.passives.speed;
  const pickupR = (st) => PLAYER.pickup * (1 + 0.25 * st.passives.magnet);

  // ---------- 공간 칸(충돌 찾기를 빠르게) ----------
  const CELL = 28;
  const cellKey = (cx, cy) => cx * 100003 + cy;
  function buildGrid(st) {
    st.grid.clear();
    for (const e of st.enemies) {
      const k = cellKey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let a = st.grid.get(k); if (!a) { a = []; st.grid.set(k, a); } a.push(e);
    }
  }
  function near(st, x, y, r, fn) {
    const c0 = Math.floor((x - r - 20) / CELL), c1 = Math.floor((x + r + 20) / CELL), r0 = Math.floor((y - r - 20) / CELL), r1 = Math.floor((y + r + 20) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const a = st.grid.get(cellKey(cx, cy)); if (a) for (const e of a) fn(e); }
  }

  // ---------- 괴물 ----------
  function spawnEnemy(st, type, x, y) {
    const b = ENEMY[type], k = 1 + st.t / 240;                            // 시간이 갈수록 단단해진다 (4분에 2배)
    const hp = type === 'boss' ? st.d.boss : Math.max(1, Math.round(b.hp * st.d.ehp * k));
    const e = { id: st.seq++, type, x, y, r: b.r, hp, maxhp: hp, speed: b.speed * (0.9 + st.rand() * 0.2) * (1 + Math.min(0.4, st.t / 900)), dmg: b.dmg * st.d.dmg, xp: b.xp, kx: 0, ky: 0, flash: 0, bladeCd: 0, axeCd: 0, summonT: 3 };
    st.enemies.push(e);
    return e;
  }
  function ringPos(st, extra = 24) {
    const a = st.rand() * Math.PI * 2, R = Math.hypot(VW, VH) / 2 + extra;
    return [st.p.x + Math.cos(a) * R, st.p.y + Math.sin(a) * R];
  }
  // 시간에 따라 어떤 괴물이 나오는가
  function pickType(st) {
    const m = st.t / 60, r = st.rand();
    if (m < 1) return r < 0.55 ? 'bat' : 'zombie';
    if (m < 2.5) return r < 0.35 ? 'bat' : r < 0.7 ? 'zombie' : 'skeleton';
    if (m < 4) return r < 0.25 ? 'bat' : r < 0.5 ? 'zombie' : r < 0.9 ? 'skeleton' : 'ogre';
    return r < 0.2 ? 'bat' : r < 0.4 ? 'zombie' : r < 0.8 ? 'skeleton' : 'ogre';
  }
  const spawnInterval = (st) => Math.max(0.12, (0.9 - st.t / 60 * 0.09)) / st.d.spawn * (st.bossSpawned ? 2.5 : 1);         // 1분마다 빨라진다. 대왕이 나온 뒤에는 잔챙이가 뜸해진다
  function stepSpawns(st, h) {
    st.spawnT -= h;
    while (st.spawnT <= 0) {
      st.spawnT += spawnInterval(st);
      if (st.enemies.length >= 320) break;
      const [x, y] = ringPos(st);
      const n = st.t > 120 && st.rand() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) spawnEnemy(st, pickType(st), x + (st.rand() - 0.5) * 16, y + (st.rand() - 0.5) * 16);
    }
    // 2분·4분·6분에 사방에서 한꺼번에 몰려온다
    for (const at of [120, 240, 360]) if (st.t >= at && !st.burstDone.includes(at)) {
      st.burstDone.push(at); emit(st, { t: 'swarm' });
      const type = at === 120 ? 'bat' : at === 240 ? 'zombie' : 'skeleton', n = at === 120 ? 24 : 28;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, R = Math.hypot(VW, VH) / 2 + 30; spawnEnemy(st, type, st.p.x + Math.cos(a) * R, st.p.y + Math.sin(a) * R); }
    }
    if (st.t >= BOSS_AT && !st.bossSpawned) {
      st.bossSpawned = true; const [x, y] = ringPos(st, 40); st.boss = spawnEnemy(st, 'boss', x, y); emit(st, { t: 'boss' });
    }
  }
  function stepEnemies(st, h) {
    const p = st.p;
    for (const e of st.enemies) {
      if (e.flash > 0) e.flash -= h;
      if (e.bladeCd > 0) e.bladeCd -= h;
      if (e.axeCd > 0) e.axeCd -= h;
      let dx = p.x - e.x, dy = p.y - e.y; const d = Math.hypot(dx, dy) || 1;
      if (d > 520) { const [x, y] = ringPos(st); e.x = x; e.y = y; continue; }                  // 너무 멀어진 괴물은 다시 가까이 보낸다
      dx /= d; dy /= d;
      e.x += (dx * e.speed + e.kx) * h; e.y += (dy * e.speed + e.ky) * h;
      e.kx *= Math.max(0, 1 - 6 * h); e.ky *= Math.max(0, 1 - 6 * h);
      if (e.type === 'boss') { e.summonT -= h; if (e.summonT <= 0) { e.summonT = 4; for (let i = 0; i < 5; i++) spawnEnemy(st, 'bat', e.x + (st.rand() - 0.5) * 30, e.y + (st.rand() - 0.5) * 30); } }
    }
    buildGrid(st);
    // 겹치지 않게 서로 밀어낸다
    for (const e of st.enemies) near(st, e.x, e.y, e.r, (o) => {
      if (o.id <= e.id) return;
      const ox = o.x - e.x, oy = o.y - e.y, dd = Math.hypot(ox, oy) || 0.01, min = (e.r + o.r) * 0.8;
      if (dd < min) { const push = (min - dd) * 0.5; const ux = ox / dd, uy = oy / dd; if (e.type !== 'boss') { e.x -= ux * push; e.y -= uy * push; } if (o.type !== 'boss') { o.x += ux * push; o.y += uy * push; } }
    });
    // 몸에 닿으면 아프다
    if (p.invuln > 0) return;
    near(st, p.x, p.y, p.r + 12, (e) => { if (p.invuln <= 0 && dist(p.x, p.y, e.x, e.y) < p.r + e.r - 1) hurtMe(st, e.dmg); });
  }
  function hurtMe(st, dmg) {
    const p = st.p;
    if (p.invuln > 0 || st.phase !== 'play') return;
    p.hp = st.tutorial ? Math.max(1, p.hp - dmg) : p.hp - dmg;
    p.invuln = PLAYER.invuln; emit(st, { t: 'hurt', dmg });
    if (p.hp <= 0) { p.hp = 0; st.phase = 'dead'; st.endT = 0; emit(st, { t: 'dead' }); }
  }
  function damage(st, e, dmg, kb = 0, fromX = 0, fromY = 0) {
    if (e.hp <= 0) return;
    e.hp -= dmg * dmgMul(st); e.flash = 0.08;
    if (kb && e.type !== 'boss') { const dx = e.x - fromX, dy = e.y - fromY, d = Math.hypot(dx, dy) || 1; e.kx += dx / d * kb; e.ky += dy / d * kb; }
    if (e.hp <= 0) killEnemy(st, e);
  }
  function killEnemy(st, e) {
    st.kills++; st.score += e.type === 'boss' ? 1000 : 10;
    emit(st, { t: 'kill', x: e.x, y: e.y, type: e.type });
    const xp = e.xp; st.gems.push({ id: st.seq++, x: e.x, y: e.y, xp, fly: 0 });
    if (e.type === 'boss') { st.phase = 'winning'; st.endT = 0; emit(st, { t: 'bossDead' }); for (const o of st.enemies) if (o !== e) o.hp = 0; }
  }

  // ---------- 무기 ----------
  const lv = (st, k) => st.weapons[k];
  const val = (st, k, f) => WEAPONS[k][f][lv(st, k) - 1];
  function nearestEnemy(st, maxD, skip) {
    let best = null, bd = maxD;
    for (const e of st.enemies) { if (e.hp <= 0 || (skip && skip.has(e.id))) continue; const d = dist(st.p.x, st.p.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function stepWeapons(st, h) {
    const p = st.p;
    // 마법 화살
    if (lv(st, 'bolt')) {
      st.cd.bolt -= h;
      if (st.cd.bolt <= 0) {
        const n = val(st, 'bolt', 'n'); st.cd.bolt = val(st, 'bolt', 'cd') * cdMul(st);
        const used = new Set(); let fired = 0;
        for (let i = 0; i < n; i++) {
          let t = nearestEnemy(st, 150, used); let ax, ay;
          if (t) { used.add(t.id); const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1; ax = dx / d; ay = dy / d; }
          else if (i === 0) { ax = p.fx; ay = p.fy; } else continue;
          st.shots.push({ id: st.seq++, kind: 'bolt', x: p.x, y: p.y, vx: ax * 170, vy: ay * 170, r: 3, dmg: val(st, 'bolt', 'dmg'), pierce: val(st, 'bolt', 'pierce'), life: 1.1, hit: [] }); fired++;
        }
        if (fired) emit(st, { t: 'shoot' });
      }
    }
    // 회전 칼날: 위치는 계산으로 구하고, 닿은 괴물에게 0.4초마다 피해
    if (lv(st, 'blades')) {
      st.bladeAngle += val(st, 'blades', 'spin') * h;
      const n = val(st, 'blades', 'n'), R = val(st, 'blades', 'radius');
      st.bladePos = [];
      for (let i = 0; i < n; i++) {
        const a = st.bladeAngle + i * Math.PI * 2 / n, bx = p.x + Math.cos(a) * R, by = p.y + Math.sin(a) * R; st.bladePos.push([bx, by]);
        near(st, bx, by, 6, (e) => { if (e.hp > 0 && e.bladeCd <= 0 && dist(bx, by, e.x, e.y) < e.r + 5) { e.bladeCd = 0.4; damage(st, e, val(st, 'blades', 'dmg'), 90, p.x, p.y); } });
      }
    } else st.bladePos = [];
    // 번개
    if (lv(st, 'lightning')) {
      st.cd.lightning -= h;
      if (st.cd.lightning <= 0) {
        st.cd.lightning = val(st, 'lightning', 'cd') * cdMul(st);
        const cands = st.enemies.filter((e) => e.hp > 0 && Math.abs(e.x - p.x) < VW / 2 && Math.abs(e.y - p.y) < VH / 2);
        const n = Math.min(val(st, 'lightning', 'n'), cands.length);
        for (let i = 0; i < n; i++) { const j = Math.floor(st.rand() * cands.length), e = cands.splice(j, 1)[0]; st.fx.push({ kind: 'bolt', x: e.x, y: e.y, t: 0, life: 0.25 }); damage(st, e, val(st, 'lightning', 'dmg'), 0); }
        if (n) emit(st, { t: 'thunder' });
      }
    }
    // 불꽃 장판: 괴물이 가까이 있는 곳에 둔다
    if (lv(st, 'fire')) {
      st.cd.fire -= h;
      if (st.cd.fire <= 0) {
        st.cd.fire = val(st, 'fire', 'cd') * cdMul(st);
        for (let i = 0; i < val(st, 'fire', 'n'); i++) {
          const t = nearestEnemy(st, 140, null); let x, y;
          if (t) { x = t.x + (st.rand() - 0.5) * 20; y = t.y + (st.rand() - 0.5) * 20; } else { const a = st.rand() * Math.PI * 2; x = p.x + Math.cos(a) * 50; y = p.y + Math.sin(a) * 50; }
          st.zones.push({ id: st.seq++, x, y, r: val(st, 'fire', 'radius'), life: val(st, 'fire', 'life'), age: 0, tick: 0.3, dps: val(st, 'fire', 'dps') });
        }
        emit(st, { t: 'fire' });
      }
    }
    // 도끼
    if (lv(st, 'axe')) {
      st.cd.axe -= h;
      if (st.cd.axe <= 0) {
        st.cd.axe = val(st, 'axe', 'cd') * cdMul(st);
        const n = val(st, 'axe', 'n');
        for (let i = 0; i < n; i++) st.shots.push({ id: st.seq++, kind: 'axe', x: p.x, y: p.y, vx: (p.face > 0 ? 1 : -1) * (30 + st.rand() * 40) * (i % 2 ? -1 : 1), vy: -170 - st.rand() * 30, r: 7, dmg: val(st, 'axe', 'dmg'), life: 2.2, rot: 0 });
        emit(st, { t: 'axe' });
      }
    }
  }
  function stepShots(st, h) {
    for (const s of st.shots) {
      s.life -= h; s.x += s.vx * h; s.y += s.vy * h;
      if (s.kind === 'axe') { s.vy += 340 * h; s.rot += 12 * h; }
      near(st, s.x, s.y, s.r, (e) => {
        if (e.hp <= 0 || s.life <= 0) return;
        if (dist(s.x, s.y, e.x, e.y) >= e.r + s.r) return;
        if (s.kind === 'bolt') {
          if (s.hit.includes(e.id)) return; s.hit.push(e.id); damage(st, e, s.dmg, 60, s.x - s.vx, s.y - s.vy);
          if (s.hit.length > s.pierce) s.life = 0;
        } else if (e.axeCd <= 0) { e.axeCd = 0.35; damage(st, e, s.dmg, 50, s.x, s.y); }
      });
    }
    st.shots = st.shots.filter((s) => s.life > 0 && dist(s.x, s.y, st.p.x, st.p.y) < 400);
    for (const z of st.zones) {
      z.age += h; z.tick -= h;
      if (z.tick <= 0) { z.tick += 0.3; near(st, z.x, z.y, z.r, (e) => { if (e.hp > 0 && dist(z.x, z.y, e.x, e.y) < z.r + e.r * 0.5) damage(st, e, z.dps * 0.3, 0); }); }
    }
    st.zones = st.zones.filter((z) => z.age < z.life);
    for (const f of st.fx) f.t += h;
    st.fx = st.fx.filter((f) => f.t < f.life);
    st.enemies = st.enemies.filter((e) => e.hp > 0);
  }

  // ---------- 경험치와 레벨 업 ----------
  function stepGems(st, h) {
    const p = st.p, R = pickupR(st);
    for (const g of st.gems) {
      const d = dist(p.x, p.y, g.x, g.y);
      if (d < R || g.fly) { g.fly = Math.min(1, (g.fly || 0) + h * 4); const sp = (120 + 260 * g.fly) * h; const dx = p.x - g.x, dy = p.y - g.y; g.x += dx / (d || 1) * Math.min(sp, d); g.y += dy / (d || 1) * Math.min(sp, d); }
      if (d < p.r + 3) { g.got = true; addXp(st, g.xp); emit(st, { t: 'gem' }); }
    }
    st.gems = st.gems.filter((g) => !g.got);
    if (st.gems.length > 500) st.gems.splice(0, st.gems.length - 500);
  }
  function addXp(st, xp) {
    const p = st.p; p.xp += xp;
    while (p.xp >= p.need) { p.xp -= p.need; p.level++; p.need = needFor(p.level); st.pending++; }
    if (st.pending > 0 && st.phase === 'play') openLevelUp(st);
  }
  function makeChoices(st) {
    const c = [];
    for (const k of Object.keys(WEAPONS)) if (st.weapons[k] < WEAPON_MAX) c.push({ kind: 'weapon', key: k, level: st.weapons[k] + 1 });
    for (const k of Object.keys(PASSIVES)) if (st.passives[k] < PASSIVES[k].max) c.push({ kind: 'passive', key: k, level: st.passives[k] + 1 });
    for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
    const out = c.slice(0, 3);
    while (out.length < 3) out.push({ kind: 'heal', key: 'heal', level: 0 });
    return out;
  }
  function openLevelUp(st) { st.phase = 'levelup'; st.choices = makeChoices(st); emit(st, { t: 'levelup', level: st.p.level }); }
  function choose(st, i) {
    if (st.phase !== 'levelup' || !st.choices || !st.choices[i]) return false;
    const c = st.choices[i];
    if (c.kind === 'weapon') { st.weapons[c.key] = c.level; if (c.level === 1) emit(st, { t: 'weapon', key: c.key }); }
    else if (c.kind === 'passive') {
      st.passives[c.key] = c.level;
      if (c.key === 'vitality') { st.p.maxhp += 20; st.p.hp = Math.min(st.p.maxhp, st.p.hp + 30); }
    } else st.p.hp = Math.min(st.p.maxhp, st.p.hp + 40);
    st.pending--; st.choices = null; st.phase = 'play'; emit(st, { t: 'choose' });
    if (st.pending > 0) openLevelUp(st);
    return true;
  }

  // ---------- 한 걸음 ----------
  // input: { dx, dy } 움직이는 방향(길이 0~1)
  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'dead' || st.phase === 'win') return;
    if (st.phase === 'levelup') return;
    if (st.phase === 'winning') { st.endT += h; st.t += h; for (const f of st.fx) f.t += h; if (st.endT > 2.5) { st.phase = 'win'; st.won = true; st.score += 3000; emit(st, { t: 'win' }); } return; }
    st.t += h;
    const p = st.p;
    let dx = input.dx || 0, dy = input.dy || 0; const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (len > 0.05) {
      p.x += dx * PLAYER.speed * speedMul(st) * h; p.y += dy * PLAYER.speed * speedMul(st) * h;
      const l = Math.hypot(dx, dy); p.fx = dx / l; p.fy = dy / l; if (Math.abs(dx) > 0.1) p.face = dx > 0 ? 1 : -1;
      p.walked += PLAYER.speed * speedMul(st) * h * Math.min(1, len);
      if (!p.moved && p.walked > 24) { p.moved = true; emit(st, { t: 'move' }); }
    }
    if (p.invuln > 0) p.invuln -= h;
    p.hp = Math.min(p.maxhp, p.hp + PLAYER.regen * h);
    stepSpawns(st, h);
    stepEnemies(st, h);
    if (st.phase !== 'play') return;
    stepWeapons(st, h);
    stepShots(st, h);
    stepGems(st, h);
  }
  const clock = (st) => { const s = Math.floor(st.t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  return { VW, VH, BOSS_AT, DIFF, PLAYER, ENEMY, WEAPONS, PASSIVES, WEAPON_MAX, needFor, rng, newGame, step, choose, spawnEnemy, damage, hurtMe, killEnemy, buildGrid, addXp, makeChoices, dmgMul, cdMul, speedMul, pickupR, clock, ringPos, openLevelUp };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_SW;
