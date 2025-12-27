// pitch.js - improved autocorrelation pitch detection + helpers
// Designed to be robust on bass fundamentals (E1=41Hz) across laptop/phone mics.

export function autoCorrelateFloat32(buf, sampleRate) {
  const SIZE = buf.length;

  // RMS (signal level)
  let rms = 0;
  let mean = 0;
  for (let i = 0; i < SIZE; i++) {
    const v = buf[i];
    rms += v * v;
    mean += v;
  }
  rms = Math.sqrt(rms / SIZE);
  mean /= SIZE;

  // Lower gate so quiet interfaces still work; caller can apply its own threshold
  if (rms < 0.003) return { freq: null, confidence: 0, rms };

  // Remove DC offset
  const x = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) x[i] = buf[i] - mean;

  const MIN_FREQ = 35;
  const MAX_FREQ = 400;
  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.floor(sampleRate / MIN_FREQ);

  // Energy for normalization
  let energy = 0;
  for (let i = 0; i < SIZE; i++) energy += x[i] * x[i];
  if (energy <= 1e-9) return { freq: null, confidence: 0, rms };

  let bestLag = -1;
  let bestCorr = -1;

  // Normalized autocorrelation
  // corr(lag) = sum x[i]*x[i+lag] / sqrt(sum x[i]^2 * sum x[i+lag]^2)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < SIZE - lag; i++) {
      const a = x[i];
      const b = x[i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const den = Math.sqrt(e1 * e2) + 1e-12;
    const corr = num / den; // -1..1
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag === -1) return { freq: null, confidence: 0, rms };

  // Parabolic interpolation around bestLag for finer estimate
  const lag = bestLag;
  // Compute local correlations for lag-1, lag, lag+1
  const corrAt = (L) => {
    let num = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < SIZE - L; i++) {
      const a = x[i], b = x[i + L];
      num += a*b; e1 += a*a; e2 += b*b;
    }
    return num / (Math.sqrt(e1*e2) + 1e-12);
  };
  const c0 = lag > minLag ? corrAt(lag - 1) : bestCorr;
  const c1 = bestCorr;
  const c2 = lag < maxLag ? corrAt(lag + 1) : bestCorr;

  let shift = 0;
  const denom = (2*c1 - c0 - c2);
  if (Math.abs(denom) > 1e-6) shift = (c2 - c0) / (2 * denom);
  const refinedLag = lag + shift;

  const freq = sampleRate / refinedLag;

  // Confidence: map corr peak (0..1) into 0..1
  // Typical good pitches will be ~0.6-0.95.
  const confidence = Math.max(0, Math.min(1, (bestCorr - 0.2) / 0.8));

  return { freq, confidence, rms };
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
export function midiToNoteName(midi) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const m = Math.round(midi);
  const name = names[(m + 1200) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}
export function centsOff(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
}
