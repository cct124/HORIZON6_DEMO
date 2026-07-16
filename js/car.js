import * as THREE from 'three';
import { ROAD_HALF } from './track.js';

export function buildFerrariVisual(assets, bodyColor) {
  const gltf = assets.models.ferrari;
  const carModel = gltf.scene.children[0].clone(true);
  carModel.rotation.y = Math.PI;

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: bodyColor, metalness: 1.0, roughness: 0.4,
    clearcoat: 1.0, clearcoatRoughness: 0.03
  });
  const detailsMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1.0, roughness: 0.4
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.25, roughness: 0,
    transmission: 1.0, transparent: true
  });

  const body = carModel.getObjectByName('body');
  if (body) body.material = bodyMaterial;
  ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim'].forEach(n => {
    const o = carModel.getObjectByName(n);
    if (o) o.material = detailsMaterial;
  });
  const glass = carModel.getObjectByName('glass');
  if (glass) glass.material = glassMaterial;

  const wheels = [];
  const frontWheels = [];
  ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach(n => {
    const w = carModel.getObjectByName(n);
    if (w) {
      w.rotation.order = 'YXZ';
      wheels.push(w);
      if (n === 'wheel_fl' || n === 'wheel_fr') frontWheels.push(w);
    }
  });

  carModel.traverse(o => { if (o.isMesh) o.castShadow = true; });

  const shadowTex = assets.textures.ferrariAO;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
    new THREE.MeshBasicMaterial({
      map: shadowTex, blending: THREE.MultiplyBlending,
      toneMapped: false, transparent: true, depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 2;
  carModel.add(shadow);

  const group = new THREE.Group();
  group.add(carModel);
  group.rotation.order = 'YXZ';
  return { group, wheels, frontWheels, bodyMaterial, spinSign: -1 };
}

export class PlayerCar {
  constructor(track, assets, scene, color = 0xd4111b) {
    this.track = track;
    const vis = buildFerrariVisual(assets, color);
    this.group = vis.group;
    this.wheels = vis.wheels;
    this.frontWheels = vis.frontWheels;
    this.spinSign = vis.spinSign;
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vf = 0;
    this.vl = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.nitro = 100;
    this.nitroActive = false;
    this.hintIdx = 0;
    this.roadDist = 0;
    this.offroad = false;
    this.rpm = 0.1;
    this.gear = 1;
    this.throttle = 0;
    this.slip = 0;
    this.frozen = true;

    this.WHEELBASE = 2.6;
    this.VMAX = 86;
    this.VMAX_REV = -14;
    this.ACCEL = 15.5;
    this.BRAKE = 22;

    this.gearSpeeds = [0, 14, 25, 38, 52, 66, 80, 95];
  }

  placeAt(s, lateral = 0, reverse = false) {
    const smp = this.track.sampleAtS(s, lateral);
    this.pos.set(smp.x, smp.y, smp.z);
    this.heading = smp.heading + (reverse ? Math.PI : 0);
    this.vf = 0; this.vl = 0;
    this.hintIdx = this.track.idxAtS(s);
    this.syncVisual(0);
  }

  resetToRoad() {
    const n = this.track.nearest(this.pos.x, this.pos.z, this.hintIdx);
    const smp = this.track.sampleAtS(this.track.arc[n.idx], 0);
    this.pos.set(smp.x, smp.y, smp.z);
    const forwardDot = Math.sin(this.heading) * smp.fx + Math.cos(this.heading) * smp.fz;
    this.heading = smp.heading + (forwardDot < 0 ? Math.PI : 0);
    this.vf = 0; this.vl = 0;
  }

  update(dt, input) {
    const t = this.track;
    const n = t.nearest(this.pos.x, this.pos.z, this.hintIdx);
    this.hintIdx = n.idx;
    this.roadDist = n.dist;
    this.trackS = t.arc[n.idx];
    this.offroad = n.dist > ROAD_HALF + 1.6;

    if (this.frozen) {
      this.throttle = input.throttle;
      this.rpm += ((input.throttle * 0.85 + 0.12) - this.rpm) * Math.min(1, dt * 6);
      this.syncVisual(dt);
      return;
    }

    const vAbs = Math.abs(this.vf);
    const gripSteer = Math.min(0.62, (14 * this.WHEELBASE) / Math.max(6, vAbs * vAbs));
    const steerMax = input.handbrake ? Math.min(0.62, gripSteer * 2.6) : gripSteer;
    const steerTarget = input.steer * steerMax;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);

    this.nitroActive = input.nitro && this.nitro > 1 && this.vf > 2;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - 38 * dt);
    else this.nitro = Math.min(100, this.nitro + 7 * dt);

    const nitroMul = this.nitroActive ? 1.55 : 1;
    const vmax = this.VMAX * (this.nitroActive ? 1.14 : 1);

    let a = 0;
    this.throttle = 0;
    if (input.throttle > 0) {
      this.throttle = input.throttle;
      const ratio = Math.max(0, this.vf) / vmax;
      a += this.ACCEL * nitroMul * (1 - ratio * ratio * ratio) * input.throttle;
    }
    if (input.brake > 0) {
      if (this.vf > 0.6) a -= this.BRAKE * input.brake;
      else a -= this.ACCEL * 0.55 * input.brake;
    }

    a -= this.vf * 0.00045 * Math.abs(this.vf);
    a -= Math.sign(this.vf) * 0.6;

    if (this.offroad) {
      a -= this.vf * 0.004 * Math.abs(this.vf);
      if (this.vf > 26) a -= (this.vf - 26) * 2.2;
    }

    this.vf += a * dt;
    if (this.vf < this.VMAX_REV) this.vf = this.VMAX_REV;

    const handbrake = input.handbrake && Math.abs(this.vf) > 3;
    let grip = handbrake ? 1.5 : 7.0;
    if (this.offroad) grip *= 0.55;

    const speedFactor = Math.min(1, Math.abs(this.vf) / 6);
    let yawRate = (this.vf / this.WHEELBASE) * Math.tan(this.steer) * speedFactor;
    if (handbrake) yawRate *= 1.45;
    this.heading += yawRate * dt;

    this.vl += -yawRate * Math.abs(this.vf) * 0.24 * dt * (handbrake ? 3.2 : 1.4);
    this.vl *= Math.exp(-grip * dt);
    const vlMax = Math.max(3, Math.abs(this.vf) * 0.55);
    this.vl = THREE.MathUtils.clamp(this.vl, -vlMax, vlMax);
    if (handbrake) this.vf *= Math.exp(-0.35 * dt);

    this.slip = Math.abs(this.vl);

    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const vx = sin * this.vf + cos * this.vl;
    const vz = cos * this.vf - sin * this.vl;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    const R = 950;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > R) {
      this.pos.x *= R / rr; this.pos.z *= R / rr;
      this.vf *= 0.5;
    }

    let gear = 1;
    const sp = Math.abs(this.vf);
    for (let g = 1; g < this.gearSpeeds.length; g++) {
      if (sp > this.gearSpeeds[g - 1]) gear = g;
    }
    this.gear = this.vf < -0.5 ? 0 : gear;
    const lo = this.gearSpeeds[gear - 1], hi = this.gearSpeeds[gear] || 95;
    let rpmT = 0.25 + 0.72 * Math.min(1, Math.max(0, (sp - lo) / (hi - lo)));
    if (this.throttle < 0.05 && sp < 1) rpmT = 0.12;
    if (this.nitroActive) rpmT = Math.min(1, rpmT + 0.12);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 5);

    this.syncVisual(dt);
  }

  syncVisual(dt) {
    const t = this.track;
    const near = { dist: this.roadDist };
    const h = (x, z) => t.heightAt(x, z, this.roadDist);
    const y = h(this.pos.x, this.pos.z);
    this.pos.y += (y - this.pos.y) * Math.min(1, dt * 12 || 1);

    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const d = 1.4;
    const hf = h(this.pos.x + sin * d, this.pos.z + cos * d);
    const hb = h(this.pos.x - sin * d, this.pos.z - cos * d);
    const hl = h(this.pos.x + cos * d, this.pos.z - sin * d);
    const hr = h(this.pos.x - cos * d, this.pos.z + sin * d);
    const pitch = Math.atan2(hb - hf, d * 2);
    const roll = Math.atan2(hl - hr, d * 2);

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    this.group.rotation.x += (pitch - this.group.rotation.x) * Math.min(1, (dt || 0.016) * 8);
    this.group.rotation.z += (roll - this.group.rotation.z) * Math.min(1, (dt || 0.016) * 8);

    this.wheelSpin += (this.vf / 0.34) * (dt || 0);
    this.wheels.forEach(w => { w.rotation.x = this.wheelSpin * this.spinSign; });
    this.frontWheels.forEach(w => {
      w.rotation.y = THREE.MathUtils.clamp(this.steer * 2.2, -0.55, 0.55);
    });
  }

  get speedKmh() { return Math.abs(this.vf) * 3.6; }

  rearWorldPos(out, side) {
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    out.set(
      this.pos.x - sin * 1.6 + cos * 0.8 * side,
      this.pos.y + 0.25,
      this.pos.z - cos * 1.6 - sin * 0.8 * side
    );
    return out;
  }
}
