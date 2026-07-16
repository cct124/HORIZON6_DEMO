import * as THREE from 'three';
import { buildFerrariVisual } from './car.js';

export class RacerAI {
  constructor(track, assets, scene, color, skill) {
    this.track = track;
    const vis = buildFerrariVisual(assets, color);
    this.group = vis.group;
    this.wheels = vis.wheels;
    this.frontWheels = vis.frontWheels;
    this.spinSign = vis.spinSign;
    scene.add(this.group);

    this.s = 0;
    this.v = 0;
    this.lap = 0;
    this.lateral = 0;
    this.lateralTarget = (Math.random() - 0.5) * 4;
    this.skill = skill;
    this.finished = false;
    this.finishTime = 0;
    this.wheelSpin = 0;
    this.heading = 0;
    this.frozen = true;
    this.name = '';
  }

  placeAt(s, lateral) {
    this.s = s;
    this.lap = 0;
    this.v = 0;
    this.lateral = lateral;
    this.lateralTarget = lateral;
    this.sync(0);
  }

  get progress() { return this.lap * this.track.length + this.s; }

  update(dt, playerProgress, raceTime, totalLaps, playerCar) {
    if (this.frozen || this.finished) { this.sync(dt); return; }
    const t = this.track;
    const idx = t.idxAtS((this.s + this.v * 1.2) % t.length);
    let vt = t.targetSpeed[idx] * this.skill;

    const gap = this.progress - playerProgress;
    if (gap > 120) vt *= 0.93;
    else if (gap < -160) vt *= 1.07;

    if (playerCar && this.pos) {
      const dx = playerCar.pos.x - this.pos.x;
      const dz = playerCar.pos.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 14 * 14) {
        const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
        const ahead = dx * sin + dz * cos;
        if (ahead > 0) {
          const d = Math.sqrt(d2);
          const pv = Math.abs(playerCar.vf);
          const factor = THREE.MathUtils.clamp((d - 4) / 10, 0, 1);
          vt = Math.min(vt, pv + (vt - pv) * factor);
          const side = dx * cos - dz * sin;
          this.lateralTarget = THREE.MathUtils.clamp(
            this.lateral + (side > 0 ? -2.5 : 2.5), -4.5, 4.5);
        }
      }
    }

    const a = THREE.MathUtils.clamp((vt - this.v) * 1.4, -12, 8.5);
    this.v = Math.max(0, this.v + a * dt);

    const prevS = this.s;
    this.s += this.v * dt;
    if (this.s >= t.length) {
      this.s -= t.length;
      this.lap++;
      if (this.lap >= totalLaps) {
        this.finished = true;
        this.finishTime = raceTime;
      }
    }

    if (Math.random() < dt * 0.15) this.lateralTarget = (Math.random() - 0.5) * 4.5;
    this.lateral += (this.lateralTarget - this.lateral) * Math.min(1, dt * 0.8);

    this.sync(dt);
  }

  sync(dt) {
    const t = this.track;
    const smp = t.sampleAtS(this.s, this.lateral);
    const ahead = t.sampleAtS(this.s + 3, this.lateral);
    this.group.position.set(smp.x, smp.y, smp.z);
    const targetHeading = smp.heading;
    let dh = targetHeading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * Math.min(1, (dt || 0.016) * 10);
    this.group.rotation.y = this.heading;
    this.group.rotation.x = Math.atan2(smp.y - ahead.y, 3);
    this.wheelSpin += (this.v / 0.34) * (dt || 0);
    this.wheels.forEach(w => { w.rotation.x = this.wheelSpin * this.spinSign; });
    this.pos = this.group.position;
  }
}

function buildKenneyCar(gltf, targetLen = 4.3) {
  const model = gltf.scene.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const len = box.max.z - box.min.z || 1;
  const scl = targetLen / len;
  const wrap = new THREE.Group();
  model.scale.setScalar(scl);
  model.position.set(
    -(box.max.x + box.min.x) / 2 * scl,
    -box.min.y * scl,
    -(box.max.z + box.min.z) / 2 * scl
  );
  model.traverse(o => { if (o.isMesh) o.castShadow = true; });
  wrap.add(model);
  return wrap;
}

export class Traffic {
  constructor(track, assets, scene, count = 10) {
    this.track = track;
    this.cars = [];
    const kinds = ['sedan', 'suv', 'taxi', 'van', 'police', 'truck'];
    for (let i = 0; i < count; i++) {
      const kind = kinds[i % kinds.length];
      const mesh = buildKenneyCar(assets.models[kind], kind === 'truck' || kind === 'van' ? 5 : 4.2);
      scene.add(mesh);
      const dir = i % 2 === 0 ? 1 : -1;
      this.cars.push({
        mesh, dir,
        s: (i / count) * track.length + Math.random() * 60,
        v: 10 + Math.random() * 5,
        lateral: dir === 1 ? -3.4 : 3.4,
        r: 1.5
      });
    }
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.cars.forEach(c => c.mesh.visible = v);
  }

  update(dt) {
    if (!this.visible) return;
    const t = this.track;
    this.cars.forEach(c => {
      c.s += c.dir * c.v * dt;
      c.s = ((c.s % t.length) + t.length) % t.length;
      const smp = t.sampleAtS(c.s, c.lateral);
      c.mesh.position.set(smp.x, smp.y, smp.z);
      c.mesh.rotation.y = smp.heading + (c.dir === -1 ? Math.PI : 0);
      c.x = smp.x; c.z = smp.z;
    });
  }
}
