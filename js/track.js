import * as THREE from 'three';

export function terrainHeightRaw(x, z) {
  return (
    3.2 * Math.sin(x * 0.008) * Math.cos(z * 0.006) +
    2.0 * Math.sin(x * 0.02 + 1.7) * Math.sin(z * 0.016) +
    1.2 * Math.sin((x + z) * 0.01) +
    0.6 * Math.sin(x * 0.05) * Math.cos(z * 0.043)
  );
}

const CONTROL_POINTS = [
  [-40, -260], [180, -300], [360, -220], [430, -40],
  [380, 140], [420, 320], [260, 430], [40, 380],
  [-140, 430], [-330, 350], [-420, 160], [-380, -60],
  [-300, -220], [-160, -320]
];

export const ROAD_WIDTH = 13;
export const ROAD_HALF = ROAD_WIDTH / 2;

export class Track {
  constructor() {
    const pts = CONTROL_POINTS.map(p => new THREE.Vector3(p[0], 0, p[1]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    this.N = 2048;
    this.pos = [];
    this.tan = [];
    this.arc = [];
    this.roadY = [];

    let len = 0;
    let prev = null;
    for (let i = 0; i < this.N; i++) {
      const t = i / this.N;
      const p = this.curve.getPointAt(t);
      const tg = this.curve.getTangentAt(t);
      p.y = terrainHeightRaw(p.x, p.z);
      if (prev) len += Math.hypot(p.x - prev.x, p.z - prev.z);
      this.pos.push(p);
      this.tan.push(new THREE.Vector2(tg.x, tg.z).normalize());
      this.arc.push(len);
      prev = p;
    }
    this.length = len + Math.hypot(
      this.pos[0].x - prev.x, this.pos[0].z - prev.z);

    for (let i = 0; i < this.N; i++) this.roadY.push(this.pos[i].y);
    for (let pass = 0; pass < 3; pass++) {
      const sm = [];
      for (let i = 0; i < this.N; i++) {
        let s = 0;
        for (let k = -4; k <= 4; k++) s += this.roadY[(i + k + this.N) % this.N];
        sm.push(s / 9);
      }
      this.roadY = sm;
    }

    this.curvature = [];
    for (let i = 0; i < this.N; i++) {
      const a = this.tan[(i - 4 + this.N) % this.N];
      const b = this.tan[(i + 4) % this.N];
      const ds = this.arcDelta(i - 4, i + 4);
      let dAng = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
      this.curvature.push(dAng / Math.max(ds, 0.001));
    }

    const A_LAT = 14.5, A_BRAKE = 11, A_ACC = 8.5, VMAX = 64;
    let v = [];
    for (let i = 0; i < this.N; i++) {
      v.push(Math.min(VMAX, Math.sqrt(A_LAT / Math.max(this.curvature[i], 0.0004))));
    }
    for (let pass = 0; pass < 4; pass++) {
      for (let i = this.N - 1; i >= 0; i--) {
        const nx = (i + 1) % this.N;
        const ds = this.arcDelta(i, i + 1);
        v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * A_BRAKE * ds));
      }
      for (let i = 0; i < this.N; i++) {
        const pv = (i - 1 + this.N) % this.N;
        const ds = this.arcDelta(i - 1, i);
        v[i] = Math.min(v[i], Math.sqrt(v[pv] * v[pv] + 2 * A_ACC * ds));
      }
    }
    this.targetSpeed = v;
  }

  arcDelta(i0, i1) {
    const a = this.arc[(i0 + this.N) % this.N];
    const b = this.arc[(i1 + this.N) % this.N];
    let d = b - a;
    if (d < 0) d += this.length;
    return d;
  }

  idxAtS(s) {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0, hi = this.N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.arc[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  sampleAtS(s, lateral = 0) {
    s = ((s % this.length) + this.length) % this.length;
    const i = this.idxAtS(s);
    const j = (i + 1) % this.N;
    const segLen = this.arcDelta(i, i + 1);
    const f = segLen > 0 ? (s - this.arc[i]) / segLen : 0;
    const p0 = this.pos[i], p1 = this.pos[j];
    const t0 = this.tan[i], t1 = this.tan[j];
    const tx = t0.x + (t1.x - t0.x) * f;
    const tz = t0.y + (t1.y - t0.y) * f;
    const tl = Math.hypot(tx, tz) || 1;
    const fx = tx / tl, fz = tz / tl;
    const rx = -fz, rz = fx;
    const y = this.roadY[i] + (this.roadY[j] - this.roadY[i]) * f;
    return {
      x: p0.x + (p1.x - p0.x) * f + rx * lateral,
      y,
      z: p0.z + (p1.z - p0.z) * f + rz * lateral,
      fx, fz,
      heading: Math.atan2(fx, fz)
    };
  }

  nearest(x, z, hint = -1) {
    let bestI = 0, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -50; k <= 50; k++) {
        const i = (hint + k + this.N) % this.N;
        const p = this.pos[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestD < 60 * 60) return { idx: bestI, dist: Math.sqrt(bestD), s: this.arc[bestI] };
    }
    bestD = Infinity;
    for (let i = 0; i < this.N; i += 4) {
      const p = this.pos[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    for (let k = -4; k <= 4; k++) {
      const i = (bestI + k + this.N) % this.N;
      const p = this.pos[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return { idx: bestI, dist: Math.sqrt(bestD), s: this.arc[bestI] };
  }

  distToRoad(x, z) {
    return this.nearest(x, z).dist;
  }

  heightAt(x, z, roadDist = null) {
    const raw = terrainHeightRaw(x, z);
    let d = roadDist;
    let roadH = null;
    if (d === null) {
      const n = this.nearest(x, z);
      d = n.dist;
      roadH = this.roadY[n.idx];
    }
    if (d >= 42) return raw;
    if (roadH === null) {
      const n = this.nearest(x, z);
      roadH = this.roadY[n.idx];
    }
    if (d <= 10) return roadH;
    const f = (d - 10) / 32;
    const sm = f * f * (3 - 2 * f);
    return roadH * (1 - sm) + raw * sm;
  }
}
