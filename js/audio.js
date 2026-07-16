export class AudioManager {
  constructor() {
    this.ready = false;
    this.musicOn = true;
    this.crashCooldown = 0;
  }

  async init(soundData) {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    this.buffers = {};
    for (const [k, data] of Object.entries(soundData)) {
      try {
        this.buffers[k] = await ctx.decodeAudioData(data.slice(0));
      } catch (e) { console.warn('decode fail', k, e); }
    }

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 800;
    engFilter.Q.value = 1.2;
    this.engFilter = engFilter;

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 60;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 30;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.5;
    this.osc2.connect(osc2Gain);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseGain);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;

    this.osc1.connect(shaper);
    osc2Gain.connect(shaper);
    this.noiseGain.connect(shaper);
    shaper.connect(engFilter);
    engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();
    this.noise.start();

    if (this.buffers.hum) {
      this.hum = ctx.createBufferSource();
      this.hum.buffer = this.buffers.hum;
      this.hum.loop = true;
      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0;
      this.hum.connect(this.humGain);
      this.humGain.connect(this.master);
      this.hum.start();
    }

    if (this.buffers.wind) {
      this.wind = ctx.createBufferSource();
      this.wind.buffer = this.buffers.wind;
      this.wind.loop = true;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.wind.connect(this.windGain);
      this.windGain.connect(this.master);
      this.wind.start();
    }

    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 950;
    skidFilter.Q.value = 0.8;
    const skidNoise = ctx.createBufferSource();
    skidNoise.buffer = noiseBuf;
    skidNoise.loop = true;
    skidNoise.connect(skidFilter);
    skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    skidNoise.start();

    if (this.buffers.bgm) {
      this.bgm = ctx.createBufferSource();
      this.bgm.buffer = this.buffers.bgm;
      this.bgm.loop = true;
      this.bgmGain = ctx.createGain();
      this.bgmGain.gain.value = 0.3;
      this.bgm.connect(this.bgmGain);
      this.bgmGain.connect(this.master);
      this.bgm.start();
    }

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEngine(rpm, throttle, speedNorm, slip, offroad, dt) {
    if (!this.ready) return;
    const ct = this.ctx.currentTime;
    const f = 48 + rpm * 310;
    this.osc1.frequency.setTargetAtTime(f, ct, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, ct, 0.03);
    this.engFilter.frequency.setTargetAtTime(320 + rpm * 3400, ct, 0.05);
    const vol = 0.05 + rpm * 0.1 + throttle * 0.1;
    this.engGain.gain.setTargetAtTime(vol, ct, 0.05);
    this.noiseGain.gain.setTargetAtTime(throttle * 0.16 + rpm * 0.05, ct, 0.05);

    if (this.humGain) {
      this.hum.playbackRate.setTargetAtTime(0.55 + rpm * 1.25, ct, 0.05);
      this.humGain.gain.setTargetAtTime(0.05 + rpm * 0.12, ct, 0.05);
    }
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(Math.min(1, speedNorm * speedNorm) * 0.75, ct, 0.1);
      this.wind.playbackRate.setTargetAtTime(0.8 + speedNorm * 0.5, ct, 0.1);
    }
    const skidT = Math.min(1, Math.max(0, slip - 1.5) / 6) * (offroad ? 0.25 : 1);
    this.skidGain.gain.setTargetAtTime(skidT * 0.34, ct, 0.05);

    if (this.crashCooldown > 0) this.crashCooldown -= dt;
  }

  playCrash(intensity = 1) {
    if (!this.ready || !this.buffers.crash || this.crashCooldown > 0) return;
    this.crashCooldown = 0.4;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.crash;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(1, 0.4 + intensity * 0.6);
    src.connect(g); g.connect(this.master);
    src.start();
  }

  playBoost() {
    if (!this.ready || !this.buffers.boost) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.boost;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g); g.connect(this.master);
    src.start();
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.bgmGain) this.bgmGain.gain.value = this.musicOn ? 0.3 : 0;
    return this.musicOn;
  }

  stopAll() {
    if (!this.ready) return;
    const ct = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, ct, 0.1);
    this.noiseGain.gain.setTargetAtTime(0, ct, 0.1);
    if (this.humGain) this.humGain.gain.setTargetAtTime(0, ct, 0.1);
    if (this.windGain) this.windGain.gain.setTargetAtTime(0, ct, 0.1);
    this.skidGain.gain.setTargetAtTime(0, ct, 0.1);
  }
}
