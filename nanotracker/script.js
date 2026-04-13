const PI = 3.141592653589793;
const TAU = 6.283185307179586;

const MONK_OVERLAP_BUF_SIZE = 10240;
const MONK_NUM_FORMANTS = 3;
const MONK_SPLINE_TBL_SIZE = 1280;
const MONK_SINE_TBL_SIZE = 1024;
const MONK_MAX_GRAIN = 3840;
const MONK_DELAY_LINE_SIZE = 96000;

const SPLINE_SEG_SIZE = 320;
const PITCH_TABLE_BASE = 8.175799;
const GRAIN_DURATION = 0.02;
const ASPIRATION_AMP_DEFAULT = 0.5;
const ASPIRATION_PERIOD1 = 0.000202;
const ASPIRATION_PERIOD2 = 0.000263;
const ENV_ANTICLICK = 0.003;
const DELAY_TIME_L_44100 = 13653;
const DELAY_TIME_R_44100 = 17570;
const MAX_NOTES = 16;
const MAX_UNISON = 10;
const XY_PAD_GLIDE = 0.3;

const ENV_IDLE = 0;
const ENV_ATTACK = 1;
const ENV_DECAY = 2;
const ENV_SUSTAIN = 3;
const ENV_RELEASE = 4;

const FORMANT_FREQS = [
  [280.0, 450.0, 800.0, 350.0, 270.0],
  [600.0, 800.0, 1150.0, 2000.0, 2140.0],
  [2240.0, 2830.0, 2900.0, 2800.0, 2950.0]
];

const FORMANT_BW = [32.5, 47.5, 62.5];

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function noteToHz(note) {
  return 440.0 * Math.pow(2.0, (note - 69.0) / 12.0);
}

function hzToNote(hz) {
  if (!(hz > 0)) {
    return 69.0;
  }
  return 12.0 * Math.log2(hz / 440.0) + 69.0;
}

function midiToFreq(note) {
  return noteToHz(note);
}

function sanitizeSample(value) {
  return Number.isFinite(value) ? value : 0.0;
}

function wrapDelayReadPos(value) {
  if (!Number.isFinite(value)) {
    return 0.0;
  }
  value %= MONK_DELAY_LINE_SIZE;
  if (value < 0.0) {
    value += MONK_DELAY_LINE_SIZE;
  }
  return value >= MONK_DELAY_LINE_SIZE ? 0.0 : value;
}

class MonkVoice {
  constructor(sampleRateHz) {
    this.overlapBuf = new Float32Array(MONK_OVERLAP_BUF_SIZE);
    this.grain = new Float32Array(MONK_MAX_GRAIN);
    this.sineTbl = new Float32Array(MONK_SINE_TBL_SIZE);
    this.cosWindow = new Float32Array(MONK_MAX_GRAIN);
    this.expDecay = new Float32Array(MONK_MAX_GRAIN * 4);
    this.aspiration = new Float32Array(MONK_MAX_GRAIN);
    this.formantTbl = Array.from(
      { length: MONK_NUM_FORMANTS },
      () => new Float32Array(MONK_SPLINE_TBL_SIZE)
    );

    this.sampleRate = sampleRateHz;
    this.active = false;
    this.currentPitch = hzToNote(220.0);
    this.targetPitch = hzToNote(220.0);
    this.glideParam = 0.0;
    this.minGlide = 0.0;
    this.vibratoPhase = 0.0;
    this.vibratoDepth = 0.0;
    this.vibratoRate = 0.5;
    this.randomJitter = 4.0;
    this.jitterCounter = 0;
    this.jitterPeriod = 4586;
    this.srPerVibTbl = sampleRateHz / MONK_SINE_TBL_SIZE;
    this.rngState = 12345;

    this.overlapWritePos = 0;
    this.overlapReadPos = 0;
    this.overlapOffset = 0;

    this.grainLen = Math.floor(sampleRateHz * GRAIN_DURATION);
    this.currentVowel = 0.5;
    this.currentVoice = 0.5;
    this.aspirationAmp = ASPIRATION_AMP_DEFAULT;
    this.grainDirty = true;

    this.envStage = ENV_IDLE;
    this.envLevel = 0.0;
    this.envAttack = 0.0;
    this.envDecay = 0.0;
    this.envSustain = 1.0;
    this.envRelease = 0.0;

    this.buildSineTable();
    this.buildFormantTables();
    this.buildWindowAndDecay();
    this.buildAspiration();
  }

