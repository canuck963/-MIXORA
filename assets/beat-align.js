// Cancellable, playback-rate-aware beat start for the live DJ decks.
// Local onset phase is estimated; musical downbeat/phrase detection remains out of scope.
(function (root) {
  'use strict';

  function nextBeatTargetTimeSeconds(currentTime, bpm, beatOrigin = 0) {
    if (![currentTime, bpm, beatOrigin].every(Number.isFinite) ||
        currentTime < 0 || bpm < 40 || bpm > 240) return null;
    const period = 60 / bpm;
    const phase = ((currentTime - beatOrigin) % period + period) % period;
    let remaining = period - phase;
    // Avoid a zero-delay race when the playhead is already on the grid.
    if (remaining <= Math.max(0.025, period * 0.03)) remaining = period;
    return currentTime + remaining;
  }

  function nextBeatDelaySeconds(currentTime, bpm, playbackRate = 1, beatOrigin = 0) {
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null;
    const target = nextBeatTargetTimeSeconds(currentTime, bpm, beatOrigin);
    return target === null ? null : (target - currentTime) / playbackRate;
  }

  function estimateBeatPhase(buffer, bpm, maxSeconds = 30) {
    if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
        !Number.isFinite(buffer.length) || buffer.length <= 0 ||
        !Number.isFinite(bpm) || bpm < 40 || bpm > 240 ||
        !Number.isFinite(maxSeconds) || maxSeconds < 4) return null;
    const rate = buffer.sampleRate, duration = Math.min(buffer.length / rate, maxSeconds);
    const frame = Math.max(1, Math.round(rate * 0.01));
    const channels = Array.from({length: Math.min(2, buffer.numberOfChannels)},
      (_, index) => buffer.getChannelData(index));
    if (!channels.length || duration < 4) return null;
    const attacks = [];
    let previous = 0, strongest = 0;
    for (let offset = 0; offset + frame <= duration * rate; offset += frame) {
      let power = 0, count = 0;
      for (const channel of channels) {
        for (let i = offset; i < offset + frame; i += 4) {
          power += channel[i] * channel[i]; count++;
        }
      }
      const level = Math.sqrt(power / Math.max(1, count));
      const attack = Math.max(0, level - previous);
      attacks.push(attack); strongest = Math.max(strongest, attack); previous = level;
    }
    if (strongest < 0.004) return null;
    const peaks = [];
    for (let i = 1; i < attacks.length - 1; i++) {
      if (attacks[i] < strongest * 0.18 || attacks[i] < attacks[i - 1] ||
          attacks[i] <= attacks[i + 1]) continue;
      const prior = peaks.at(-1);
      if (prior === undefined || (i - prior) * frame / rate >= 0.12) peaks.push(i);
      else if (attacks[i] > attacks[prior]) peaks[peaks.length - 1] = i;
    }
    if (peaks.length < 6) return null;
    const period = 60 / bpm;
    const events = peaks.map(index => ({time: index * frame / rate, weight: attacks[index]}));
    const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
    const step = Math.max(0.002, period / 200), tolerance = Math.min(0.075, period * 0.16);
    let bestPhase = 0, bestScore = -Infinity, bestAligned = 0;
    const phaseScores = [];
    for (let phase = 0; phase < period; phase += step) {
      let score = 0, aligned = 0;
      for (const event of events) {
        const distance = Math.abs(((event.time - phase + period / 2) % period + period) % period - period / 2);
        score += event.weight * Math.exp(-0.5 * (distance / tolerance) ** 2);
        if (distance <= tolerance) aligned += event.weight;
      }
      phaseScores.push({phase, score});
      if (score > bestScore) { bestScore = score; bestPhase = phase; bestAligned = aligned; }
    }
    const confidence = bestAligned / Math.max(1e-12, totalWeight);
    // A strong score alone is not enough: equally strong offbeat attacks can
    // support two competing grids. Compare only peaks outside the best grid's
    // main tolerance lobe so adjacent samples do not count as competitors.
    const ambiguityWindow = Math.max(step * 3, tolerance * 1.5);
    let competingScore = 0;
    for (const candidate of phaseScores) {
      const distance = Math.abs(((candidate.phase - bestPhase + period / 2) % period + period) % period - period / 2);
      if (distance > ambiguityWindow) competingScore = Math.max(competingScore, candidate.score);
    }
    const phaseMargin = Math.max(0, (bestScore - competingScore) / Math.max(1e-12, bestScore));
    if (!Number.isFinite(bestPhase) || confidence < 0.35 || phaseMargin < 0.12) return null;
    return {beatOrigin: bestPhase, bpm, period, confidence, phaseMargin, detectedAttacks: peaks.length};
  }

  function createBeatScheduler(options = {}) {
    const scheduleTimeout = options.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const clearTimeoutFn = options.clearTimeoutFn || (id => clearTimeout(id));
    let timer = null;
    let generation = 0;
    let detach = [];
    let attemptedAudio = null;

    function removeListeners() {
      for (const remove of detach) remove();
      detach = [];
    }

    function cancel() {
      generation += 1;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      removeListeners();
      if (attemptedAudio) {
        try { attemptedAudio.pause(); } catch (_) {}
        attemptedAudio = null;
      }
    }

    function schedule(audioA, audioB, bpm, onStatus = () => {}, beatOrigin = 0) {
      cancel();
      const id = generation;
      const sourceA = audioA && audioA.src;
      const sourceB = audioB && audioB.src;
      if (!audioA || !audioB || !sourceA || !sourceB) {
        onStatus('Önce iki şarkıyı yükle.');
        return false;
      }
      if (audioA.paused) {
        onStatus('Önce A parçasını çal. Sonraki tahmini vuruşta B başlatılacak.');
        return false;
      }
      if (!audioB.paused) {
        onStatus('B zaten çalıyor. Önce B’yi duraklat; hizalı başlatma çalan parçayı yeniden başlatmaz.');
        return false;
      }

      const currentTime = Number(audioA.currentTime);
      const playbackRate = Number(audioA.playbackRate);
      let targetBeatTime = nextBeatTargetTimeSeconds(currentTime, Number(bpm), Number(beatOrigin));
      const initialDelay = targetBeatTime === null || !Number.isFinite(playbackRate) || playbackRate <= 0
        ? null : (targetBeatTime - currentTime) / playbackRate;
      if (initialDelay === null) {
        onStatus('BPM (40–240), A oynatma konumu veya hızı geçersiz.');
        return false;
      }

      const invalidate = message => {
        if (id !== generation) return;
        cancel();
        if (message) onStatus(message);
      };
      const onRateChange = () => {
        if (id === generation) schedule(audioA, audioB, bpm, onStatus, beatOrigin);
      };
      const onPause = () => invalidate('A duraklatıldı; bekleyen B başlatması iptal edildi.');
      const onEnded = () => invalidate('A sona erdi; bekleyen B başlatması iptal edildi.');
      const onSeeking = () => invalidate('A parçasında konum değişti; bekleyen B başlatması iptal edildi.');
      const onSourceChange = () => invalidate('Parça değişti; bekleyen B başlatması iptal edildi.');
      const onManualBPlay = () => {
        if (id === generation && attemptedAudio !== audioB) {
          invalidate('B elle başlatıldı; bekleyen hizalı başlatma iptal edildi.');
        }
      };
      const listen = (target, event, handler) => {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(event, handler);
        detach.push(() => target.removeEventListener(event, handler));
      };
      listen(audioA, 'pause', onPause);
      listen(audioA, 'ended', onEnded);
      listen(audioA, 'seeking', onSeeking);
      listen(audioA, 'emptied', onSourceChange);
      listen(audioA, 'loadstart', onSourceChange);
      listen(audioA, 'ratechange', onRateChange);
      listen(audioB, 'emptied', onSourceChange);
      listen(audioB, 'loadstart', onSourceChange);
      listen(audioB, 'play', onManualBPlay);

      onStatus('B yaklaşık ' + Math.round(initialDelay * 1000) +
        ' ms sonra başlayacak. Grid fazı A dosyasında ' + Number(beatOrigin).toFixed(3) + ' sn; kulakla kontrol et.');
      const period = 60 / Number(bpm);
      const timingTolerance = Math.min(0.06, Math.max(0.025, period * 0.08));
      const queueTargetCheck = delaySeconds => {
        timer = scheduleTimeout(runAtTarget, Math.max(1, Math.round(delaySeconds * 1000)));
      };
      const runAtTarget = async () => {
        timer = null;
        if (id !== generation) return;
        if (audioA.paused || audioA.src !== sourceA) {
          invalidate('A durdu veya parça değişti; B başlatması iptal edildi.');
          return;
        }
        if (audioB.src !== sourceB) {
          invalidate('B parçası değişti; bekleyen hizalı başlatma iptal edildi.');
          return;
        }
        if (!audioB.paused) {
          invalidate('B elle başlatıldı; bekleyen hizalı başlatma iptal edildi.');
          return;
        }

        const now = Number(audioA.currentTime);
        const rate = Number(audioA.playbackRate);
        if (!Number.isFinite(now) || now < 0 || !Number.isFinite(rate) || rate <= 0) {
          invalidate('A oynatma konumu veya hızı geçersiz; B başlatması iptal edildi.');
          return;
        }

        const remaining = targetBeatTime - now;
        if (remaining > timingTolerance) {
          // setTimeout may fire early while the media clock is still behind.
          queueTargetCheck(remaining / rate);
          return;
        }
        if (remaining < -timingTolerance) {
          // A throttled tab or busy main thread can miss the target. Never
          // start B on a stale beat: move to the next grid point instead.
          const nextIndex = Math.floor((now - Number(beatOrigin)) / period) + 1;
          targetBeatTime = Number(beatOrigin) + nextIndex * period;
          const nextRemaining = targetBeatTime - now;
          if (!Number.isFinite(nextRemaining) || nextRemaining <= 0) {
            invalidate('Yeni vuruş zamanı hesaplanamadı; B başlatması iptal edildi.');
            return;
          }
          onStatus('Zamanlayıcı hedef vuruşu kaçırdı; sonraki tahmini vuruş bekleniyor.');
          queueTargetCheck(nextRemaining / rate);
          return;
        }

        attemptedAudio = audioB;
        try {
          await audioB.play();
          if (id === generation) onStatus('✓ B tahmini vuruşta başlatıldı. Kulakla kontrol et.');
          else {
            try { audioB.pause(); } catch (_) {}
          }
        } catch (error) {
          if (id === generation) onStatus('B başlatılamadı. Safari’de B kanalındaki ▶️ düğmesine dokun.');
        } finally {
          if (id === generation) {
            attemptedAudio = null;
            removeListeners();
          }
        }
      };
      queueTargetCheck(initialDelay);
      return true;
    }

    return { schedule, cancel };
  }

  root.MIXORABeatAlign = { nextBeatDelaySeconds, nextBeatTargetTimeSeconds, estimateBeatPhase, createBeatScheduler };
  if (typeof module === 'object' && module.exports) {
    module.exports = root.MIXORABeatAlign;
  }
})(typeof window !== 'undefined' ? window : globalThis);
