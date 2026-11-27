// Estimate the pulse from regularly spaced energy attacks in a bounded excerpt.
function analyzePulse(buffer, start, end) {
  if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      !Number.isFinite(buffer.length) || buffer.length <= 0 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 4) return null;

  const rate = buffer.sampleRate;
  const first = Math.ceil(start * rate);
  const last = Math.min(buffer.length, Math.floor(Math.min(end, start + 30) * rate));
  const frame = Math.max(1, Math.round(rate * 0.01));
  if (last - first < rate * 4) return null;

  const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
    (_, index) => buffer.getChannelData(index));
  if (!channels.length) return null;

  // A 10 ms positive-RMS envelope keeps analysis bounded and works on both
  // 44.1/48 kHz mobile decoders without uploading the source file.
  const attacks = [];
  let previous = 0, strongest = 0;
  for (let offset = first; offset + frame <= last; offset += frame) {
    let power = 0, count = 0;
    for (const channel of channels) {
      for (let i = offset; i < offset + frame; i += 4) {
        power += channel[i] * channel[i];
        count++;
      }
    }
    const level = Math.sqrt(power / Math.max(1, count));
    const attack = Math.max(0, level - previous);
    attacks.push(attack);
    strongest = Math.max(strongest, attack);
    previous = level;
  }
  if (strongest < 0.004) return null;

  const peaks = [];
  for (let i = 1; i < attacks.length - 1; i++) {
    if (attacks[i] < strongest * 0.20 || attacks[i] < attacks[i - 1] ||
        attacks[i] <= attacks[i + 1]) continue;
    const prior = peaks.at(-1);
    if (prior === undefined || (i - prior) * frame / rate >= 0.12) peaks.push(i);
    else if (attacks[i] > attacks[prior]) peaks[peaks.length - 1] = i;
  }
  if (peaks.length < 6) return null;

  const events = peaks.map(index => ({
    time: (first + index * frame) / rate,
    weight: attacks[index]
  }));
  const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  // Search a bounded BPM grid instead of trusting the median inter-onset
  // interval. Short syncopated gaps no longer force a false faster tempo.
  const candidates = [];
  const phaseSteps = 32;
  for (let candidateBpm = 60; candidateBpm <= 180.0001; candidateBpm += 0.5) {
    const period = 60 / candidateBpm;
    const phaseStep = period / phaseSteps;
    const tolerance = Math.min(0.08, period * 0.15);
    const sigma = Math.min(0.04, period * 0.06);
    let best = {phase: 0, score: -Infinity, coverage: 0, alignedEvents: []};

    for (let step = 0; step < phaseSteps; step++) {
      const phase = step * phaseStep;
      let score = 0, alignedWeight = 0;
      const alignedEvents = [];
      for (const event of events) {
        const distance = Math.abs(((event.time - phase + period / 2) % period + period) % period - period / 2);
        score += event.weight * Math.exp(-0.5 * (distance / sigma) ** 2);
        if (distance <= tolerance) {
          alignedWeight += event.weight;
          alignedEvents.push(event);
        }
      }
      score /= totalWeight;
      if (score > best.score) {
        best = {phase, score, coverage: alignedWeight / totalWeight, alignedEvents};
      }
    }

    if (best.coverage < 0.25 || !best.alignedEvents.length) continue;
    const occupiedSlots = new Set(best.alignedEvents.map(event =>
      Math.round((event.time - best.phase) / period)));
    const firstSlot = Math.min(...occupiedSlots);
    const lastSlot = Math.max(...occupiedSlots);
    const expectedSlots = Math.max(1, lastSlot - firstSlot + 1);
    const occupancy = occupiedSlots.size / expectedSlots;
    candidates.push({
      bpm: candidateBpm,
      period,
      phase: best.phase,
      coverage: best.coverage,
      score: best.score * (0.7 + 0.3 * occupancy),
      alignedEvents: best.alignedEvents
    });
  }

  candidates.sort((left, right) =>
    right.score - left.score || right.coverage - left.coverage || left.bpm - right.bpm);
  const best = candidates[0];
  if (!best || best.coverage < 0.35) return null;

  // A single onset stream cannot always distinguish (for example) 72 from
  // 144 BPM. Surface that octave alternative rather than silently guessing.
  const octaveCandidate = candidates.find(candidate => {
    const ratio = candidate.bpm / best.bpm;
    const octaveRelated = Math.abs(ratio - 2) <= 0.015 || Math.abs(ratio - 0.5) <= 0.015;
    return candidate !== best && octaveRelated &&
      candidate.coverage >= best.coverage * 0.9 &&
      candidate.score >= best.score * 0.75;
  });
  const bpm = Math.round(best.bpm);
  const beats = best.alignedEvents.map(event => event.time);
  let regularIntervals = 0;
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs((beats[i] - beats[i - 1]) - best.period) <= best.period * 0.12) {
      regularIntervals++;
    }
  }
  const candidateBpms = [...new Set([best.bpm, octaveCandidate?.bpm]
    .filter(Number.isFinite).map(value => Math.round(value)))].sort((a, b) => a - b);

  return {
    bpm,
    beats,
    confidence: best.coverage,
    regularIntervals,
    totalIntervals: Math.max(0, peaks.length - 1),
    period: best.period,
    firstBeat: beats[0] ?? null,
    ambiguous: best.coverage < 0.70 || Boolean(octaveCandidate),
    candidateBpms,
    beatOrigin: best.phase
  };
}