  buildSineTable() {
    for (let i = 0; i < MONK_SINE_TBL_SIZE; i++) {
      this.sineTbl[i] = Math.sin(TAU * i / MONK_SINE_TBL_SIZE);
    }
  }

  buildFormantTables() {
    for (let f = 0; f < MONK_NUM_FORMANTS; f++) {
      const pts = FORMANT_FREQS[f];
      const padded = [pts[0], pts[0], pts[1], pts[2], pts[3], pts[4], pts[4]];
      const table = this.formantTbl[f];

      for (let seg = 0; seg < 4; seg++) {
        const p0 = padded[seg];
        const p1 = padded[seg + 1];
        const p2 = padded[seg + 2];
        const p3 = padded[seg + 3];

        for (let i = 0; i < SPLINE_SEG_SIZE; i++) {
          const t = i / SPLINE_SEG_SIZE;
          const t2 = t * t;
          const t3 = t2 * t;
          table[seg * SPLINE_SEG_SIZE + i] =
            0.5 *
            ((2.0 * p1) +
              (-p0 + p2) * t +
              (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
              (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
        }
      }
    }
  }

  buildWindowAndDecay() {
    const n = this.grainLen;
    const sr = this.sampleRate;
    const attackLen = Math.floor(sr * 0.0018);
    const releaseStart = Math.floor(sr * 0.013);
    const releaseLen = Math.floor(sr * 0.007);

    this.cosWindow.fill(1.0, 0, n);

    for (let i = 0; i < attackLen && i < n; i++) {
      this.cosWindow[i] = 0.5 * (1.0 - Math.cos(PI * i / attackLen));
    }

    for (let i = releaseStart; i < n; i++) {
      this.cosWindow[i] = 0.5 * (1.0 - Math.cos(PI * (releaseLen + i) / releaseLen));
    }

    const bw = 50.0 * PI;
    for (let i = 0; i < n * 4; i++) {
      this.expDecay[i] = Math.exp(-bw * i / sr);
    }
  }

  buildAspiration() {
    const n = this.grainLen;
    const sr = this.sampleRate;
    const p1 = sr * ASPIRATION_PERIOD1;
    const p2 = sr * ASPIRATION_PERIOD2;
    const decayLen = n * 4;

    for (let i = 0; i < n; i++) {
      const s1 = Math.sin(TAU * i / p1);
      const d1Index = Math.floor(i * 3.0);
      const d1 = d1Index < decayLen ? this.expDecay[d1Index] : 0.0;

      const s2 = Math.sin(TAU * i / p2);
      const d2Index = Math.floor(i * 3.5);
      const d2 = d2Index < decayLen ? this.expDecay[d2Index] : 0.0;

      this.aspiration[i] = s1 * d1 + s2 * d2;
    }
  }

  nextRand() {
    this.rngState = (this.rngState * 1103515245 + 12345) >>> 0;
    return ((this.rngState >>> 16) & 0x7fff) / 32768.0;
  }

  envTick() {
    let rate;

    switch (this.envStage) {
      case ENV_ATTACK:
        rate = 1.0 / (Math.max(this.envAttack, ENV_ANTICLICK) * this.sampleRate);
        this.envLevel += rate;
        if (this.envLevel >= 1.0) {
          this.envLevel = 1.0;
          this.envStage = this.envDecay > 0.0 ? ENV_DECAY : ENV_SUSTAIN;
        }
        break;
      case ENV_DECAY:
        rate = this.envDecay > 0.0 ? 1.0 / (this.envDecay * this.sampleRate) : 1.0;
        this.envLevel -= rate * (1.0 - this.envSustain);
        if (this.envLevel <= this.envSustain) {
          this.envLevel = this.envSustain;
          this.envStage = ENV_SUSTAIN;
        }
        break;
      case ENV_RELEASE:
        rate = 1.0 / (Math.max(this.envRelease, ENV_ANTICLICK) * this.sampleRate);
        this.envLevel -= rate;
        if (this.envLevel <= 0.0) {
          this.envLevel = 0.0;
          this.envStage = ENV_IDLE;
          this.active = false;
        }
        break;
      default:
        break;
    }

    return this.envLevel;
  }

  lookupFormant(formant, vowel) {
    const pos = clamp(vowel, 0.0, 1.0) * (MONK_SPLINE_TBL_SIZE - 1);
    let index = Math.floor(pos);
    if (index > MONK_SPLINE_TBL_SIZE - 2) {
      index = MONK_SPLINE_TBL_SIZE - 2;
    }
    const frac = pos - index;
    const table = this.formantTbl[formant];
    return table[index] * (1.0 - frac) + table[index + 1] * frac;
  }

  grainPeriod(midiNote) {
    const internal = midiNote - 12.0;
    const tableIndex = Math.floor(internal * 32.0);
    const freq = Math.pow(2.0, tableIndex / 384.0) * PITCH_TABLE_BASE;
    return this.sampleRate / freq;
  }

  applyPortamento() {
    const effectiveGlide = this.glideParam > this.minGlide ? this.glideParam : this.minGlide;
    if (effectiveGlide < 0.001) {
      this.currentPitch = this.targetPitch;
      return;
    }

    const snap = this.minGlide > 0.001 ? 0.01 : 0.2;
    const diff = this.currentPitch - this.targetPitch;
    if (diff > snap) {
      this.currentPitch += -12.0 / ((effectiveGlide + 0.01) * this.sampleRate);
    } else if (diff < -snap) {
      this.currentPitch += 12.0 / ((effectiveGlide + 0.01) * this.sampleRate);
    } else {
      this.currentPitch = this.targetPitch;
    }
  }

  computeVibrato() {
    const rateScale = Math.pow(4.0, this.vibratoRate * 2.0 - 1.0);
    const rate = (this.vibratoDepth * 0.2 + 1.0) * this.randomJitter * rateScale;
    this.vibratoPhase += rate / this.srPerVibTbl;

    while (this.vibratoPhase >= MONK_SINE_TBL_SIZE) {
      this.vibratoPhase -= MONK_SINE_TBL_SIZE;
    }

    this.jitterCounter += 1;
    if (this.jitterCounter >= this.jitterPeriod) {
      this.jitterCounter = 0;
      this.randomJitter = this.nextRand() * 2.0 + 5.0;
    }

    const index = Math.floor(this.vibratoPhase) % MONK_SINE_TBL_SIZE;
    return (this.vibratoDepth + 0.2) * this.sineTbl[index];
  }

  computeGrain() {
    const n = this.grainLen;
    const formantScale = this.currentVoice * 0.5 + 0.75;
    const sr = this.sampleRate;
    const decayLen = n * 4;
    const formant0 = this.lookupFormant(0, this.currentVowel) * formantScale;
    const formant1 = this.lookupFormant(1, this.currentVowel) * formantScale;
    const formant2 = this.lookupFormant(2, this.currentVowel) * formantScale;

    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let sample = 0.0;

      for (let f = 0; f < MONK_NUM_FORMANTS; f++) {
        const formant = f === 0 ? formant0 : f === 1 ? formant1 : formant2;
        const phase = TAU * formant * t;
        const sineIndex = Math.floor((phase / TAU) * MONK_SINE_TBL_SIZE) % MONK_SINE_TBL_SIZE;
        const sine = this.sineTbl[sineIndex];
        const decayIndex = Math.floor(FORMANT_BW[f] * i / 50.0);
        const decay = decayIndex < decayLen ? this.expDecay[decayIndex] : 0.0;
        sample += sine * decay;
      }

      sample += this.aspiration[i] * this.aspirationAmp;
      this.grain[i] = sample * this.cosWindow[i];
    }

    this.grainDirty = false;
  }

  overlapAdd() {
    this.overlapWritePos = (this.overlapWritePos + this.overlapOffset) % MONK_OVERLAP_BUF_SIZE;
    const start = this.overlapWritePos;

    for (let i = 0; i < this.grainLen; i++) {
      const pos = (start + i) % MONK_OVERLAP_BUF_SIZE;
      this.overlapBuf[pos] += this.grain[i];
    }
  }

  setSampleRate(sampleRateHz) {
    this.sampleRate = sampleRateHz;
    this.srPerVibTbl = sampleRateHz / MONK_SINE_TBL_SIZE;
    const jitterPeriod = Math.floor(sampleRateHz / 44100.0 * 4586.0);
    this.jitterPeriod = jitterPeriod > 0 ? jitterPeriod : 1;
    this.grainLen = Math.floor(sampleRateHz * GRAIN_DURATION);
    this.buildWindowAndDecay();
    this.buildAspiration();
    this.grainDirty = true;
  }

  reset() {
    this.active = false;
    this.currentPitch = hzToNote(220.0);
    this.targetPitch = hzToNote(220.0);
    this.vibratoPhase = 0.0;
    this.randomJitter = 4.0;
    this.jitterCounter = 0;
    this.rngState = 12345;
    this.overlapBuf.fill(0.0);
    this.overlapWritePos = 0;
    this.overlapReadPos = 0;
    this.overlapOffset = 0;
    this.grainDirty = true;
    this.envStage = ENV_IDLE;
    this.envLevel = 0.0;
  }

  noteOn(pitchHz) {
    const wasActive = this.active;
    this.active = true;
    this.targetPitch = hzToNote(pitchHz);

    if (!wasActive) {
      this.currentPitch = this.targetPitch;
      this.grainDirty = true;
      this.overlapWritePos = this.overlapReadPos;
      this.overlapOffset = 0;
    }

    const hasEnvelope =
      this.envAttack > 0.0 ||
      this.envDecay > 0.0 ||
      this.envSustain < 1.0 ||
      this.envRelease > 0.0;

    if (hasEnvelope) {
      this.envStage = ENV_ATTACK;
    } else {
      this.envLevel = 1.0;
      this.envStage = ENV_SUSTAIN;
    }
  }

  noteOff() {
    const hasEnvelope =
      this.envAttack > 0.0 ||
      this.envDecay > 0.0 ||
      this.envSustain < 1.0 ||
      this.envRelease > 0.0;

    if (hasEnvelope) {
      this.envStage = ENV_RELEASE;
    } else {
      this.active = false;
      this.envStage = ENV_IDLE;
      this.envLevel = 0.0;
    }
  }

  isActive() {
    return this.active || this.envStage === ENV_RELEASE;
  }

  setPitchDirect(hz) {
    const note = hzToNote(hz);
    this.targetPitch = note;
    this.currentPitch = note;
  }

  setPitchTarget(hz) {
    this.targetPitch = hzToNote(hz);
  }

  setVowel(vowel) {
    this.currentVowel = clamp(vowel, 0.0, 1.0);
  }

  setVoice(voice) {
    this.currentVoice = clamp(voice, 0.0, 1.0);
  }

  setGlide(glide) {
    this.glideParam = clamp(glide, 0.0, 1.0);
  }

  setVibrato(depth) {
    this.vibratoDepth = clamp(depth, 0.0, 1.0);
  }

  setVibratoRate(rate) {
    this.vibratoRate = clamp(rate, 0.0, 1.0);
  }

  setAspiration(amp) {
    this.aspirationAmp = clamp(amp, 0.0, 1.0);
  }

  setAttack(seconds) {
    this.envAttack = Math.max(0.0, seconds);
  }

  setDecay(seconds) {
    this.envDecay = Math.max(0.0, seconds);
  }

  setSustain(level) {
    this.envSustain = clamp(level, 0.0, 1.0);
  }

  setRelease(seconds) {
    this.envRelease = Math.max(0.0, seconds);
  }

  amplitude() {
    const internal = this.currentPitch - 12.0;
    return clamp(internal * (-1.0 / 72.0) + 2.0, 0.1, 3.0);
  }

  process(output, n) {
    const hasEnvelope =
      this.envAttack > 0.0 ||
      this.envDecay > 0.0 ||
      this.envSustain < 1.0 ||
      this.envRelease > 0.0 ||
      this.envStage === ENV_RELEASE;

    for (let i = 0; i < n; i++) {
      if (this.active || this.envStage === ENV_RELEASE) {
        this.applyPortamento();
        const vibrato = this.computeVibrato();
        const pitch = this.currentPitch + vibrato;
        const period = Math.floor(this.grainPeriod(pitch));

        if (this.overlapOffset >= period || this.grainDirty) {
          this.computeGrain();
          this.overlapAdd();
          this.overlapOffset = 0;
        }
      }
      this.overlapOffset += 1;
    }

    while (this.overlapReadPos >= MONK_OVERLAP_BUF_SIZE) {
      this.overlapReadPos -= MONK_OVERLAP_BUF_SIZE;
    }

    for (let i = 0; i < n; i++) {
      let sample = this.overlapBuf[this.overlapReadPos];
      this.overlapBuf[this.overlapReadPos] = 0.0;
      this.overlapReadPos = (this.overlapReadPos + 1) % MONK_OVERLAP_BUF_SIZE;

      if (hasEnvelope) {
        sample *= this.envTick();
      }

      output[i] = sample;
    }
  }
}

class MonkDelay {
  constructor(sampleRateHz) {
    this.bufferL = new Float32Array(MONK_DELAY_LINE_SIZE);
    this.bufferR = new Float32Array(MONK_DELAY_LINE_SIZE);
    this.writePos = 0;
    this.targetDelayL = 0.0;
    this.targetDelayR = 0.0;
    this.currentDelayL = 0.0;
    this.currentDelayR = 0.0;
    this.smoothCoeff = 0.0;
    this.sampleRate = sampleRateHz;
    this.rate = 0.5;
    this.feedback = 0.5;
    this.mix = 0.5;
    this.resetState(sampleRateHz);
  }

  recalcTaps() {
    const scale = this.sampleRate / 44100.0;
    const rateScale = 0.1 + this.rate * 1.9;
    let delayL = DELAY_TIME_L_44100 * scale * rateScale;
    let delayR = DELAY_TIME_R_44100 * scale * rateScale;

    if (delayL >= MONK_DELAY_LINE_SIZE) {
      delayL = MONK_DELAY_LINE_SIZE - 1;
    }
    if (delayR >= MONK_DELAY_LINE_SIZE) {
      delayR = MONK_DELAY_LINE_SIZE - 1;
    }

    this.targetDelayL = delayL;
    this.targetDelayR = delayR;
  }

  resetState(sampleRateHz) {
    this.bufferL.fill(0.0);
    this.bufferR.fill(0.0);
    this.writePos = 0;
    this.sampleRate = sampleRateHz;
    this.smoothCoeff = 1.0 / (0.05 * sampleRateHz);
    this.rate = 0.5;
    this.feedback = 0.5;
    this.mix = 0.5;
    this.recalcTaps();
    this.currentDelayL = this.targetDelayL;
    this.currentDelayR = this.targetDelayR;
  }

  setSampleRate(sampleRateHz) {
    this.sampleRate = sampleRateHz;
    this.smoothCoeff = 1.0 / (0.05 * sampleRateHz);
    this.bufferL.fill(0.0);
    this.bufferR.fill(0.0);
    this.writePos = 0;
    this.recalcTaps();
    this.currentDelayL = this.targetDelayL;
    this.currentDelayR = this.targetDelayR;
  }

  setMix(mix) {
    this.mix = clamp(mix, 0.0, 1.0);
  }

  setRate(rate) {
    this.rate = clamp(rate, 0.0, 1.0);
    this.recalcTaps();
  }

  reset() {
    this.bufferL.fill(0.0);
    this.bufferR.fill(0.0);
  }

  process(monoIn, outL, outR, n) {
    const coeff = this.smoothCoeff;

    for (let i = 0; i < n; i++) {
      const input = sanitizeSample(monoIn[i]);

      this.currentDelayL += coeff * (this.targetDelayL - this.currentDelayL);
      this.currentDelayR += coeff * (this.targetDelayR - this.currentDelayR);

      const readL = wrapDelayReadPos(this.writePos - this.currentDelayL);
      const indexL = Math.floor(readL);
      const fracL = readL - indexL;
      const nextIndexL = indexL + 1 === MONK_DELAY_LINE_SIZE ? 0 : indexL + 1;
      const tapL = sanitizeSample(
        this.bufferL[indexL] * (1.0 - fracL) +
        this.bufferL[nextIndexL] * fracL
      );

      const readR = wrapDelayReadPos(this.writePos - this.currentDelayR);
      const indexR = Math.floor(readR);
      const fracR = readR - indexR;
      const nextIndexR = indexR + 1 === MONK_DELAY_LINE_SIZE ? 0 : indexR + 1;
      const tapR = sanitizeSample(
        this.bufferR[indexR] * (1.0 - fracR) +
        this.bufferR[nextIndexR] * fracR
      );

      this.bufferL[this.writePos] = sanitizeSample((tapL * this.feedback + input) * this.mix);
      this.bufferR[this.writePos] = sanitizeSample((tapR * this.feedback + input) * this.mix);

      outL[i] = sanitizeSample(input + tapL);
      outR[i] = sanitizeSample(input + tapR);

      this.writePos = (this.writePos + 1) % MONK_DELAY_LINE_SIZE;
    }
  }
}

class MonkSynth {
  constructor(sampleRateHz) {
    this.voices = Array.from({ length: MAX_UNISON }, (_, index) => {
      const voice = new MonkVoice(sampleRateHz);
      voice.vibratoPhase = MONK_SINE_TBL_SIZE * index / MAX_UNISON;
      voice.rngState = (12345 + index * 7919) >>> 0;
      return voice;
    });

    this.unisonCount = 1;
    this.unisonDetune = 0.0;
    this.unisonVoiceSpread = 0.0;
    this.baseVoice = 0.5;
    this.lastBaseHz = 220.0;

    this.delay = new MonkDelay(sampleRateHz);
    this.held = [];
    this.ccVolume = 0.1;
    this.level = 1.0;
    this.currentVoiceGain = 1.0;
    this.targetVoiceGain = 1.0;
    this.currentHostGain = 1.0;
    this.targetHostGain = 1.0;
    this.idleSilentBlocks = 0;

    this.scratchMono = new Float32Array(0);
    this.scratchVoice = new Float32Array(0);
    this.scratchL = new Float32Array(0);
    this.scratchR = new Float32Array(0);

    this.setGlide(0.5);
    this.setVowel(0.5);
    this.setVoice(0.5);
    this.setDelayMix(0.8);
  }

  ensureScratch(size) {
    if (this.scratchMono.length >= size) {
      return;
    }
    this.scratchMono = new Float32Array(size);
    this.scratchVoice = new Float32Array(size);
    this.scratchL = new Float32Array(size);
    this.scratchR = new Float32Array(size);
  }

  removeNote(note) {
    let write = 0;
    for (let i = 0; i < this.held.length; i++) {
      if (this.held[i].note !== note) {
        this.held[write++] = this.held[i];
      }
    }
    this.held.length = write;
  }

  applyVoiceSpread() {
    const voiceCount = this.unisonCount;
    for (let i = 0; i < voiceCount; i++) {
      let offset = 0.0;
      if (voiceCount > 1) {
        offset = this.unisonVoiceSpread * (i / (voiceCount - 1) * 2.0 - 1.0);
      }
      this.voices[i].setVoice(clamp(this.baseVoice + offset, 0.0, 1.0));
    }
  }

  detunedHz(baseHz, detuneCents, voiceIndex, voiceCount) {
    if (voiceCount <= 1) {
      return baseHz;
    }
    const offset = detuneCents * (voiceIndex / (voiceCount - 1) * 2.0 - 1.0);
    return baseHz * Math.pow(2.0, offset / 1200.0);
  }

  applyUnisonDetune(baseHz) {
    this.lastBaseHz = baseHz;
    for (let i = 0; i < this.unisonCount; i++) {
      const hz = this.detunedHz(baseHz, this.unisonDetune, i, this.unisonCount);
      this.voices[i].noteOn(hz);
    }
  }

  noteOn(note, velocity) {
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].minGlide = 0.0;
    }

    this.removeNote(note);
    if (this.held.length < MAX_NOTES) {
      this.held.push({ note, velocity });
    }

    this.applyUnisonDetune(midiToFreq(note));
  }

