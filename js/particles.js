import * as THREE from 'three';

function makeSmokeTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class Particles {
  constructor(scene, max = 300) {
    this.max = max;
    this.parts = [];
    for (let i = 0; i < max; i++) {
      this.parts.push({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1, r: 1, g: 1, b: 1 });
    }
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(max * 3);
    this.colArr = new Float32Array(max * 3);
    this.sizeArr = new Float32Array(max);
    this.alphaArr = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute('col', new THREE.BufferAttribute(this.colArr, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizeArr, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphaArr, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSmokeTexture() } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 col;
        varying float vA;
        varying vec3 vC;
        void main() {
          vA = alpha; vC = col;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying float vA;
        varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
        }`,
      transparent: true,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, opts = {}) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.life = p.maxLife = opts.life || 0.9;
    p.x = x; p.y = y; p.z = z;
    p.vx = (opts.vx || 0) + (Math.random() - 0.5) * 1.5;
    p.vy = (opts.vy || 1.2) + Math.random() * 0.8;
    p.vz = (opts.vz || 0) + (Math.random() - 0.5) * 1.5;
    p.size = opts.size || 1.6;
    const c = opts.color || [0.9, 0.9, 0.92];
    p.r = c[0]; p.g = c[1]; p.b = c[2];
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 0.96; p.vz *= 0.96;
        const f = Math.max(0, p.life / p.maxLife);
        this.posArr[i * 3] = p.x;
        this.posArr[i * 3 + 1] = p.y;
        this.posArr[i * 3 + 2] = p.z;
        this.colArr[i * 3] = p.r;
        this.colArr[i * 3 + 1] = p.g;
        this.colArr[i * 3 + 2] = p.b;
        this.sizeArr[i] = p.size * (1.6 - f * 0.9);
        this.alphaArr[i] = f * 0.55;
      } else {
        this.alphaArr[i] = 0;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.col.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
  }
}
