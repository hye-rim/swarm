'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 괴물 서바이벌: 화면·입력·소리. 규칙은 logic.js (LOGIC_SW). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_SW;
const { VW, VH } = L;
const TUTORIAL = /[?&]tutorial=1/.test(location.search);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const scale = Math.min((innerWidth - 16) / VW, (innerHeight - 16) / VH);
  const cssW = Math.max(150, Math.floor(VW * scale)), cssH = Math.floor(cssW * VH / VW);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; $('wrap').style.setProperty('--s', String(cssW / VW));
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / VW, 0, 0, canvas.height / VH, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 150));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('swMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.045) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
let lastKill = 0, lastGem = 0, lastShoot = 0;
const sfx = {
  shoot: () => { const n = performance.now(); if (n - lastShoot > 120) { lastShoot = n; tone(880, 0.05, 'square', 0.012, -400); } },
  kill: () => { const n = performance.now(); if (n - lastKill > 60) { lastKill = n; tone(300, 0.06, 'sawtooth', 0.02, -150); } },
  gem: () => { const n = performance.now(); if (n - lastGem > 50) { lastGem = n; tone(1200 + Math.random() * 300, 0.05, 'triangle', 0.02); } },
  thunder: () => { tone(160, 0.2, 'sawtooth', 0.05, -100); },
  hurt: () => tone(140, 0.2, 'sawtooth', 0.06, -70),
  levelup: () => melody([523, 659, 784, 1047], 70, 'triangle', 0.05),
  choose: () => melody([784, 1047], 60, 'triangle', 0.05),
  swarm: () => melody([220, 196, 220, 196], 120, 'sawtooth', 0.05),
  boss: () => melody([110, 98, 110, 82, 110, 98], 140, 'sawtooth', 0.06),
  dead: () => melody([392, 311, 262, 196, 147], 150, 'square', 0.05),
  win: () => melody([523, 659, 784, 1047, 784, 1047, 1319, 1568], 100, 'triangle', 0.06),
  start: () => melody([262, 330, 392], 70, 'triangle', 0.04),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                           // title · play · paused · over
let diff = store.get('swDiff') === 'easy' ? 'easy' : 'normal';
let best = Number(store.get('swBest')) || 0;
let fxs = [], clock = 0, shake = 0;
let banner = { text: '', sub: '', t: 0, color: '#fff' };

/* @test-hooks:start */
window.__sw = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt), start: (o) => startGame(o), setDir: (x, y) => { joy.dx = x; joy.dy = y; } };
/* @test-hooks:end */

// ---------- 입력: 화면 어디든 누르고 끌면 그 자리에 조이스틱이 생긴다. PC 는 방향키·WASD ----------
const keys = new Set();
const joy = { active: false, id: null, bx: 0, by: 0, kx: 0, ky: 0, dx: 0, dy: 0 };
const JOY_R = 26;
const K = { left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'], up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S'] };
const heldAny = (list) => list.some((k) => keys.has(k));
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (G && G.phase === 'levelup' && ['1', '2', '3'].includes(e.key)) { pickCard(Number(e.key) - 1); return; }
  if (Object.values(K).some((l) => l.includes(e.key))) e.preventDefault();
  keys.add(e.key);
});
addEventListener('keyup', (e) => { keys.delete(e.key); });
addEventListener('blur', () => { keys.clear(); joy.active = false; joy.dx = joy.dy = 0; pause(); });
const canvasPos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * VW, (e.clientY - r.top) / r.height * VH]; };
$('wrap').addEventListener('pointerdown', (e) => {
  if (e.target.closest('#overlay') || e.target.closest('#top')) return;
  e.preventDefault(); try { $('wrap').setPointerCapture(e.pointerId); } catch (_) {}
  const [x, y] = canvasPos(e); joy.active = true; joy.id = e.pointerId; joy.bx = joy.kx = x; joy.by = joy.ky = y; joy.dx = joy.dy = 0;
});
$('wrap').addEventListener('pointermove', (e) => {
  if (!joy.active || e.pointerId !== joy.id) return;
  const [x, y] = canvasPos(e); let dx = x - joy.bx, dy = y - joy.by; const d = Math.hypot(dx, dy);
  if (d > JOY_R) { joy.bx += dx / d * (d - JOY_R); joy.by += dy / d * (d - JOY_R); dx = x - joy.bx; dy = y - joy.by; }      // 기준점이 따라와서 손가락이 어디 있든 방향이 바로 바뀐다
  joy.kx = x; joy.ky = y; joy.dx = dx / JOY_R; joy.dy = dy / JOY_R;
});
const joyUp = (e) => { if (e.pointerId === joy.id || e.type === 'lostpointercapture') { joy.active = false; joy.dx = joy.dy = 0; } };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('wrap').addEventListener(ev, joyUp);
const readInput = () => {
  let dx = (heldAny(K.right) ? 1 : 0) - (heldAny(K.left) ? 1 : 0) + joy.dx, dy = (heldAny(K.down) ? 1 : 0) - (heldAny(K.up) ? 1 : 0) + joy.dy;
  return { dx, dy };
};