  noteOnHz(note, velocity, hz) {
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].minGlide = 0.0;
    }

    this.removeNote(note);
    if (this.held.length < MAX_NOTES) {
      this.held.push({ note, velocity });
    }

    this.applyUnisonDetune(hz);
  }

  noteOff(note) {
    this.removeNote(note);
    if (this.held.length > 0) {
      const top = this.held[this.held.length - 1].note;
      this.applyUnisonDetune(midiToFreq(top));
      return;
    }

    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].noteOff();
    }
  }

  setPitchHz(hz) {
    this.lastBaseHz = hz;
    if (!this.voices[0].isActive()) {
      return;
    }

    for (let i = 0; i < this.unisonCount; i++) {
      this.voices[i].minGlide = XY_PAD_GLIDE;
      this.voices[i].setPitchTarget(
        this.detunedHz(hz, this.unisonDetune, i, this.unisonCount)
      );
    }
  }

  setVowel(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setVowel(next);
    }
  }

  setVoice(value) {
    this.baseVoice = clamp(value, 0.0, 1.0);
    this.applyVoiceSpread();
  }

  setGlide(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setGlide(next);
    }
  }

  setVibrato(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setVibrato(next);
    }
  }

  setVibratoRate(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setVibratoRate(next);
    }
  }

  setAspiration(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setAspiration(next);
    }
  }

  setAttack(value) {
    const next = Math.max(0.0, value);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setAttack(next);
    }
  }

  setDecay(value) {
    const next = Math.max(0.0, value);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setDecay(next);
    }
  }

  setSustain(value) {
    const next = clamp(value, 0.0, 1.0);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setSustain(next);
    }
  }

  setRelease(value) {
    const next = Math.max(0.0, value);
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].setRelease(next);
    }
  }

  setUnison(count) {
    const next = clamp(Math.round(count), 1, MAX_UNISON);
    const oldCount = this.unisonCount;
    this.unisonCount = next;
    this.targetVoiceGain = 1.0 / Math.sqrt(next);

    if (oldCount === next) {
      return;
    }

    if (!this.voices[0].isActive()) {
      this.applyVoiceSpread();
      return;
    }

    const baseHz = this.lastBaseHz;

    for (let i = next; i < oldCount; i++) {
      this.voices[i].envStage = ENV_RELEASE;
    }

    for (let i = 0; i < next && i < oldCount; i++) {
      this.voices[i].setPitchDirect(this.detunedHz(baseHz, this.unisonDetune, i, next));
    }

    for (let i = oldCount; i < next; i++) {
      this.voices[i].noteOn(this.detunedHz(baseHz, this.unisonDetune, i, next));
    }

    this.applyVoiceSpread();
  }

  setUnisonDetune(cents) {
    this.unisonDetune = Math.max(0.0, cents);

    if (this.voices[0].isActive() && this.unisonCount > 1) {
      for (let i = 0; i < this.unisonCount; i++) {
        this.voices[i].setPitchDirect(
          this.detunedHz(this.lastBaseHz, this.unisonDetune, i, this.unisonCount)
        );
      }
    }
  }

  setUnisonVoiceSpread(spread) {
    this.unisonVoiceSpread = clamp(spread, 0.0, 1.0);
    this.applyVoiceSpread();
  }

  setDelayMix(value) {
    this.delay.setMix(clamp(value, 0.0, 1.0));
  }

  setDelayRate(value) {
    this.delay.setRate(clamp(value, 0.0, 1.0));
  }

  setVolume(value) {
    this.ccVolume = Math.max(0.0, value);
  }

  setLevel(value) {
    this.level = clamp(value, 0.0, 1.0);
  }

  setHostGain(value) {
    this.targetHostGain = Math.max(0.0, value);
  }

  allNotesOff() {
    this.held.length = 0;
    for (let i = 0; i < MAX_UNISON; i++) {
      this.voices[i].noteOff();
    }
  }

  isActive() {
    for (let i = 0; i < MAX_UNISON; i++) {
      if (this.voices[i].isActive()) {
        return true;
      }
    }
    return false;
  }

  applyParam(key, value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return;
    }

    switch (key) {
      case "glide":
        this.setGlide(value);
        break;
      case "vowel":
        this.setVowel(value);
        break;
      case "voice":
        this.setVoice(value);
        break;
      case "vibrato":
        this.setVibrato(value);
        break;
      case "vibratoRate":
        this.setVibratoRate(value);
        break;
      case "aspiration":
        this.setAspiration(value);
        break;
      case "attack":
        this.setAttack(value);
        break;
      case "decay":
        this.setDecay(value);
        break;
      case "sustain":
        this.setSustain(value);
        break;
      case "release":
        this.setRelease(value);
        break;
      case "unison":
        this.setUnison(value);
        break;
      case "detune":
        this.setUnisonDetune(value);
        break;
      case "voiceSpread":
        this.setUnisonVoiceSpread(value);
        break;
      case "delay":
      case "delayMix":
        this.setDelayMix(value);
        break;
      case "delayRate":
        this.setDelayRate(value);
        break;
      case "level":
        this.setLevel(value);
        break;
      case "volume":
        this.setVolume(value);
        break;
      default:
        break;
    }
  }

  process(outL, outR, frames) {
    this.ensureScratch(frames);
    this.scratchMono.fill(0.0, 0, frames);

    for (let v = 0; v < MAX_UNISON; v++) {
      if (v >= this.unisonCount && !this.voices[v].isActive()) {
        continue;
      }

      this.scratchVoice.fill(0.0, 0, frames);
      this.voices[v].process(this.scratchVoice, frames);
      for (let i = 0; i < frames; i++) {
        this.scratchMono[i] += this.scratchVoice[i];
      }
    }

    const gainStep = (this.targetVoiceGain - this.currentVoiceGain) / frames;
    for (let i = 0; i < frames; i++) {
      this.scratchMono[i] *= this.currentVoiceGain;
      this.currentVoiceGain += gainStep;
    }
    this.currentVoiceGain = this.targetVoiceGain;

    this.delay.process(this.scratchMono, this.scratchL, this.scratchR, frames);

    const voiceGain = this.voices[0].amplitude() * this.ccVolume * this.level;
    const hostGainStep = (this.targetHostGain - this.currentHostGain) / frames;
    let peak = 0.0;
    for (let i = 0; i < frames; i++) {
      const hostGain = this.currentHostGain;
      outL[i] = this.scratchL[i] * voiceGain * hostGain;
      outR[i] = this.scratchR[i] * voiceGain * hostGain;
      const absL = Math.abs(outL[i]);
      const absR = Math.abs(outR[i]);
      if (absL > peak) {
        peak = absL;
      }
      if (absR > peak) {
        peak = absR;
      }
      this.currentHostGain += hostGainStep;
    }
    this.currentHostGain = this.targetHostGain;

    if (this.held.length === 0 && !this.isActive()) {
      if (peak < 1e-6) {
        outL.fill(0.0, 0, frames);
        outR.fill(0.0, 0, frames);
        this.idleSilentBlocks += 1;
        if (this.idleSilentBlocks >= 4) {
          this.delay.reset();
          for (let i = 0; i < MAX_UNISON; i++) {
            if (!this.voices[i].isActive()) {
              this.voices[i].reset();
            }
          }
        }
      } else {
        this.idleSilentBlocks = 0;
      }
    } else {
      this.idleSilentBlocks = 0;
    }
  }
}

class MonkSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = new MonkSynth(sampleRate);
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  messageFrequency(message) {
    for (const key of ["frequency", "frequencyHz", "hz", "value"]) {
      if (typeof message[key] === "number" && message[key] > 0) {
        return message[key];
      }
    }
    return null;
  }

  messageNote(message) {
    for (const key of ["note", "midiNote", "noteNumber"]) {
      if (typeof message[key] === "number" && Number.isFinite(message[key])) {
        return message[key];
      }
    }
    const hz = this.messageFrequency(message);
    if (hz !== null) {
      return Math.round(hzToNote(hz));
    }
    return null;
  }

  messageVelocity(message) {
    for (const key of ["velocity", "vel"]) {
      if (typeof message[key] === "number" && Number.isFinite(message[key])) {
        return message[key];
      }
    }
    return 127;
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case "init":
        if (message.params && typeof message.params === "object") {
          for (const [key, value] of Object.entries(message.params)) {
            this.synth.applyParam(key, value);
          }
        }
        try {
          this.port.postMessage({ type: "ready" });
        } catch {
          // Ignore port errors during host teardown or duplicate probing.
        }
        break;
      case "dispose":
        this.synth.allNotesOff();
        break;
      case "noteOn":
        {
          const note = this.messageNote(message);
          const hz = this.messageFrequency(message);
          const velocity = this.messageVelocity(message);
          if (note !== null && hz !== null) {
            this.synth.noteOnHz(note, velocity, hz);
          } else if (note !== null) {
            this.synth.noteOn(note, velocity);
          } else if (hz !== null) {
            this.synth.noteOnHz(Math.round(hzToNote(hz)), velocity, hz);
          }
        }
        break;
      case "noteOff":
        {
          const note = this.messageNote(message);
          if (note !== null) {
            this.synth.noteOff(note);
          } else {
            this.synth.allNotesOff();
          }
        }
        break;
      case "allNotesOff":
        this.synth.allNotesOff();
        break;
      case "param":
        if (typeof message.key === "string") {
          this.synth.applyParam(message.key, message.value);
        }
        break;
      case "setPitch":
        {
          const hz = this.messageFrequency(message);
          if (hz !== null) {
            this.synth.setPitchHz(hz);
          }
        }
        break;
      case "setGain":
        if (typeof message.gain === "number") {
          this.synth.setHostGain(message.gain);
        } else if (typeof message.value === "number") {
          this.synth.setHostGain(message.value);
        }
        break;
      default:
        break;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const left = output[0];
    const right = output[1] ?? output[0];
    this.synth.process(left, right, left.length);
    return true;
  }
}

const monkSynthWorkletScope =
  typeof globalThis === "object" && globalThis ? globalThis : self;

if (!monkSynthWorkletScope.__monksynthProcessorRegistered) {
  registerProcessor("monksynth-processor", MonkSynthProcessor);
  monkSynthWorkletScope.__monksynthProcessorRegistered = true;
}
