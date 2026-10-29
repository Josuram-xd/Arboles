/* Synthesized sound effects (F2). No asset files: every sound is built with WebAudio.
   window.GameAudio = { play(name), toggleMute(), isMuted() }. play() never throws. */
(function () {
  'use strict';

  const MUTE_KEY = 'aventura-muted';
  const MASTER_VOLUME = 0.25; // keep it low: effects, not music

  let ctx = null;
  let master = null;
  let muted = readMuted();

  function readMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveMuted() {
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (e) {
      // storage blocked: the mute still works for this page session
    }
  }

  // AudioContext is created lazily, so it only starts after a user gesture.
  function getContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // One oscillator with an attack/decay envelope. opts: endFreq (pitch glide), filter (lowpass Hz), delay (s).
  function tone(c, at, freq, dur, type, vol, opts = {}) {
    const start = at + (opts.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let out = osc;
    if (opts.filter) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.filter;
      osc.connect(lp);
      out = lp;
    }
    out.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // Short burst of filtered noise: impacts, murmurs, breath.
  function noise(c, at, dur, vol, filterHz) {
    const length = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filterHz;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(master);
    src.start(at);
  }

  const SOUNDS = {
    click: (c, t) => tone(c, t, 1200, 0.03, 'square', 0.15),
    hit: (c, t) => {
      noise(c, t, 0.15, 0.5, 800);
      tone(c, t, 120, 0.15, 'sine', 0.4, { endFreq: 60 });
    },
    heal: (c, t) => {
      [523, 659, 784].forEach((f, i) => tone(c, t, f, 0.25, 'sine', 0.2, { delay: i * 0.09 }));
    },
    pickup: (c, t) => {
      tone(c, t, 880, 0.08, 'triangle', 0.3);
      tone(c, t, 1320, 0.1, 'triangle', 0.25, { delay: 0.08 });
    },
    walker: (c, t) => tone(c, t, 90, 0.6, 'sawtooth', 0.15, { endFreq: 70, filter: 300 }),
    runner: (c, t) => tone(c, t, 900, 0.12, 'square', 0.12, { endFreq: 1400 }),
    brute: (c, t) => {
      tone(c, t, 60, 0.35, 'sine', 0.7, { endFreq: 35 });
      noise(c, t, 0.1, 0.3, 300);
    },
    horde: (c, t) => noise(c, t, 1.2, 0.12, 400),
    victory: (c, t) => {
      [392, 523, 659, 784].forEach((f, i) => tone(c, t, f, 0.3, 'triangle', 0.25, { delay: i * 0.15 }));
    },
    death: (c, t) => tone(c, t, 440, 1.2, 'sawtooth', 0.2, { endFreq: 55, filter: 600 }),
    tree: (c, t) => tone(c, t, 660, 0.12, 'sine', 0.08, { endFreq: 990 })
  };

  const GameAudio = {
    play(name) {
      try {
        if (muted) return;
        const c = getContext();
        const sound = SOUNDS[name];
        if (!c || !sound) return;
        if (c.state === 'suspended') c.resume().catch(() => {});
        sound(c, c.currentTime);
      } catch (e) {
        // audio must never break the game
      }
    },

    toggleMute() {
      muted = !muted;
      saveMuted();
      return muted;
    },

    isMuted() {
      return muted;
    }
  };

  window.GameAudio = GameAudio;
})();
