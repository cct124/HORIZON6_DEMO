import * as THREE from 'three';
import { Track, ROAD_HALF } from './track.js';
import { loadAssets } from './assets.js';
import { World } from './world.js';
import { PlayerCar } from './car.js';
import { RacerAI, Traffic } from './ai.js';
import { AudioManager } from './audio.js';
import { HUD, formatTime } from './hud.js';
import { Particles } from './particles.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- 输入 ----------------
const keys = new Set();
window.addEventListener('keydown', e => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  handleKeyPress(e.code);
});
window.addEventListener('keyup', e => keys.delete(e.code));

function readInput() {
  const throttle = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
  const brake = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
  let steer = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer += 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer -= 1;
  return {
    throttle, brake, steer,
    handbrake: keys.has('Space'),
    nitro: keys.has('ShiftLeft') || keys.has('ShiftRight')
  };
}

// ---------------- 全局状态 ----------------
let state = 'loading';
let assets, track, world, player, hud, particles, traffic;
const audio = new AudioManager();
let racers = [];
let camMode = 0;
let camPos = new THREE.Vector3(0, 30, 60);
let camLook = new THREE.Vector3();
let lastTime = performance.now();

// 比赛状态
let raceMode = null;
let raceLaps = 1;
let raceTime = 0;
let countdownT = 0;
let playerLap = -1;
let nextCp = 10;
let playerFinished = false;
let finishDelay = 0;
let wrongWayT = 0;
let driftPoints = 0;
let driftGrace = 0;
let nitroWasActive = false;
const CP_COUNT = 10;

const AI_DEFS = [
  { name: 'Alex·雷诺', color: 0x2255ee, skill: 0.985 },
  { name: '小雨 Yu', color: 0xffc400, skill: 0.94 },
  { name: 'Marco·罗西', color: 0x22bb44, skill: 0.90 }
];

// ---------------- 加载 ----------------
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');

async function boot() {
  assets = await loadAssets(p => {
    loadingBar.style.width = `${Math.round(p * 100)}%`;
    loadingText.textContent = `正在加载资源... ${Math.round(p * 100)}%`;
  });
  loadingText.textContent = '正在生成世界...';
  await new Promise(r => setTimeout(r, 30));

  track = new Track();
  world = new World(scene, renderer, track, assets);
  player = new PlayerCar(track, assets, scene, 0xd4111b);
  player.placeAt(track.length - 12, -2.6);
  hud = new HUD(track);
  particles = new Particles(scene);
  traffic = new Traffic(track, assets, scene, 10);
  traffic.setVisible(false);

  racers = AI_DEFS.map(d => {
    const r = new RacerAI(track, assets, scene, d.color, d.skill);
    r.name = d.name;
    r.group.visible = false;
    return r;
  });

  document.getElementById('loading-screen').classList.add('hidden');
  window.__game = {
    get state() { return state; },
    get player() { return player; },
    get track() { return track; },
    get racers() { return racers; },
    get traffic() { return traffic; },
    get audio() { return audio; },
    get raceInfo() { return { raceTime, playerLap, nextCp, raceLaps, roadDist: player.roadDist, trackS: player.trackS }; },
    get renderInfo() { return renderer.info.render; }
  };
  showMenu();
  requestAnimationFrame(loop);
}

// ---------------- 菜单 / 状态切换 ----------------
const menuScreen = document.getElementById('menu-screen');
const resultScreen = document.getElementById('result-screen');

function showMenu() {
  state = 'menu';
  menuScreen.classList.remove('hidden');
  resultScreen.classList.add('hidden');
  hud.hide();
  world.hideGates();
  audio.stopAll();
}

async function ensureAudio() {
  if (!audio.ready) {
    loadingText.textContent = '';
    await audio.init(assets.soundData);
  }
  audio.resume();
}

function startRace(mode) {
  raceMode = mode;
  raceLaps = mode === 'circuit' ? 3 : 1;
  raceTime = 0;
  playerLap = -1;
  nextCp = 10;
  playerFinished = false;
  finishDelay = 0;
  driftPoints = 0;

  player.placeAt(track.length - 33, -2.6);
  player.frozen = true;
  player.nitro = 100;

  racers.forEach((r, i) => {
    r.group.visible = true;
    r.finished = false;
    r.frozen = true;
    r.placeAt(track.length - 12 - i * 7, (i % 2 === 0 ? 2.7 : -2.7));
    r.lap = -1;
  });

  traffic.setVisible(false);

  const cps = [];
  for (let i = 1; i < CP_COUNT; i++) cps.push(i * track.length / CP_COUNT);
  world.buildCheckpointGates(cps);
  world.setGateHighlight(-1);

  menuScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  hud.show();
  hud.setRaceVisible(true);
  hud.showBanner(mode === 'circuit' ? '环形赛 · CIRCUIT RACE' : '冲刺赛 · HORIZON SPRINT', 2400);

  countdownT = 3.8;
  state = 'countdown';
}