function analyzeTempo(buffer, start, end) {
  return analyzePulse(buffer, start, end);
}
function estimateTempo(buffer, start, end) {
  const analysis = analyzePulse(buffer, start, end);
  return analysis && !analysis.ambiguous ? analysis.bpm : null;
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

// Snap selection edges against beat grids analyzed with context on both sides.
function snapRangeToBeats(buffer, start, end, tolerance) {
  if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      !Number.isFinite(buffer.length) || buffer.length <= 0 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      end > buffer.length / buffer.sampleRate + 0.001 || end - start < 0.15) return null;
  const duration = buffer.length / buffer.sampleRate;
  const context = time => analyzeTempo(buffer, Math.max(0, time - 5), Math.min(duration, time + 5));
  const startAnalysis = context(start), endAnalysis = context(end);
  if (!startAnalysis && !endAnalysis) return null;
  const limitFor = analysis => tolerance === undefined
    ? Math.min(0.3, Math.max(0.08, 15 / analysis.bpm))
    : tolerance;
  if (tolerance !== undefined && (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1)) return null;
  function nearest(analysis, time) {
    if (!analysis || analysis.ambiguous) return null;
    const limit = limitFor(analysis);
    let candidate = null, distance = Infinity;
    for (const beat of analysis.beats) {
      const delta = Math.abs(beat - time);
      if (delta <= limit && delta < distance) { candidate = beat; distance = delta; }
    }
    return candidate;
  }
  const startBeat = nearest(startAnalysis, start), endBeat = nearest(endAnalysis, end);
  if (startBeat === null && endBeat === null) return null;
  const snappedStart = startBeat === null ? start : startBeat;
  const snappedEnd = endBeat === null ? end : endBeat;
  if (snappedEnd - snappedStart < 0.15) return null;
  // Report only the grid(s) that actually moved an edge. A rejected or
  // unused context window must not leak its BPM/confidence into the result.
  const usedAnalyses = [];
  if (startBeat !== null) usedAnalyses.push(startAnalysis);
  if (endBeat !== null) usedAnalyses.push(endAnalysis);
  return {
    start: snappedStart, end: snappedEnd,
    snappedStart: startBeat !== null, snappedEnd: endBeat !== null,
    bpm: usedAnalyses[0].bpm,
    confidence: Math.min(...usedAnalyses.map(analysis => analysis.confidence)),
    tolerance: tolerance ?? Math.min(...usedAnalyses.map(analysis => limitFor(analysis)))
  };
}
function alignOverlayEntry(buffer, start, end, delay) {
  const target = start + delay;
  const pulse = analyzePulse(buffer, Math.max(start, target - 5), Math.min(end, target + 5));
  if (!pulse || pulse.ambiguous) return null;
  let nearest = null;
  for (const beat of pulse.beats) {
    const distance = Math.abs(beat - target);
    if (distance <= 30 / pulse.bpm && (nearest === null || distance < Math.abs(nearest - target))) nearest = beat;
  }
  return nearest === null ? null : nearest - start;
}

