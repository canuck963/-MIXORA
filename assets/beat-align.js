// Cancellable, playback-rate-aware beat start for the live DJ decks.
// Beat phase is anchored at track time 0 until a reliable downbeat detector exists.
(function (root) {
  'use strict';

  function nextBeatDelaySeconds(currentTime, bpm, playbackRate = 1, beatOrigin = 0) {
    if (![currentTime, bpm, playbackRate, beatOrigin].every(Number.isFinite) ||
        currentTime < 0 || bpm < 40 || bpm > 240 || playbackRate <= 0) return null;
    const period = 60 / bpm;
    const phase = ((currentTime - beatOrigin) % period + period) % period;
    let remaining = period - phase;
    // Avoid a zero-delay race when the playhead is already on the grid.
    if (remaining <= Math.max(0.025, period * 0.03)) remaining = period;
    return remaining / playbackRate;
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

    function schedule(audioA, audioB, bpm, onStatus = () => {}) {
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

      const getDelay = () => nextBeatDelaySeconds(
        Number(audioA.currentTime), Number(bpm), Number(audioA.playbackRate), 0
      );
      const initialDelay = getDelay();
      if (initialDelay === null) {
        onStatus('BPM (40–240) veya A oynatma hızı geçersiz.');
        return false;
      }

      const invalidate = message => {
        if (id !== generation) return;
        cancel();
        if (message) onStatus(message);
      };
      const onRateChange = () => {
        if (id === generation) schedule(audioA, audioB, bpm, onStatus);
      };
      const onPause = () => invalidate('A duraklatıldı; bekleyen B başlatması iptal edildi.');
      const onEnded = () => invalidate('A sona erdi; bekleyen B başlatması iptal edildi.');
      const onSourceChange = () => invalidate('Parça değişti; bekleyen B başlatması iptal edildi.');
      const listen = (target, event, handler) => {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(event, handler);
        detach.push(() => target.removeEventListener(event, handler));
      };
      listen(audioA, 'pause', onPause);
      listen(audioA, 'ended', onEnded);
      listen(audioA, 'emptied', onSourceChange);
      listen(audioA, 'loadstart', onSourceChange);
      listen(audioA, 'ratechange', onRateChange);
      listen(audioB, 'emptied', onSourceChange);
      listen(audioB, 'loadstart', onSourceChange);

      onStatus('B yaklaşık ' + Math.round(initialDelay * 1000) +
        ' ms sonra başlayacak. Grid, A dosyasının 0. saniyesine göre tahminidir; ilk vuruş algılanmadı.');
      timer = scheduleTimeout(async () => {
        timer = null;
        if (id !== generation) return;
        if (audioA.paused || audioA.src !== sourceA || audioB.src !== sourceB) {
          invalidate('A durdu veya parça değişti; B başlatması iptal edildi.');
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
      }, Math.max(1, Math.round(initialDelay * 1000)));
      return true;
    }

    return { schedule, cancel };
  }

  root.MIXORABeatAlign = { nextBeatDelaySeconds, createBeatScheduler };
  if (typeof module === 'object' && module.exports) {
    module.exports = root.MIXORABeatAlign;
  }
})(typeof window !== 'undefined' ? window : globalThis);
