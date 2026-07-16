export class HUD {
  constructor(track) {
    this.track = track;
    this.speedoCtx = document.getElementById('speedo').getContext('2d');
    this.mapCanvas = document.getElementById('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');

    this.el = {
      hud: document.getElementById('hud'),
      raceInfo: document.getElementById('race-info'),
      position: document.getElementById('race-position'),
      total: document.getElementById('race-total'),
      lap: document.getElementById('race-lap'),
      time: document.getElementById('race-time'),
      countdown: document.getElementById('countdown'),
      banner: document.getElementById('event-banner'),
      skill: document.getElementById('skill-popup'),
    };

    this.mapPts = [];
    const N = 256;
    for (let i = 0; i < N; i++) {
      const p = track.pos[Math.floor(i * track.N / N)];
      this.mapPts.push([p.x, p.z]);
    }
    this.skillTimer = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  showBanner(text, ms = 2200) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    clearTimeout(this._bannerT);
    if (ms > 0) {
      this._bannerT = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
    }
  }

  showCountdown(text) {
    if (text === null) { this.el.countdown.classList.add('hidden'); this._cdText = null; return; }
    if (this._cdText === text) return;
    this._cdText = text;
    this.el.countdown.textContent = text;
    this.el.countdown.classList.remove('hidden');
    this.el.countdown.style.animation = 'none';
    void this.el.countdown.offsetWidth;
    this.el.countdown.style.animation = '';
  }

  showSkill(text) {
    const el = this.el.skill;
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._skillT);
    this._skillT = setTimeout(() => el.classList.add('hidden'), 1200);
  }

  setRaceVisible(v) {
    this.el.raceInfo.classList.toggle('hidden', !v);
  }

  updateRace(pos, total, lap, laps, time) {
    this.el.position.textContent = pos;
    this.el.total.textContent = total;
    this.el.lap.textContent = `第 ${lap}/${laps} 圈`;
    this.el.time.textContent = formatTime(time);
  }

  drawSpeedo(car) {
    const g = this.speedoCtx;
    const W = 300, H = 300;
    g.clearRect(0, 0, W, H);
    const cx = 158, cy = 168, R = 118;

    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;

    g.lineWidth = 14;
    g.strokeStyle = 'rgba(10,12,24,0.65)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();

    const rpmA = a0 + (a1 - a0) * Math.min(1, car.rpm);
    const grad = g.createLinearGradient(cx - R, cy, cx + R, cy);
    grad.addColorStop(0, '#b800ff');
    grad.addColorStop(1, '#ff2d78');
    g.strokeStyle = grad;
    g.beginPath();
    g.arc(cx, cy, R, a0, rpmA);
    g.stroke();

    g.strokeStyle = 'rgba(255,60,60,0.9)';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(cx, cy, R, a0 + (a1 - a0) * 0.9, a1);
    g.globalAlpha = 0.35;
    g.stroke();
    g.globalAlpha = 1;

    g.fillStyle = 'rgba(200,210,230,0.8)';
    g.font = '11px "Segoe UI"';
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * i / 10;
      const x1 = cx + Math.cos(a) * (R - 14), y1 = cy + Math.sin(a) * (R - 14);
      const x2 = cx + Math.cos(a) * (R - 22), y2 = cy + Math.sin(a) * (R - 22);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = 'italic 900 58px "Segoe UI"';
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 10;
    g.fillText(Math.round(car.speedKmh), cx, cy + 8);
    g.shadowBlur = 0;
    g.font = '600 15px "Segoe UI"';
    g.fillStyle = 'rgba(200,210,230,0.75)';
    g.fillText('km/h', cx, cy + 32);

    g.font = 'italic 900 30px "Segoe UI"';
    g.fillStyle = '#ffd166';
    const gearTxt = car.gear === 0 ? 'R' : String(car.gear);
    g.fillText(gearTxt, cx, cy + 66);
    g.font = '600 11px "Segoe UI"';
    g.fillStyle = 'rgba(200,210,230,0.6)';
    g.fillText('档位', cx, cy + 82);

    const bw = 130, bx = cx - bw / 2, by = cy + 96;
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(bx, by, bw, 7);
    const ng = g.createLinearGradient(bx, 0, bx + bw, 0);
    ng.addColorStop(0, '#00c2ff');
    ng.addColorStop(1, '#00ffb3');
    g.fillStyle = ng;
    g.fillRect(bx, by, bw * car.nitro / 100, 7);
    g.fillStyle = 'rgba(200,210,230,0.7)';
    g.font = '600 10px "Segoe UI"';
    g.fillText('NITRO · 氮气', cx, by + 20);
  }

  drawMinimap(player, racers, traffic, nextCpS, raceMode) {
    const g = this.mapCtx;
    const S = 220, C = S / 2;
    g.clearRect(0, 0, S, S);

    g.save();
    g.beginPath();
    g.arc(C, C, C - 3, 0, Math.PI * 2);
    g.clip();

    g.fillStyle = 'rgba(10,14,26,0.35)';
    g.fillRect(0, 0, S, S);

    const scale = 0.30;
    g.translate(C, C);
    g.rotate(-(Math.PI - player.heading));
    g.translate(-player.pos.x * scale, -player.pos.z * scale);

    g.strokeStyle = 'rgba(230,235,245,0.85)';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.beginPath();
    this.mapPts.forEach((p, i) => {
      const x = p[0] * scale, y = p[1] * scale;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.stroke();

    if (raceMode && nextCpS !== null) {
      const cp = this.track.sampleAtS(nextCpS, 0);
      g.fillStyle = '#18a0ff';
      g.beginPath();
      g.arc(cp.x * scale, cp.z * scale, 5, 0, Math.PI * 2);
      g.fill();
    }

    const st = this.track.pos[0];
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(st.x * scale, st.z * scale, 4, 0, Math.PI * 2);
    g.fill();

    if (racers) {
      g.fillStyle = '#ff5555';
      racers.forEach(r => {
        g.beginPath();
        g.arc(r.pos.x * scale, r.pos.z * scale, 4, 0, Math.PI * 2);
        g.fill();
      });
    }
    if (traffic && traffic.visible) {
      g.fillStyle = 'rgba(255,255,255,0.6)';
      traffic.cars.forEach(c => {
        g.beginPath();
        g.arc(c.x * scale, c.z * scale, 2.5, 0, Math.PI * 2);
        g.fill();
      });
    }
    g.restore();

    g.save();
    g.translate(C, C);
    g.fillStyle = '#ff2d78';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fill();
    g.restore();
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