function startFree() {
  raceMode = null;
  player.placeAt(track.length - 12, -2.6);
  player.frozen = false;
  racers.forEach(r => r.group.visible = false);
  traffic.setVisible(true);
  world.hideGates();
  menuScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  hud.show();
  hud.setRaceVisible(false);
  hud.showBanner('自由漫游 · 墨西哥高原', 2600);
  state = 'free';
}

document.getElementById('btn-race').addEventListener('click', async () => { await ensureAudio(); startRace('sprint'); });
document.getElementById('btn-circuit').addEventListener('click', async () => { await ensureAudio(); startRace('circuit'); });
document.getElementById('btn-free').addEventListener('click', async () => { await ensureAudio(); startFree(); });
document.getElementById('btn-again').addEventListener('click', () => startRace(raceMode || 'sprint'));
document.getElementById('btn-menu').addEventListener('click', showMenu);

function handleKeyPress(code) {
  if (code === 'Escape') {
    if (state === 'race' || state === 'free' || state === 'countdown' || state === 'result') showMenu();
    return;
  }
  if (state !== 'race' && state !== 'free') return;
  if (code === 'KeyR') player.resetToRoad();
  if (code === 'KeyC') camMode = (camMode + 1) % 3;
  if (code === 'KeyM') {
    const on = audio.toggleMusic();
    hud.showBanner(on ? '♪ 音乐开启' : '♪ 音乐关闭', 1000);
  }
}

// ---------------- 碰撞 ----------------
const _v = new THREE.Vector3();
function collidePlayer(dt) {
  const sin = Math.sin(player.heading), cos = Math.cos(player.heading);

  const hitCircle = (cx, cz, cr) => {
    const dx = player.pos.x - cx, dz = player.pos.z - cz;
    const rr = cr + 1.15;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      player.pos.x = cx + nx * rr;
      player.pos.z = cz + nz * rr;
      let vx = sin * player.vf + cos * player.vl;
      let vz = cos * player.vf - sin * player.vl;
      const vn = vx * nx + vz * nz;
      let impact = 0;
      if (vn < 0) {
        impact = -vn;
        vx -= vn * nx * 1.55;
        vz -= vn * nz * 1.55;
      }
      player.vf = (vx * sin + vz * cos) * 0.85;
      player.vl = (vx * cos - vz * sin) * 0.6;
      if (impact > 3.5) {
        audio.playCrash(impact / 22);
        if (impact > 8) hud.showSkill('碰撞!');
      }
      return true;
    }
    return false;
  };

  for (const c of world.colliders) {
    if (Math.abs(player.pos.x - c.x) > c.r + 3 || Math.abs(player.pos.z - c.z) > c.r + 3) continue;
    hitCircle(c.x, c.z, c.r);
  }

  if (traffic.visible) {
    for (const c of traffic.cars) {
      if (c.x === undefined) continue;
      const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
      const d2 = dx * dx + dz * dz;
      const hit = hitCircle(c.x, c.z, c.r);
      if (!hit && !c.nearMissCd && Math.abs(player.vf) > 18 && d2 < 4.5 * 4.5) {
        c.nearMissCd = 3;
        hud.showSkill('擦身而过 +500');
      }
      if (c.nearMissCd) c.nearMissCd = Math.max(0, c.nearMissCd - dt);
    }
  }

  for (const r of racers) {
    if (!r.group.visible || !r.pos) continue;
    hitCircle(r.pos.x, r.pos.z, 1.4);
  }
}

// ---------------- 比赛逻辑 ----------------
function wrapDs(ds) {
  const L = track.length;
  while (ds > L / 2) ds -= L;
  while (ds < -L / 2) ds += L;
  return ds;
}

