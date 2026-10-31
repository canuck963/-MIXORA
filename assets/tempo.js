// Estimate the pulse from regularly spaced energy attacks in a bounded excerpt.
function estimateTempo(buffer, start, end) {
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
  return Math.round(60 * consistent.length / consistent.reduce((sum, gap) => sum + gap, 0));
}
if (typeof module === 'object') module.exports = {estimateTempo};

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