// Align an overlay's two source onsets to their own observed beat grids.
// The pair is accepted only when both grids are confident and their projected
// drift stays bounded for the actual overlap; this is phase alignment, not
// time-stretch or a claim that either beat is a musical downbeat.
function alignOverlayPair(aBuffer, aStart, aEnd, bBuffer, bStart, bEnd, delay, maxDriftSeconds = 0.10) {
  if (![aStart, aEnd, bStart, bEnd, delay, maxDriftSeconds].every(Number.isFinite) ||
      aStart < 0 || bStart < 0 || aEnd - aStart < 4 || bEnd - bStart < 4 ||
      delay < 0 || delay >= aEnd - aStart || maxDriftSeconds < 0.02 || maxDriftSeconds > 0.5) return null;

  const a = analyzeTempo(aBuffer, aStart, aEnd);
  const b = analyzeTempo(bBuffer, bStart, bEnd);
  if (!a || !b || a.ambiguous || b.ambiguous) return null;

  function nearestBeat(analysis, target) {
    const tolerance = Math.min(0.25, Math.max(0.06, 15 / analysis.bpm));
    let nearest = null;
    for (const time of analysis.beats) {
      const distance = Math.abs(time - target);
      if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
        nearest = {time, distance};
      }
    }
    return nearest;
  }

  const aBeat = nearestBeat(a, aStart + delay);
  const bBeat = nearestBeat(b, bStart);
  if (!aBeat || !bBeat || bEnd - bBeat.time < 0.15) return null;

  const overlap = Math.min(aEnd - aBeat.time, bEnd - bBeat.time);
  if (overlap < 0.5) return null;
  const averagePeriod = (a.period + b.period) / 2;
  const driftSeconds = Math.abs(a.period - b.period) * overlap / averagePeriod;
  if (!Number.isFinite(driftSeconds) || driftSeconds > maxDriftSeconds) return null;

  return {
    start: bBeat.time,
    delay: aBeat.time - aStart,
    aBpm: a.bpm,
    bBpm: b.bpm,
    driftSeconds,
    confidence: Math.min(a.confidence, b.confidence)
  };
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
// Find a sustained energy lift in B, then require a confident observed beat before
// moving the entry. This is a deterministic signal-analysis heuristic, not phrase detection.
function energeticDropEntry(buffer, start, end) {
  if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      !Number.isInteger(buffer.length) || buffer.length <= 0 ||
      !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      end > buffer.length / buffer.sampleRate + 0.001 || end - start < 4) return null;

  const rate = buffer.sampleRate;
  const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
    (_, index) => buffer.getChannelData(index));
  if (!channels.length) return null;

  const baselineWindow = 1.5;
  const energyWindow = 0.75;
  const stride = 8;
  const rms = (from, to) => {
    const first = Math.max(0, Math.floor(from * rate));
    const last = Math.min(buffer.length, Math.floor(to * rate));
    let power = 0, count = 0;
    for (const channel of channels) {
      for (let index = first; index < last; index += stride) {
        const sample = channel[index];
        if (!Number.isFinite(sample)) return null;
        power += sample * sample;
        count++;
      }
    }
    return count ? Math.sqrt(power / count) : null;
  };

  // Compare equal-length windows. A longer baseline would dilute sparse but
  // regular beats and make a uniform pulse train look like a later energy lift.
  const baselineA = rms(start, Math.min(end, start + energyWindow));
  const baselineB = rms(start + energyWindow, Math.min(end, start + baselineWindow));
  const baseline = baselineA === null || baselineB === null ? null : Math.max(baselineA, baselineB);
  // Reserve a second, non-overlapping window to verify that a candidate is
  // sustained. A single loud kick/snare must not become the remix entry.
  const maxOffset = Math.min(12, end - start - energyWindow * 2);
  if (baseline === null || maxOffset < baselineWindow) return null;

  const threshold = Math.max(baseline * 1.5, baseline + 0.012, 0.02);
  let strongest = null;
  for (let offset = baselineWindow; offset <= maxOffset + 1e-9; offset += 0.25) {
    const level = rms(start + offset, Math.min(end, start + offset + energyWindow));
    if (level === null || level < threshold) continue;

    // The following 750 ms window must retain at least 65% of the candidate's
    // lift above baseline. This rejects isolated transients while allowing a
    // gradual drop whose energy settles after the initial rise.
    const confirmation = rms(
      start + offset + energyWindow,
      Math.min(end, start + offset + energyWindow * 2)
    );
    const requiredConfirmation = baseline + (level - baseline) * 0.65;
    if (confirmation === null || confirmation < requiredConfirmation) continue;

    // Choose the first sustained rise, not a louder later section/outro.
    strongest = {level, offset, confirmation};
    break;
  }
  if (!strongest) return null;

  const analysis = analyzeTempo(buffer, start, end);
  if (!analysis || analysis.ambiguous) return null;
  const target = start + strongest.offset;
  const tolerance = Math.min(0.25, Math.max(0.06, 15 / analysis.bpm));
  let nearest = null;
  for (const beat of analysis.beats) {
    const distance = Math.abs(beat - target);
    if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
      nearest = {time: beat, distance};
    }
  }
  if (!nearest || nearest.time <= start + 0.5 || end - nearest.time < 1) return null;

  return {
    start: nearest.time,
    bpm: analysis.bpm,
    confidence: analysis.confidence,
    energyRatio: strongest.level / Math.max(baseline, 0.005),
    confirmationRatio: strongest.confirmation / Math.max(baseline, 0.005)
  };
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
if (typeof module === 'object') module.exports = {analyzeTempo, estimateTempo, tempoMatch, snapRangeToBeats, alignOverlayEntry, alignOverlayPair, energeticEntry, energeticDropEntry, emotionalFade, bindBeatSnapControls};

