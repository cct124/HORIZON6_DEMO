import * as THREE from 'three';
import { terrainHeightRaw, ROAD_WIDTH, ROAD_HALF } from './track.js';

export class World {
  constructor(scene, renderer, track, assets) {
    this.scene = scene;
    this.track = track;
    this.assets = assets;
    this.colliders = [];
    this.balloons = [];

    this.setupSky(renderer);
    this.setupLights();
    this.buildGround();
    this.buildRoad();
    this.buildTrees();
    this.buildBuildings();
    this.buildStartArch();
    this.buildMountains();
    this.buildBalloons();
  }

  setupSky(renderer) {
    const hdr = this.assets.hdr;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environment = env;
    this.scene.background = hdr;
    this.scene.backgroundIntensity = 1.0;
    this.scene.environmentIntensity = 1.0;
    this.scene.fog = new THREE.Fog(0xcfe0ee, 400, 2200);
    pmrem.dispose();
  }

  setupLights() {
    const sun = new THREE.DirectionalLight(0xfff2df, 2.6);
    sun.position.set(180, 260, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 700;
    const s = 140;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    const amb = new THREE.AmbientLight(0x9db4d0, 0.35);
    this.scene.add(amb);
  }

  updateSun(target) {
    this.sun.position.set(target.x + 180, 260, target.z + 120);
    this.sun.target.position.set(target.x, 0, target.z);
  }

  buildGround() {
    const SIZE = 2600, SEG = 220;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      posAttr.setY(i, this.track.heightAt(x, z));
    }
    geo.computeVertexNormals();

    const grass = this.assets.textures.grassColor;
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(320, 320);
    grass.colorSpace = THREE.SRGBColorSpace;
    grass.anisotropy = 8;
    const grassN = this.assets.textures.grassNormal;
    grassN.wrapS = grassN.wrapT = THREE.RepeatWrapping;
    grassN.repeat.set(320, 320);

    const mat = new THREE.MeshStandardMaterial({
      map: grass, normalMap: grassN, roughness: 1.0, metalness: 0,
      color: 0xa8c07a
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildRoad() {
    const t = this.track;
    const STEP = 2;
    const count = Math.floor(t.N / STEP);
    const verts = [], uvs = [], idx = [];
    const W = ROAD_HALF + 0.8;
    for (let k = 0; k <= count; k++) {
      const i = (k * STEP) % t.N;
      const p = t.pos[i];
      const tg = t.tan[i];
      const rx = -tg.y, rz = tg.x;
      const y = t.roadY[i] + 0.06;
      verts.push(p.x + rx * W, y, p.z + rz * W);
      verts.push(p.x - rx * W, y, p.z - rz * W);
      const v = t.arc[i] / 6.5 + (k === count ? t.length / 6.5 : 0);
      uvs.push(0, v, 1, v);
    }
    for (let k = 0; k < count; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const road = this.assets.textures.roadColor;
    road.wrapS = road.wrapT = THREE.RepeatWrapping;
    road.colorSpace = THREE.SRGBColorSpace;
    road.anisotropy = 16;
    const roadN = this.assets.textures.roadNormal;
    roadN.wrapS = roadN.wrapT = THREE.RepeatWrapping;
    const roadR = this.assets.textures.roadRough;
    roadR.wrapS = roadR.wrapT = THREE.RepeatWrapping;

    const mat = new THREE.MeshStandardMaterial({
      map: road, normalMap: roadN, roughnessMap: roadR,
      roughness: 1.0, metalness: 0
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  extractMeshes(gltfScene) {
    const list = [];
    gltfScene.updateMatrixWorld(true);
    gltfScene.traverse(o => {
      if (o.isMesh) {
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        list.push({ geometry: g, material: o.material });
      }
    });
    return list;
  }

  buildTrees() {
    const t = this.track;
    const types = [
      { gltf: this.assets.models.treeLarge, target: 7.5 },
      { gltf: this.assets.models.treeSmall, target: 5.0 }
    ];

    const spots = [[], []];
    let attempts = 0;
    while (spots[0].length + spots[1].length < 520 && attempts < 6000) {
      attempts++;
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 800;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const d = t.distToRoad(x, z);
      if (d < ROAD_HALF + 6) continue;
      if (Math.hypot(x - t.pos[0].x, z - t.pos[0].z) < 60) continue;
      const which = Math.random() < 0.45 ? 0 : 1;
      const scl = 0.8 + Math.random() * 0.9;
      spots[which].push({ x, z, scl, rot: Math.random() * Math.PI * 2 });
    }

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const vs = new THREE.Vector3();

    types.forEach((type, ti) => {
      const parts = this.extractMeshes(type.gltf.scene);
      const box = new THREE.Box3();
      parts.forEach(p => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
      const h = box.max.y - box.min.y || 1;
      const norm = type.target / h;
      const pts = spots[ti];
      parts.forEach(part => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, pts.length);
        im.castShadow = true;
        pts.forEach((s, i) => {
          q.setFromAxisAngle(up, s.rot);
          const sc = norm * s.scl;
          vs.set(s.x, this.track.heightAt(s.x, s.z) - 0.05, s.z);
          m4.compose(vs, q, new THREE.Vector3(sc, sc, sc));
          im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
        this.scene.add(im);
      });
      pts.forEach(s => this.colliders.push({ x: s.x, z: s.z, r: 0.9 * s.scl }));
    });
  }

  buildBuildings() {
    const t = this.track;
    const models = [
      this.assets.models.buildingA.scene,
      this.assets.models.buildingB.scene,
      this.assets.models.buildingC.scene
    ];
    const sizes = models.map(m => {
      const b = new THREE.Box3().setFromObject(m);
      return b;
    });

    const clusterCenters = [0.02, 0.3, 0.62, 0.85].map(f =>
      t.sampleAtS(f * t.length, 0));

    clusterCenters.forEach(c => {
      for (let i = 0; i < 8; i++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const lat = side * (ROAD_HALF + 14 + Math.random() * 26);
        const along = (Math.random() - 0.5) * 130;
        const px = c.x + c.fx * along - c.fz * lat;
        const pz = c.z + c.fz * along + c.fx * lat;
        if (t.distToRoad(px, pz) < ROAD_HALF + 9) continue;
        const mi = Math.floor(Math.random() * models.length);
        const g = models[mi].clone();
        const scl = 3.4 + Math.random() * 1.8;
        g.scale.setScalar(scl);
        g.position.set(px, this.track.heightAt(px, pz) - 0.05, pz);
        g.rotation.y = Math.atan2(c.fx, c.fz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
        const b = sizes[mi];
        const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * scl * 0.5;
        this.colliders.push({ x: px, z: pz, r: Math.min(r, 14) });
      }
    });
  }

  makeBannerTexture(text) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 160;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, '#b800ff');
    grad.addColorStop(0.5, '#ff2d78');
    grad.addColorStop(1, '#ff9a2d');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#fff';
    g.font = 'italic 900 96px "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 84);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildStartArch() {
    const t = this.track;
    const s0 = t.sampleAtS(0, 0);
    const group = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.55, 9, 12);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.7 });
    const w = ROAD_HALF + 2.5;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(side * w, 4.5, 0);
      p.castShadow = true;
      group.add(p);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(w * 2 + 1, 2.2, 0.5),
      new THREE.MeshStandardMaterial({ map: this.makeBannerTexture('HORIZON 6  START'), roughness: 0.6 })
    );
    beam.position.set(0, 8.6, 0);
    beam.castShadow = true;
    group.add(beam);

    group.position.set(s0.x, s0.y, s0.z);
    group.rotation.y = s0.heading;
    this.scene.add(group);

    this.colliders.push(
      { x: s0.x - s0.fz * w, z: s0.z + s0.fx * w, r: 0.8 },
      { x: s0.x + s0.fz * w, z: s0.z - s0.fx * w, r: 0.8 }
    );

    this.gates = [];
  }

  buildCheckpointGates(sList) {
    if (this.gates) this.gates.forEach(g => this.scene.remove(g.group));
    this.gates = [];
    const t = this.track;
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0x18a0ff, emissive: 0x1060ff, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide
    });
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 6, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    sList.forEach(s => {
      const smp = t.sampleAtS(s, 0);
      const group = new THREE.Group();
      const w = ROAD_HALF + 1.2;
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * w, 3, 0);
        group.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), flagMat.clone());
        flag.position.set(side * w - side * 0.95, 5.2, 0);
        group.add(flag);
      }
      group.position.set(smp.x, smp.y, smp.z);
      group.rotation.y = smp.heading;
      group.visible = false;
      this.scene.add(group);
      this.gates.push({ group, s });
    });
  }

  setGateHighlight(nextIdx) {
    this.gates.forEach((g, i) => {
      g.group.visible = i === nextIdx || i === (nextIdx + 1) % this.gates.length;
      g.group.traverse(o => {
        if (o.material && o.material.emissive) {
          o.material.emissiveIntensity = (i === nextIdx) ? 1.4 : 0.3;
        }
      });
    });
  }

  hideGates() {
    if (this.gates) this.gates.forEach(g => g.group.visible = false);
  }

  buildMountains() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f7d6a, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const r = 1250 + Math.random() * 500;
      const h = 160 + Math.random() * 260;
      const geo = new THREE.ConeGeometry(220 + Math.random() * 180, h, 7, 3);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        pos.setX(v, pos.getX(v) * (0.85 + Math.random() * 0.3));
        pos.setZ(v, pos.getZ(v) * (0.85 + Math.random() * 0.3));
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, h * 0.42, Math.sin(a) * r);
      this.scene.add(m);
    }
  }

  buildBalloons() {
    const colors = [0xff2d78, 0xb800ff, 0xff9a2d];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const env = new THREE.Mesh(
        new THREE.SphereGeometry(7, 20, 16),
        new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.5 })
      );
      env.scale.y = 1.2;
      g.add(env);
      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.6, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 })
      );
      basket.position.y = -11;
      g.add(basket);
      const a = Math.random() * Math.PI * 2;
      const r = 180 + Math.random() * 380;
      g.position.set(Math.cos(a) * r, 70 + Math.random() * 50, Math.sin(a) * r);
      this.scene.add(g);
      this.balloons.push({ group: g, phase: Math.random() * 10, speed: 1.6 + Math.random() });
    }
  }

  update(dt, time) {
    this.balloons.forEach(b => {
      b.group.position.y += Math.sin(time * 0.4 + b.phase) * 0.02;
      b.group.position.x += b.speed * dt * 0.6;
      if (b.group.position.x > 900) b.group.position.x = -900;
    });
  }
}
