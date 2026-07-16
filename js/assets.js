import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const MODELS = {
  ferrari: 'assets/models/ferrari.glb',
  sedan: 'assets/models/sedan.glb',
  suv: 'assets/models/suv.glb',
  taxi: 'assets/models/taxi.glb',
  van: 'assets/models/van.glb',
  police: 'assets/models/police.glb',
  truck: 'assets/models/truck.glb',
  treeLarge: 'assets/models/tree-large.glb',
  treeSmall: 'assets/models/tree-small.glb',
  buildingA: 'assets/models/building-a.glb',
  buildingB: 'assets/models/building-b.glb',
  buildingC: 'assets/models/building-c.glb',
  cone: 'assets/models/cone.glb'
};

const TEXTURES = {
  roadColor: 'assets/textures/road_color.jpg',
  roadNormal: 'assets/textures/road_normal.jpg',
  roadRough: 'assets/textures/road_rough.jpg',
  grassColor: 'assets/textures/grass_color.jpg',
  grassNormal: 'assets/textures/grass_normal.jpg',
  ferrariAO: 'assets/models/ferrari_ao.png'
};

const SOUNDS = {
  crash: 'assets/sounds/crash.ogg',
  wind: 'assets/sounds/wind.ogg',
  boost: 'assets/sounds/boost.ogg',
  hum: 'assets/sounds/bg.ogg',
  bgm: 'assets/sounds/bgm.ogg'
};

export async function loadAssets(onProgress) {
  const total = Object.keys(MODELS).length + Object.keys(TEXTURES).length +
    Object.keys(SOUNDS).length + 1;
  let done = 0;
  const tick = () => { done++; onProgress(done / total); };

  const gltfLoader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('lib/draco/');
  gltfLoader.setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader();
  const rgbeLoader = new RGBELoader();

  const out = { models: {}, textures: {}, soundData: {}, hdr: null };

  const jobs = [];

  for (const [key, url] of Object.entries(MODELS)) {
    jobs.push(gltfLoader.loadAsync(url).then(g => { out.models[key] = g; tick(); }));
  }
  for (const [key, url] of Object.entries(TEXTURES)) {
    jobs.push(texLoader.loadAsync(url).then(t => { out.textures[key] = t; tick(); }));
  }
  for (const [key, url] of Object.entries(SOUNDS)) {
    jobs.push(fetch(url).then(r => r.arrayBuffer()).then(b => { out.soundData[key] = b; tick(); }));
  }
  jobs.push(rgbeLoader.loadAsync('assets/textures/sky.hdr').then(t => { out.hdr = t; tick(); }));

  await Promise.all(jobs);
  return out;
}