// ---------- 흐름 ----------
function startGame(o = {}) {
  G = L.newGame(Math.random, { diff: o.diff || diff, tutorial: TUTORIAL, weapon: o.weapon });
  if (TUTORIAL) { G.spawnT = 0.2; }
  fxs = []; shake = 0; state = 'play';
  $('overlay').classList.add('hidden');
  showBanner(TUTORIAL ? '연습' : '살아남아요!', TUTORIAL ? '움직이면 무기가 알아서 쏴요' : '8분 뒤에 대왕이 나타나요', 1.8);
  sfx.start();
}
function pause() {
  if (state !== 'play' || !G || G.phase === 'levelup') return;
  state = 'paused';
  showOverlay('<h2>일시정지</h2><div class="row"><button data-act="resume">계속하기</button><button data-act="title" class="sub">처음 화면</button></div>');
}
function resume() { if (state === 'paused') { state = 'play'; $('overlay').classList.add('hidden'); } }
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function showBanner(text, sub = '', t = 1.4, color = '#fff') { banner = { text, sub, t, color }; }
function showTitle() {
  state = 'title';
  showOverlay(`
    <h1>괴물 서바이벌</h1>
    <p>사방에서 몰려오는 괴물을 <b>피해 다니면</b> 무기가 알아서 쏴요!<br>경험치를 모아 <b>레벨 업</b>, 8분을 버텨 <b>대왕</b>을 쓰러뜨려요 🧟</p>
    <button class="opt" data-act="diff">🎚 난이도: ${L.DIFF[diff].name}</button>
    <button data-act="start">시작하기</button>
    <p style="font-size:calc(10px * var(--s,1));color:#9a8ac0"><span class="pc">⌨️ 방향키·WASD 이동</span><span class="touch">👆 화면을 누르고 끌면 이동</span>${best ? ` · 최고 ${best.toLocaleString('ko-KR')}점` : ''}</p>`);
}
function cardHtml(c, i) {
  let ico, nm, ds, tag = '', cls = '';
  if (c.kind === 'weapon') { const w = L.WEAPONS[c.key]; ico = w.icon; nm = w.name; ds = w.desc[c.level - 1]; tag = c.level === 1 ? '새 무기!' : `Lv.${c.level}`; cls = c.level === 1 ? 'new' : ''; }
  else if (c.kind === 'passive') { const p = L.PASSIVES[c.key]; ico = p.icon; nm = p.name; ds = p.desc; tag = `Lv.${c.level}`; }
  else { ico = '🍖'; nm = '고기'; ds = '체력을 40 회복한다'; }
  return `<button class="card ${cls}" data-card="${i}"><span class="ico">${ico}</span><span><span class="nm">${i + 1}. ${nm}<small>${tag}</small></span><br><span class="ds">${ds}</span></span></button>`;
}
function showLevelUp() {
  showOverlay(`<h2>⭐ 레벨 ${G.p.level}!</h2><p>하나를 골라요</p><div class="cards">${G.choices.map(cardHtml).join('')}</div>`);
}
function pickCard(i) {
  if (!G || G.phase !== 'levelup') return;
  if (L.choose(G, i)) { for (const e of G.events) handle(e); $('overlay').classList.add('hidden'); if (G.phase === 'levelup') showLevelUp(); }
}
function finish(won) {
  state = 'over';
  const score = G.score + Math.floor(G.t) * 5;
  const record = !TUTORIAL && score > best;
  if (record) { best = score; store.set('swBest', String(best)); }
  const ws = Object.entries(G.weapons).filter(([, v]) => v > 0).map(([k, v]) => `${L.WEAPONS[k].icon}${v}`).join(' ');
  showOverlay(`
    <h2>${won ? '🎉 대왕을 쓰러뜨렸다!' : '쓰러졌어요…'}</h2>
    <div class="big">${score.toLocaleString('ko-KR')}</div>
    <p>${record ? '<b>🎉 최고 기록!</b><br>' : ''}${L.clock(G)} 버팀 · 괴물 ${G.kills}마리 · 레벨 ${G.p.level}<br>${ws}</p>
    <div class="row"><button data-act="again">다시 하기</button><button data-act="title" class="sub">처음 화면</button></div>`);
}
$('overlay').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.blur();
  if (b.dataset.card !== undefined) pickCard(Number(b.dataset.card));
  else if (b.dataset.act === 'start' || b.dataset.act === 'again') startGame();
  else if (b.dataset.act === 'resume') resume();
  else if (b.dataset.act === 'diff') { diff = diff === 'easy' ? 'normal' : 'easy'; store.set('swDiff', diff); showTitle(); }
  else if (b.dataset.act === 'title') showTitle();
});

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (banner.t > 0) banner.t -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  if (state !== 'play' || !G) return;
  L.step(G, dt, readInput());
  for (const e of G.events) handle(e);
  if (G.phase === 'levelup' && $('overlay').classList.contains('hidden')) showLevelUp();
  if (G.phase === 'dead') { setTimeout(() => { if (state === 'ending') finish(false); }, 900); state = 'ending'; }
  if (G.phase === 'win') finish(true);
}
function handle(e) {
  if (e.t === 'move') tutorialSignal('move');
  else if (e.t === 'shoot') sfx.shoot();
  else if (e.t === 'kill') { sfx.kill(); tutorialSignal('kill'); fxs.push({ kind: 'pop', x: e.x, y: e.y, t: 0, life: 0.3, big: e.type === 'boss' || e.type === 'ogre' }); }
  else if (e.t === 'gem') { sfx.gem(); tutorialSignal('gem'); }
  else if (e.t === 'thunder') sfx.thunder();
  else if (e.t === 'hurt') { sfx.hurt(); shake = 0.15; }
  else if (e.t === 'levelup') { sfx.levelup(); tutorialSignal('levelup'); }
  else if (e.t === 'choose') { sfx.choose(); tutorialSignal('choose'); }
  else if (e.t === 'weapon') tutorialSignal('weapon');
  else if (e.t === 'swarm') { sfx.swarm(); showBanner('몰려온다!', '사방에서 괴물 떼', 1.6, '#ff8a6a'); }
  else if (e.t === 'boss') { sfx.boss(); showBanner('대왕 등장!', '쓰러뜨리면 이겨요', 2.2, '#ff5a8a'); tutorialSignal('boss'); }
  else if (e.t === 'dead') { sfx.dead(); showBanner('앗!', '', 1.2, '#ff6a6a'); }
  else if (e.t === 'bossDead') { sfx.win(); shake = 0.6; }
  else if (e.t === 'win') tutorialSignal('win');
}

