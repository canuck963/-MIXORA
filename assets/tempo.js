// Estimate the pulse from regularly spaced energy attacks in a bounded excerpt.
function analyzePulse(buffer, start, end) {
  const rate = buffer.sampleRate;
  const first = Math.ceil(start * rate);
  const last = Math.min(buffer.length, Math.floor(Math.min(end, start + 30) * rate));
  const frame = Math.round(rate * 0.01);
  if (last - first < rate * 4) return null;

  const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
    (_, index) => buffer.getChannelData(index));
  const attacks = [];
  let previous = 0;
  let strongest = 0;
  for (let offset = first; offset + frame <= last; offset += frame) {
    let power = 0;
    for (const channel of channels) {
      for (let i = offset; i < offset + frame; i += 4) power += channel[i] ** 2;
    }
    const level = Math.sqrt(power / (Math.ceil(frame / 4) * channels.length));
    const attack = Math.max(0, level - previous);
    attacks.push(attack);
    strongest = Math.max(strongest, attack);
    previous = level;
  }
  if (strongest < 0.004) return null;

  const peaks = [];
  for (let i = 1; i < attacks.length - 1; i++) {
    if (attacks[i] < strongest * 0.20 || attacks[i] < attacks[i - 1] || attacks[i] <= attacks[i + 1]) continue;
    const prior = peaks.at(-1);
    if (prior === undefined || (i - prior) * frame >= rate * 0.16) peaks.push(i);
    else if (attacks[i] > attacks[prior]) peaks[peaks.length - 1] = i;
  }
  if (peaks.length < 6) return null;
  const intervals = peaks.slice(1).map((peak, index) => (peak - peaks[index]) * frame / rate);
  const sorted = [...intervals].sort((a, b) => a - b);
  const period = sorted[Math.floor(sorted.length / 2)];
  const bpm = Math.round(60 / period);
  const consistent = intervals.filter(interval => Math.abs(interval - period) <= period * 0.08);
  if (bpm < 60 || bpm > 180 || consistent.length < intervals.length * 0.8) return null;
  // Average consistent gaps to reduce rounding error from the 10 ms frame grid.
  const measured = Math.round(60 * consistent.length / consistent.reduce((sum, gap) => sum + gap, 0));
  if (measured < 60 || measured > 180) return null;
  // An isolated transient may fall between beats. Require regular gaps on both sides.
  const regularGap = gap => Math.abs(gap - period) <= period * 0.08;
  const beats = peaks.filter((_, i) => regularGap(intervals[i - 1]) && regularGap(intervals[i]))
    .map(peak => (first + peak * frame) / rate);
  return {bpm: measured, beats};
}
function estimateTempo(buffer, start, end) {
  return analyzePulse(buffer, start, end)?.bpm ?? null;
}

function alignOverlayEntry(buffer, start, end, delay) {
  const target = start + delay;
  const pulse = analyzePulse(buffer, Math.max(start, target - 5), Math.min(end, target + 5));
  if (!pulse) return null;
  let nearest = null;
  for (const beat of pulse.beats) {
    const distance = Math.abs(beat - target);
    if (distance <= 30 / pulse.bpm && (nearest === null || distance < Math.abs(nearest - target))) nearest = beat;
  }
  return nearest === null ? null : nearest - start;
}
// Skip only a quiet lead-in followed by sustained audio in the first four seconds.
function energeticEntry(buffer, start, end) {
  const rate = buffer.sampleRate;
  const frame = Math.max(1, Math.round(rate * 0.01));
  const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
    (_, index) => buffer.getChannelData(index));
  const first = Math.ceil(start * rate);
  const last = Math.min(buffer.length, Math.floor(Math.min(end, start + 4) * rate));
  let onset = null;
  for (let offset = first; offset + frame <= last; offset += frame) {
    let peak = 0;
    for (const channel of channels) {
      for (let i = offset; i < offset + frame; i++) peak = Math.max(peak, Math.abs(channel[i]));
    }
    if (onset === null) {
      if (peak < 0.001) continue;
      if (offset - first < 0.25 * rate) return start;
      onset = offset;
    }
    // Keep fades, low-level introductions and isolated transients intact.
    if (peak < 0.02) return start;
    if (offset + frame - onset >= 0.06 * rate) {
      const entry = onset / rate - 0.03;
      return end - entry >= 0.25 ? entry : start;
    }
  }
  return start;
}
// End the overlap at a sustained rise after an audible, quieter introduction.
function emotionalFade(buffer, start, end, maxOverlap) {
  const rate = buffer.sampleRate;
  const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
    (_, index) => buffer.getChannelData(index));
  const levels = [];
  const limit = Math.min(end - start, maxOverlap + 0.5, 5.5);
  for (let block = 0; (block + 1) / 4 <= limit; block++) {
    const first = Math.ceil((start + block / 4) * rate);
    const last = Math.min(buffer.length, Math.ceil((start + (block + 1) / 4) * rate));
    let power = 0;
    for (const channel of channels) {
      for (let i = first; i < last; i++) power += channel[i] ** 2;
    }
    levels.push(Math.sqrt(power / ((last - first) * channels.length)));
  }
  if (levels.length < 6) return null;
  const intro = levels.slice(0, 4);
  if (Math.min(...intro) < 0.002) return null;
  const threshold = Math.max(0.02, Math.max(...intro) * 2);
  for (let i = 4; i + 1 < levels.length; i++) {
    if (i / 4 > maxOverlap) break;
    if (levels[i] >= threshold && levels[i + 1] >= threshold) return i / 4;
  }
  return null;
}
if (typeof module === 'object') module.exports = {estimateTempo, alignOverlayEntry, energeticEntry, emotionalFade};

function bindTempoControls(selectRange) {
  for (const id of ['A', 'B']) {
    $('tempo' + id).onclick = () => {
      const range = selectRange(id);
      if (!range) return;
      const bpm = estimateTempo(tracks[id].buffer, range.start, range.end);
      note(id + (bpm ? ' · Tahmini tempo ' + bpm + ' BPM.' : ' · Tempo belirsiz. En az 4 saniyelik, düzenli vuruşlu bir bölüm seç.') + ' Seçimin ilk 30 saniyesine kadar ölçülür.');
    };
  }
}