function bindBeatSnapControls(selectRange) {
  for (const id of ['A', 'B']) {
    const button = $('snap' + id);
    if (!button) continue;
    button.onclick = () => {
      const range = selectRange(id);
      if (!range || !tracks[id]) return;
      const result = snapRangeToBeats(tracks[id].buffer, range.start, range.end);
      if (!result) {
        note(id + ' bölümünde güvenilir ve yakın vuruş bulunamadı. Kesit değişmedi; daha düzenli bir bölüm dene.');
        return;
      }
      $('start' + id).value = result.start.toFixed(2);
      $('end' + id).value = result.end.toFixed(2);
      const edges = [result.snappedStart ? 'başlangıç' : null, result.snappedEnd ? 'bitiş' : null].filter(Boolean).join(' ve ');
      note(id + ' kesiti ' + edges + ' için gözlenen vuruşa hizalandı · ' + result.bpm +
        ' BPM · ' + Math.round(result.confidence * 100) + '% güven. Yeni değerleri kontrol edip çizelgeye ekle.');
    };
  }
}
function bindTempoControls(selectRange) {
  for (const id of ['A', 'B']) {
    $('tempo' + id).onclick = () => {
      const range = selectRange(id);
      if (!range) return;
      const analysis = analyzeTempo(tracks[id].buffer, range.start, range.end);
      const bpm = analysis?.bpm;
      const candidates = analysis?.candidateBpms?.join(' / ');
      const status = !analysis
        ? ' · Tempo belirsiz. En az 4 saniyelik, düzenli vuruşlu bir bölüm seç.'
        : analysis.ambiguous
          ? ' · Tempo yorumu belirsiz (' + (candidates || bpm) + ' BPM olası). Otomatik hizalama yapılmadı; daha belirgin vuruşlu bir bölüm seç.'
          : ' · Tahmini tempo ' + bpm + ' BPM · saldırı uyumu ' + Math.round(analysis.confidence * 100) + '%';
      note(id + status + ' Seçimin ilk 30 saniyesine kadar ölçülür.');
    };
  }

  // Local-only helper; it does not upload audio or apply a playback rate.
  if (typeof document !== 'undefined' && !$('tempoCompare')) {
    const panel = document.createElement('section');
    panel.className = 'card';
    panel.innerHTML = '<h2>♩ Tempo eşleştirme</h2><p>Seçili A/B bölümlerinin BPM değerlerini karşılaştırır. A’nın normal, yarım veya çift zaman vuruşuna göre B için hız önerir. Bu yalnızca hesaplamadır; oynatma hızını değiştirmez ve hız değişimi perdeyi etkiler.</p><button id="tempoCompare">İki tempoyu karşılaştır</button><div id="tempoCompareResult" class="msg" role="status" aria-live="polite">İki parçayı yükle, en az 4 saniyelik düzenli bölümler seç.</div>';
    document.querySelector('main').append(panel);
  }
  if (typeof document !== 'undefined') $('tempoCompare').onclick = () => {
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
    const uncertain = ['A', 'B'].filter(id => analyses[id].ambiguous);
    if (uncertain.length) {
      const detail = uncertain.map(id => id + ': ' +
        (analyses[id].candidateBpms?.join(' / ') || analyses[id].bpm) + ' BPM').join(' · ');
      result.textContent = 'Tempo yorumu belirsiz (' + detail +
        '). Güvenilir hız önerisi verilmedi; daha belirgin vuruşlu kesit seç.';
      return;
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