// ---------- 그리기 ----------
const RC = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
let CX = 0, CY = 0;                                                    // 카메라 왼쪽 위 (세계 좌표)
const sx = (x) => Math.round(x - CX), sy = (y) => Math.round(y - CY);
function drawGround() {
  ctx.fillStyle = '#25362a'; ctx.fillRect(0, 0, VW, VH);
  const S = 24, x0 = Math.floor(CX / S), y0 = Math.floor(CY / S);
  for (let ix = x0; ix <= x0 + Math.ceil(VW / S) + 1; ix++) for (let iy = y0; iy <= y0 + Math.ceil(VH / S) + 1; iy++) {
    const h = hash(ix, iy), x = ix * S - CX, y = iy * S - CY;
    if ((ix + iy) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.025)'; ctx.fillRect(x, y, S, S); }
    if (h < 0.28) { ctx.fillStyle = '#3a5a3a'; ctx.fillRect(Math.round(x + h * 80 % 18), Math.round(y + (h * 300) % 18), 2, 3); ctx.fillRect(Math.round(x + h * 80 % 18) + 3, Math.round(y + (h * 300) % 18) + 1, 1, 2); }
    else if (h > 0.93) { ctx.fillStyle = '#4a5a52'; ctx.fillRect(Math.round(x + (h * 500) % 16), Math.round(y + (h * 900) % 16), 4, 3); ctx.fillStyle = '#6a7a72'; ctx.fillRect(Math.round(x + (h * 500) % 16), Math.round(y + (h * 900) % 16), 4, 1); }
  }
}
const ENEMY_DRAW = {
  bat: (e, x, y) => { const w = Math.floor(clock * 14 + e.id) % 2; ctx.fillStyle = '#7a4ab8'; ctx.beginPath(); ctx.ellipse(x, y, 3, 2.4, 0, 0, Math.PI * 2); ctx.fill(); RC(x - 6, y - (w ? 4 : 1), 4, 2, '#5a2a98'); RC(x + 2, y - (w ? 4 : 1), 4, 2, '#5a2a98'); RC(x - 1, y - 1, 1, 1, '#ff5a5a'); RC(x + 1, y - 1, 1, 1, '#ff5a5a'); },
  zombie: (e, x, y) => { const s = Math.floor(clock * 4 + e.id) % 2; RC(x - 4, y - 6, 8, 12, '#4a8a4a'); RC(x - 3, y - 9, 6, 4, '#6aaa6a'); RC(x - 2, y - 8, 1, 1, '#000'); RC(x + 1, y - 8, 1, 1, '#000'); RC(x - 6, y - 3 + s, 2, 5, '#4a8a4a'); RC(x + 4, y - 3 - s, 2, 5, '#4a8a4a'); RC(x - 3, y + 5, 2, 2, '#2a5a2a'); RC(x + 1, y + 5, 2, 2, '#2a5a2a'); },
  skeleton: (e, x, y) => { const s = Math.floor(clock * 6 + e.id) % 2; RC(x - 3, y - 5, 6, 9, '#e8e8e0'); RC(x - 3, y - 9, 6, 5, '#f4f4ec'); RC(x - 2, y - 8, 1, 2, '#222'); RC(x + 1, y - 8, 1, 2, '#222'); RC(x - 2, y - 3, 4, 1, '#999'); RC(x - 2, y - 1, 4, 1, '#999'); RC(x - 3, y + 4, 2, 3 + s, '#d8d8d0'); RC(x + 1, y + 4, 2, 3 + (1 - s), '#d8d8d0'); },
  ogre: (e, x, y) => { const s = Math.floor(clock * 3 + e.id) % 2; RC(x - 8, y - 6, 16, 16, '#9a6a3a'); RC(x - 6, y - 12, 12, 8, '#b88a5a'); RC(x - 4, y - 10, 2, 2, '#fff'); RC(x + 2, y - 10, 2, 2, '#fff'); RC(x - 3, y - 9, 1, 1, '#000'); RC(x + 3, y - 9, 1, 1, '#000'); RC(x - 4, y - 5, 8, 1, '#4a2a1a'); RC(x - 11, y - 3 + s, 4, 9, '#9a6a3a'); RC(x + 7, y - 3 - s, 4, 9, '#9a6a3a'); RC(x - 6, y + 9, 4, 3, '#5a3a1a'); RC(x + 2, y + 9, 4, 3, '#5a3a1a'); },
  boss: (e, x, y) => { const s = Math.floor(clock * 4) % 2; ctx.fillStyle = '#6a1a8a'; ctx.beginPath(); ctx.ellipse(x, y, 17, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8a2ab0'; ctx.beginPath(); ctx.ellipse(x, y - 4, 13, 10, 0, 0, Math.PI * 2); ctx.fill(); RC(x - 13, y - 17, 4, 9, '#ffd23a'); RC(x + 9, y - 17, 4, 9, '#ffd23a'); RC(x - 8, y - 6, 5, 4, '#ff3a3a'); RC(x + 3, y - 6, 5, 4, '#ff3a3a'); RC(x - 7, y - 5, 2, 2, '#fff'); RC(x + 4, y - 5, 2, 2, '#fff'); RC(x - 9, y + 3, 18, 3, '#1a0a2a'); for (let i = -8; i <= 6; i += 4) RC(x + i, y + 3, 2, 2 + s, '#fff'); RC(x - 22, y - 4 + s * 2, 6, 14, '#5a1a7a'); RC(x + 16, y - 4 - s * 2, 6, 14, '#5a1a7a'); },
};
function drawEnemies() {
  for (const e of G.enemies) {
    const x = sx(e.x), y = sy(e.y);
    if (x < -30 || x > VW + 30 || y < -30 || y > VH + 30) continue;
    if (e.flash > 0) { ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, e.r + 1, 0, Math.PI * 2); ctx.fill(); continue; }
    ENEMY_DRAW[e.type](e, x, y);
    if (e.type === 'boss') { RC(x - 20, y - 26, 40, 4, '#300'); RC(x - 20, y - 26, Math.max(0, Math.round(40 * e.hp / e.maxhp)), 4, '#ff4a6a'); }
  }
}
function drawGems() {
  for (const g of G.gems) { const x = sx(g.x), y = sy(g.y); if (x < -6 || x > VW + 6 || y < -6 || y > VH + 6) continue; const big = g.xp >= 5, mid = g.xp >= 2; ctx.fillStyle = big ? '#ff6a6a' : mid ? '#6aff8a' : '#6ac8ff'; ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 2.5, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 2.5, y); ctx.closePath(); ctx.fill(); RC(x - 1, y - 1, 1, 1, '#fff'); }
}
function drawWeapons() {
  for (const z of G.zones) { const x = sx(z.x), y = sy(z.y), k = 1 - z.age / z.life; ctx.globalAlpha = 0.35 + 0.25 * Math.sin(clock * 12 + z.id); ctx.fillStyle = '#ff7a2a'; ctx.beginPath(); ctx.arc(x, y, z.r * (0.9 + 0.1 * Math.sin(clock * 8)), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 0.5 * Math.min(1, k * 3); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(x, y, z.r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  for (const s of G.shots) {
    const x = sx(s.x), y = sy(s.y);
    if (s.kind === 'bolt') { ctx.fillStyle = 'rgba(120,180,255,.4)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#cfe8ff'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot); RC(-1, -7, 2, 14, '#8a5a2a'); ctx.fillStyle = '#c8d0e0'; ctx.beginPath(); ctx.moveTo(1, -7); ctx.lineTo(8, -5); ctx.lineTo(8, 1); ctx.lineTo(1, 0); ctx.fill(); ctx.restore(); }
  }
  for (const [bx, by] of G.bladePos || []) { const x = sx(bx), y = sy(by); ctx.save(); ctx.translate(x, y); ctx.rotate(clock * 14); ctx.fillStyle = '#e8f0ff'; ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 3 : 7; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.restore(); }
  for (const f of G.fx) if (f.kind === 'bolt') { const x = sx(f.x), k = f.t / f.life; ctx.strokeStyle = `rgba(255,240,120,${1 - k})`; ctx.lineWidth = 2.5; ctx.beginPath(); let yy = -4, xx = x + 6; ctx.moveTo(xx, yy); const ty = sy(f.y); const n = 6; for (let i = 1; i <= n; i++) { xx = x + (i % 2 ? -5 : 5) * (1 - i / n); yy = -4 + (ty + 4) * i / n; ctx.lineTo(xx, yy); } ctx.stroke(); ctx.fillStyle = `rgba(255,255,255,${1 - k})`; ctx.beginPath(); ctx.arc(x, ty, 8 * (1 - k) + 2, 0, Math.PI * 2); ctx.fill(); }
}
function drawPlayer() {
  const p = G.p;
  if (p.invuln > 0 && G.phase === 'play' && Math.floor(p.invuln * 16) % 2) return;
  const x = sx(p.x), y = sy(p.y), f = p.face, run = Math.floor(clock * 10) % 2;
  const px = (ox, oy, w, h, c) => RC(x + (f > 0 ? ox : -ox - w), y + oy, w, h, c);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 7, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  px(-4, -4, 8, 10, '#3a5ae0'); px(-4, -4, 8, 2, '#6a8aff');                                    // 로브
  px(-3, -8, 6, 5, '#f8d8b0'); px(0, -7, 1, 2, '#000');                                         // 얼굴
  px(-5, -12, 10, 3, '#6a2ac8'); px(-3, -16, 6, 5, '#7a3ae0'); px(-1, -18, 2, 2, '#ffd23a');   // 모자
  px(-3, 6, 2, 2 + run, '#2a2a5a'); px(1, 6, 2, 2 + (1 - run), '#2a2a5a');
  px(4, -2, 1, 8, '#a06a30'); px(3, -4, 3, 2, '#ffd23a');                                       // 지팡이
}
function drawFx() {
  for (const f of fxs) { const k = f.t / f.life; if (f.kind === 'pop') { ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 3 + k * (f.big ? 14 : 8), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; } }
}
function drawJoystick() {
  if (!joy.active) return;
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(joy.bx, joy.by, JOY_R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(joy.kx, joy.ky, 9, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
}
function drawHud() {
  const p = G.p;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, VW, 16);
  RC(0, 0, VW, 5, '#102040'); RC(0, 0, Math.round(VW * p.xp / p.need), 5, '#4aa8ff');
  ctx.font = 'bold 8px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.fillText(`Lv.${p.level}`, 4, 11);
  ctx.textAlign = 'center'; ctx.fillStyle = G.t >= L.BOSS_AT - 30 && !G.bossSpawned ? '#ff8a8a' : '#fff'; ctx.fillText(L.clock(G), VW / 2, 11);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffd23a'; ctx.fillText(`☠ ${G.kills}`, VW - 66, 11);
  // 체력 막대(머리 위가 아니라 위쪽 한 줄)
  RC(36, 7, 60, 6, '#401020'); RC(36, 7, Math.max(0, Math.round(60 * p.hp / p.maxhp)), 6, p.hp < p.maxhp * 0.3 ? '#ff4a4a' : '#ff7a9a');
  // 가진 무기와 능력
  ctx.textAlign = 'left'; ctx.font = '9px sans-serif'; let ix = 4;
  for (const [k, v] of Object.entries(G.weapons)) if (v) { ctx.fillText(L.WEAPONS[k].icon, ix, 24); ctx.font = 'bold 6px sans-serif'; ctx.fillStyle = '#ffd23a'; ctx.fillText(String(v), ix + 9, 28); ctx.font = '9px sans-serif'; ix += 17; }
  for (const [k, v] of Object.entries(G.passives)) if (v) { ctx.fillStyle = '#fff'; ctx.fillText(L.PASSIVES[k].icon, ix, 24); ctx.font = 'bold 6px sans-serif'; ctx.fillStyle = '#9ad0ff'; ctx.fillText(String(v), ix + 9, 28); ctx.font = '9px sans-serif'; ix += 17; }
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
  if (!G) { drawBgTitle(); return; }
  CX = G.p.x - VW / 2; CY = G.p.y - VH / 2;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
  drawGround(); drawGems(); drawWeapons(); drawEnemies(); drawPlayer(); drawFx();
  ctx.restore();
  drawJoystick(); drawHud();
  if (G.phase === 'winning') { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, G.endT * 0.3)})`; ctx.fillRect(0, 0, VW, VH); }
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 100, VW, banner.sub ? 42 : 26);
    ctx.fillStyle = banner.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, VW / 2, 113);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, VW / 2, 131); }
  }
}
function drawBgTitle() { CX = clock * 12; CY = 0; drawGround(); }

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function toggleMute() { muted = !muted; store.set('swMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
showTitle();
requestAnimationFrame(frame);
