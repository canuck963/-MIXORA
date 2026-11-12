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
  return {
    bpm: measured,
    beats,
    confidence: consistent.length / intervals.length,
    regularIntervals: consistent.length,
    totalIntervals: intervals.length,
    period: 60 / measured,
    firstBeat: beats[0] ?? null
  };
}
function analyzeTempo(buffer, start, end) {
  return analyzePulse(buffer, start, end);
}
function estimateTempo(buffer, start, end) {
  return analyzePulse(buffer, start, end)?.bpm ?? null;
}

// Compare B's playback rate against A's beat grid and half/double-time
// interpretations. Advisory only; this never changes audio playback.
function tempoMatch(a, b, minRate = 0.7, maxRate = 1.3) {
  if (![a, b, minRate, maxRate].every(Number.isFinite) ||
      a < 60 || a > 180 || b < 60 || b > 180 ||
      minRate <= 0 || maxRate < minRate) return null;
  const options = [
    {id: 'normal', label: 'A ana vuruşu', targetBpm: a, rate: a / b},
    {id: 'half', label: 'A yarım zaman', targetBpm: a / 2, rate: a / (2 * b)},
    {id: 'double', label: 'A çift zaman', targetBpm: a * 2, rate: (a * 2) / b}
  ].map(option => ({...option, inRange: option.rate >= minRate && option.rate <= maxRate}));
  const eligible = options.filter(option => option.inRange);
  const recommended = (eligible.length ? eligible : options)
    .sort((left, right) => Math.abs(Math.log(left.rate)) - Math.abs(Math.log(right.rate)))[0];
  return {options, recommended, minRate, maxRate, hasInRange: eligible.length > 0};
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
      const analysis = analyzeTempo(tracks[id].buffer, range.start, range.end);
      const bpm = analysis?.bpm;
      note(id + (bpm ? ' · Tahmini tempo ' + bpm + ' BPM · güven ' + Math.round(analysis.confidence * 100) + '%' :
        ' · Tempo belirsiz. En az 4 saniyelik, düzenli vuruşlu bir bölüm seç.') + ' Seçimin ilk 30 saniyesine kadar ölçülür.');
    };
  }

  // Local-only helper; it does not upload audio or apply a playback rate.
  if (!$('tempoCompare')) {
    const panel = document.createElement('section');
    panel.className = 'card';
    panel.innerHTML = '<h2>♩ Tempo eşleştirme</h2><p>Seçili A/B bölümlerinin BPM değerlerini karşılaştırır. A’nın normal, yarım veya çift zaman vuruşuna göre B için hız önerir. Bu yalnızca hesaplamadır; oynatma hızını değiştirmez ve hız değişimi perdeyi etkiler.</p><button id="tempoCompare">İki tempoyu karşılaştır</button><div id="tempoCompareResult" class="msg" role="status" aria-live="polite">İki parçayı yükle, en az 4 saniyelik düzenli bölümler seç.</div>';
    document.querySelector('main').append(panel);
  }
  $('tempoCompare').onclick = () => {
    const result = $('tempoCompareResult');
    result.replaceChildren();
    const analyses = {};
    for (const id of ['A', 'B']) {
      if (!tracks[id]) { result.textContent = 'Önce A ve B dosyalarını yükle.'; return; }
      const range = selectRange(id);
      if (!range) { result.textContent = id + ' için geçerli başlangıç/bitiş seç.'; return; }
      analyses[id] = analyzeTempo(tracks[id].buffer, range.start, range.end);
      if (!analyses[id]) { result.textContent = id + ' bölümünde güvenilir tempo bulunamadı. Daha uzun ve düzenli vuruşlu bir kesit dene.'; return; }
    }
    const match = tempoMatch(analyses.A.bpm, analyses.B.bpm);
    const summary = document.createElement('p');
    summary.textContent = 'A: ' + analyses.A.bpm + ' BPM (' + Math.round(analyses.A.confidence * 100) + '% güven) · B: ' +
      analyses.B.bpm + ' BPM (' + Math.round(analyses.B.confidence * 100) + '% güven).';
    result.append(summary);
    for (const option of match.options) {
      const line = document.createElement('p');
      const recommended = option.id === match.recommended.id ? ' ★ Önerilen' : '';
      line.textContent = option.label + ': B ' + option.targetBpm.toFixed(1) + ' BPM için ' +
        (option.rate * 100).toFixed(1) + '% hız' + (option.inRange ? '' : ' (±30% aralığı dışında)') + recommended;
      result.append(line);
    }
    const warning = document.createElement('p');
    warning.textContent = match.hasInRange ?
      'Öneri, ±30% hız aralığında ve 1.0× değerine en yakın seçenektir. Perde korumalı time-stretch henüz uygulanmıyor.' :
      'Hiçbir seçenek ±30% aralığında değil; öneri en az sapmalı matematiksel seçenektir. Dinleyerek karar ver.';
    result.append(warning);
  };
}