function updateRaceLogic(dt) {
  raceTime += dt;

  if (!playerFinished) {
    const spacing = track.length / CP_COUNT;
    const cpS = (nextCp % CP_COUNT) * spacing;
    const ds = wrapDs(player.trackS - cpS);
    if (ds >= 0 && ds < spacing &&
        player.roadDist < ROAD_HALF + 10 && player.vf > 0) {
      if (nextCp === CP_COUNT) {
        playerLap++;
        if (playerLap >= raceLaps) {
          playerFinished = true;
          finishDelay = 1.6;
          hud.showBanner('🏁 完赛!', 1600);
        } else {
          nextCp = 1;
          if (playerLap > 0) hud.showSkill(`第 ${playerLap + 1} 圈!`);
        }
      } else {
        nextCp++;
        hud.showSkill('✓ 检查点');
      }
    }
  }
  world.setGateHighlight(nextCp >= 1 && nextCp <= 9 ? nextCp - 1 : -1);

  const playerProg = playerLap * track.length + player.trackS;
  racers.forEach(r => r.update(dt, playerProg, raceTime, raceLaps, player));

  let pos = 1;
  racers.forEach(r => { if (r.progress > playerProg) pos++; });
  hud.updateRace(pos, racers.length + 1,
    Math.min(Math.max(playerLap, 0) + 1, raceLaps), raceLaps, raceTime);

  const tangent = track.tan[player.hintIdx];
  const fdot = Math.sin(player.heading) * tangent.x + Math.cos(player.heading) * tangent.y;
  if (fdot < -0.4 && player.vf > 4) {
    wrongWayT += dt;
    if (wrongWayT > 1.6) { hud.showBanner('⚠ 逆行! 按 R 重置', 900); wrongWayT = 1.0; }
  } else wrongWayT = 0;

  if (playerFinished) {
    finishDelay -= dt;
    if (finishDelay <= 0) showResults(pos);
  }
}

function showResults(pos) {
  state = 'result';
  const rows = [];
  rows.push({ name: '你 (玩家)', time: raceTime, me: true });
  racers.forEach(r => {
    let t;
    if (r.finished) t = r.finishTime;
    else {
      const remain = raceLaps * track.length - r.progress;
      t = raceTime + Math.max(0, remain) / Math.max(20, r.v);
    }
    rows.push({ name: r.name, time: t, me: false });
  });
  rows.sort((a, b) => a.time - b.time);

  const rank = rows.findIndex(r => r.me) + 1;
  document.getElementById('result-title').textContent =
    raceMode === 'circuit' ? '环形赛 · 结束' : '冲刺赛 · 结束';
  document.getElementById('result-pos').textContent =
    rank === 1 ? '🏆 第 1 名' : `第 ${rank} 名`;
  document.getElementById('result-time').textContent = `总时间 ${formatTime(raceTime)}`;
  document.getElementById('result-rows').innerHTML = rows.map((r, i) =>
    `<div class="${r.me ? 'me' : ''}">${i + 1}. ${r.name} — ${formatTime(r.time)}</div>`
  ).join('');
  resultScreen.classList.remove('hidden');
}

// ---------------- 特效 ----------------
const _rw = new THREE.Vector3();
function updateEffects(dt) {
  const spd = Math.abs(player.vf);

  if (player.slip > 3.2 && spd > 10 && !player.offroad) {
    for (const side of [-1, 1]) {
      player.rearWorldPos(_rw, side);
      if (Math.random() < dt * 40) {
        particles.spawn(_rw.x, _rw.y, _rw.z, { size: 2.0, life: 0.8, color: [0.92, 0.92, 0.95] });
      }
    }
  }
  if (player.offroad && spd > 8) {
    player.rearWorldPos(_rw, 0);
    if (Math.random() < dt * 30) {
      particles.spawn(_rw.x, _rw.y, _rw.z, { size: 2.4, life: 1.0, color: [0.62, 0.5, 0.36] });
    }
  }
  if (player.nitroActive) {
    for (const side of [-1, 1]) {
      player.rearWorldPos(_rw, side * 0.4);
      particles.spawn(_rw.x, _rw.y - 0.1, _rw.z, {
        size: 1.1, life: 0.35, color: [0.4, 0.7, 1.0], vy: 0.4
      });
    }
  }
  particles.update(dt);

  const drifting = player.slip > 3.2 && player.speedKmh > 45 && !player.offroad;
  if (drifting) {
    driftPoints += player.slip * dt * 32;
    driftGrace = 0.7;
  } else if (driftGrace > 0) {
    driftGrace -= dt;
    if (driftGrace <= 0 && driftPoints > 120) {
      hud.showSkill(`漂移 +${Math.round(driftPoints)}`);
      driftPoints = 0;
    } else if (driftGrace <= 0) driftPoints = 0;
  }

  if (player.nitroActive && !nitroWasActive) audio.playBoost();
  nitroWasActive = player.nitroActive;
}

// ---------------- 相机 ----------------
const CAMS = [
  { back: 10.8, up: 3.7, look: 1.3, ahead: 7, fov: 60 },
  { back: 7.0, up: 2.5, look: 1.0, ahead: 6, fov: 64 },
  { back: -0.2, up: 1.18, look: 1.0, ahead: 14, fov: 72 }
];

function updateCamera(dt) {
  const c = CAMS[camMode];
  const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
  const speedNorm = Math.min(1, Math.abs(player.vf) / 86);

  const tx = player.pos.x - sin * c.back;
  const ty = player.pos.y + c.up;
  const tz = player.pos.z - cos * c.back;

  if (camMode === 2) {
    camPos.set(tx, ty, tz);
  } else {
    const k = 1 - Math.exp(-dt * 5.5);
    camPos.x += (tx - camPos.x) * k;
    camPos.z += (tz - camPos.z) * k;
    camPos.y += (ty - camPos.y) * (1 - Math.exp(-dt * 7));
    const minY = player.pos.y + 1.2;
    if (camPos.y < minY) camPos.y = minY;
  }

  const lx = player.pos.x + sin * c.ahead;
  const ly = player.pos.y + c.look;
  const lz = player.pos.z + cos * c.ahead;
  const lk = 1 - Math.exp(-dt * 10);
  camLook.x += (lx - camLook.x) * lk;
  camLook.y += (ly - camLook.y) * lk;
  camLook.z += (lz - camLook.z) * lk;

  let shakeX = 0, shakeY = 0;
  if (speedNorm > 0.55) {
    const sh = (speedNorm - 0.55) * 0.16 + (player.nitroActive ? 0.05 : 0);
    shakeX = (Math.random() - 0.5) * sh;
    shakeY = (Math.random() - 0.5) * sh;
  }

  camera.position.set(camPos.x + shakeX, camPos.y + shakeY, camPos.z);
  camera.lookAt(camLook);

  const fovT = c.fov + speedNorm * 15 + (player.nitroActive ? 8 : 0);
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// ---------------- 主循环 ----------------
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (dt <= 0) dt = 0.016;
  const time = now / 1000;

  if (state === 'loading' || state === 'menu') {
    if (world) {
      const a = time * 0.05;
      const R = 420;
      camera.position.set(Math.cos(a) * R, 90, Math.sin(a) * R);
      camera.lookAt(0, 0, 0);
      camera.fov = 55;
      camera.updateProjectionMatrix();
      world.update(dt, time);
      renderer.render(scene, camera);
    }
    return;
  }

  const input = readInput();

  if (state === 'countdown') {
    countdownT -= dt;
    if (countdownT > 1) {
      hud.showCountdown(String(Math.ceil(countdownT - 1)));
    } else {
      hud.showCountdown('GO!');
      player.frozen = false;
      racers.forEach(r => r.frozen = false);
      state = 'race';
      setTimeout(() => hud.showCountdown(null), 900);
    }
    player.update(dt, { ...input, steer: 0, brake: 0 });
    hud.updateRace(racers.length + 1, racers.length + 1, 1, raceLaps, 0);
  } else if (state === 'race') {
    player.update(dt, playerFinished ? { throttle: 0, brake: 0.4, steer: 0, handbrake: false, nitro: false } : input);
    collidePlayer(dt);
    updateRaceLogic(dt);
    updateEffects(dt);
  } else if (state === 'free') {
    player.update(dt, input);
    traffic.update(dt);
    collidePlayer(dt);
    updateEffects(dt);
  } else if (state === 'result') {
    player.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false });
    racers.forEach(r => r.update(dt, 0, raceTime, raceLaps));
  }

  audio.setEngine(
    player.rpm, player.throttle,
    Math.min(1, Math.abs(player.vf) / 86),
    player.slip, player.offroad, dt
  );

  world.update(dt, time);
  world.updateSun(player.pos);
  updateCamera(dt);

  hud.drawSpeedo(player);
  const cpS = (state === 'race' && !playerFinished)
    ? ((nextCp % CP_COUNT) * track.length / CP_COUNT) : null;
  hud.drawMinimap(player,
    racers.filter(r => r.group.visible),
    traffic, cpS, state === 'race');

  renderer.render(scene, camera);
}

boot().catch(e => {
  loadingText.textContent = '加载失败: ' + e.message;
  console.error(e);
});
