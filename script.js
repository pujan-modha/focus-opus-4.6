/**
 * Focus — A minimal daily work/break timer.
 *
 * Architecture: Single IIFE, no frameworks, no build tools.
 * Three files: index.html, style.css, script.js.
 *
 * @file Main application logic — timer engine, audio, UI, persistence.
 */
(function () {
  'use strict';

  /* ================================================================
     CONSTANTS
     ================================================================ */

  /** @type {string[]} Available Catppuccin accent color names. */
  var ACCENTS = [
    'rosewater', 'flamingo', 'pink', 'mauve',
    'red', 'maroon', 'peach', 'yellow',
    'green', 'teal', 'sky', 'sapphire',
    'blue', 'lavender'
  ];

  /** @type {Object<string, {workMin: number, breakMin: number, blocks: Array}>} Built-in schedule presets. */
  var PRESETS = {
    pomodoro: {
      workMin: 25,
      breakMin: 5,
      blocks: [
        { cycles: 4, majorBreak: 30 }
      ]
    },
    deepwork: {
      workMin: 50,
      breakMin: 10,
      blocks: [
        { cycles: 3, majorBreak: 60 },
        { cycles: 2, majorBreak: 60 },
        { cycles: 2, majorBreak: 60 },
        { cycles: 1, majorBreak: 0 }
      ]
    }
  };

  /** @constant {string} localStorage key for user configuration. */
  var LS_CONFIG  = 'st-config';
  /** @constant {string} localStorage key for theme preference. */
  var LS_THEME   = 'st-theme';
  /** @constant {string} localStorage key for accent color. */
  var LS_ACCENT  = 'st-accent';
  /** @constant {string} localStorage key for custom presets. */
  var LS_PRESETS = 'st-presets';

  /** @type {{enabled: boolean, volume: number, workTone: string, breakTone: string}} Default sound config for new users. */
  var DEFAULT_SOUND = { enabled: true, volume: 0.5, workTone: 'chime', breakTone: 'bell' };

  /** @type {string[]} Available tone names, matching keys in TONE_DEFS. */
  var TONE_NAMES = ['chime', 'ping', 'bell', 'pulse', 'beep', 'tap'];

  /** @constant {string} Application display name, used in titles and notifications. */
  var APP_NAME = 'Focus';

  /** @constant {number} SVG ring circumference: 2 * PI * r, where r=90 in a 200x200 viewBox. */
  var RING_CIRCUMFERENCE = 2 * Math.PI * 90;


  /* ================================================================
     STATE
     ================================================================ */

  /** @type {?Object} Current timer configuration (workMin, breakMin, blocks[]). */
  var config = null;
  /** @type {Array<{type: string, duration: number}>} Flat timeline of segments. */
  var timeline = [];
  /** @type {number} Index of the current segment in the timeline. */
  var currentIndex = 0;
  /** @type {number} Seconds remaining in the current segment. */
  var remainingSeconds = 0;
  /** @type {string} Current state machine state: idle | running | paused | waiting | done. */
  var state = 'idle';
  /** @type {?number} setInterval ID for the 250ms tick loop. */
  var tickIntervalId = null;
  /** @type {?number} setTimeout ID for exact segment-end transition. */
  var transitionTimerId = null;
  /** @type {number} Wall-clock timestamp (ms) when the current segment ends. */
  var targetTime = 0;
  /** @type {?string} Active preset key: 'pomodoro' | 'deepwork' | 'custom:<name>' | null. */
  var activePreset = null;
  /** @type {Object<string, Object>} User-saved custom presets: { name: { workMin, breakMin, blocks[] } }. */
  var customPresets = {};
  /** @type {boolean} Whether the timer was running when the drawer was opened. */
  var wasRunningBeforeDrawer = false;
  /** @type {boolean} Whether the settings drawer is currently open. */
  var drawerOpen = false;
  /** @type {?Object} Snapshot of state before a skip, used for undo. */
  var skipSnapshot = null;
  /** @type {?number} setTimeout ID for auto-dismissing the toast. */
  var toastTimerId = null;
  /** @type {number} Completed work cycles in loop mode. */
  var loopCycleCount = 0;
  /** @type {number} Last displayed seconds value, used to skip redundant DOM updates. */
  var lastDisplayedSeconds = -1;
  /** @type {string} Previously displayed phase text, used to avoid redundant transitions. */
  var prevPhaseText = '';
  /** @type {number} Last rendered segment index for progress guard. */
  var lastRenderedProgressIndex = -1;
  /** @type {string} Last rendered state for progress guard. */
  var lastRenderedProgressState = '';
  /** @type {string} Last rendered control state key, prevents innerHTML blink. */
  var lastRenderedControlState = '';
  /** @type {boolean} Whether focus mode is currently active. */
  var focusMode = false;
  /** @type {?number} setTimeout ID for auto-hiding the focus mode exit hint. */
  var focusHintTimerId = null;
  /** @type {boolean} Whether the keyboard hints panel is visible. */
  var hintsVisible = false;
  /** @type {?number} setTimeout ID for auto-dismissing the keyboard hints panel. */
  var hintsTimerId = null;
  /** @type {?number} setInterval ID for the 1-second wall clock update. */
  var clockIntervalId = null;


  /* ================================================================
     DOM REFERENCES
     All DOM element references use the `el` prefix for consistency.
     ================================================================ */

  var elRoot = document.documentElement;
  var elMain = document.getElementById('main');
  var elPhase = document.getElementById('phase');
  var elTimer = document.getElementById('timer');
  var elClock = document.getElementById('clock');
  var elProgress = document.getElementById('progress');
  var elControls = document.getElementById('controls');

  var elDrawer = document.getElementById('drawer');
  var elDrawerClose = document.getElementById('drawer-close');
  var elBackdrop = document.getElementById('drawer-backdrop');
  var elSettingsToggle = document.getElementById('settings-toggle');
  var elFlashOverlay = document.getElementById('flash-overlay');
  var elToast = document.getElementById('toast');
  var elRingFill = document.querySelector('#ring .ring-fill');
  var elFocusToggle = document.getElementById('focus-toggle');
  var elHelpToggle = document.getElementById('help-toggle');
  var elFocusHint = document.getElementById('focus-hint');
  var elHints = document.getElementById('hints');

  var elCfgWork = document.getElementById('cfg-work');
  var elCfgBreak = document.getElementById('cfg-break');
  var elBlocksList = document.getElementById('blocks-list');
  var elAddBlock = document.getElementById('add-block');
  var elAccentPicker = document.getElementById('accent-picker');
  var elThemeSwitch = document.getElementById('theme-switch');

  var elSoundToggle = document.getElementById('cfg-sound-toggle');
  var elVolume = document.getElementById('cfg-volume');
  var elVolumeNum = document.getElementById('cfg-volume-num');
  var elWorkToneSelector = document.getElementById('work-tone-selector');
  var elBreakToneSelector = document.getElementById('break-tone-selector');
  var elNotificationsToggle = document.getElementById('cfg-notifications');
  var elAutoContinueToggle = document.getElementById('cfg-auto-continue');
  var elLoopToggle = document.getElementById('cfg-loop');
  var elBlocksSection = elBlocksList.closest('.drawer-section');

  var elPresetBtns = document.querySelectorAll('.preset-btn');

  var elCustomPresetsRow = document.getElementById('custom-presets-row');
  var elSavePresetBtn = document.getElementById('save-preset-btn');
  var elSavePresetInput = document.getElementById('save-preset-input');
  var elPresetNameInput = document.getElementById('preset-name-input');
  var elPresetNameConfirm = document.getElementById('preset-name-confirm');
  var elPresetNameCancel = document.getElementById('preset-name-cancel');
  var elExportBtn = document.getElementById('export-btn');
  var elImportBtn = document.getElementById('import-btn');
  var elImportFileInput = document.getElementById('import-file-input');


  /* ================================================================
     UTILITIES
     ================================================================ */

  /**
   * Pad a number to two digits with a leading zero.
   * @param {number} n - The number to pad.
   * @returns {string} Zero-padded string.
   */
  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /**
   * Clamp a number between a minimum and maximum.
   * @param {number} val - Value to clamp.
   * @param {number} min - Minimum bound.
   * @param {number} max - Maximum bound.
   * @returns {number} Clamped value.
   */
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Deep clone an object via JSON serialization.
   * @param {Object} obj - Object to clone.
   * @returns {Object} Cloned copy.
   */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Map a segment type string to its display label.
   * @param {string} segType - 'work', 'break', or 'majorBreak'.
   * @returns {string} Human-readable label.
   */
  function phaseLabel(segType) {
    return segType === 'work' ? 'Work'
         : segType === 'majorBreak' ? 'Major Break'
         : 'Break';
  }


  /* ================================================================
     AUDIO ENGINE
     Hybrid approach for reliable background-tab audio:

     1. Pre-render tones into AudioBuffers via OfflineAudioContext at init.
     2. On first user interaction, create a persistent AudioContext with a
        silent keep-alive oscillator so the context stays active even when
        the tab is backgrounded.
     3. Play tones by decoding the pre-rendered buffers through the live
        AudioContext. The keep-alive prevents browser suspension.
     4. Fallback: if AudioContext is unavailable, fall back to
        HTMLAudioElement with WAV blob URLs.
     ================================================================ */

  /** @type {Object<string, AudioBuffer>} Pre-rendered tone AudioBuffers for live playback. */
  var toneBuffers = {};
  /** @type {Object<string, string>} Blob URLs for fallback HTMLAudioElement playback. */
  var toneURLs = {};
  /** @type {boolean} Whether all tones have been pre-rendered and are ready. */
  var audioReady = false;
  /** @type {?AudioContext} Persistent AudioContext for live playback. */
  var liveCtx = null;
  /** @type {?{osc: OscillatorNode, gain: GainNode}} Silent keep-alive oscillator refs. */
  var keepAliveNode = null;

  /**
   * Tone definitions: each is a function(ctx, dest, time) that schedules
   * oscillators into an OfflineAudioContext for rendering.
   * All rendered at full volume; playback volume applied at play time.
   */
  var TONE_DEFS = {
    chime: { duration: 0.8, render: function (ctx, dest, t) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      g.connect(dest);
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(523.25, t);
      o.frequency.setValueAtTime(659.25, t + 0.15);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.8);
    }},
    ping: { duration: 0.3, render: function (ctx, dest, t) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      g.connect(dest);
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1046.5, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.3);
    }},
    bell: { duration: 1.2, render: function (ctx, dest, t) {
      var freqs = [440, 880, 1320];
      var amps = [0.4, 0.2, 0.1];
      for (var i = 0; i < freqs.length; i++) {
        var g = ctx.createGain();
        g.gain.setValueAtTime(amps[i], t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
        g.connect(dest);
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(freqs[i], t);
        o.connect(g);
        o.start(t);
        o.stop(t + 1.2);
      }
    }},
    pulse: { duration: 0.4, render: function (ctx, dest, t) {
      for (var p = 0; p < 2; p++) {
        var st = t + p * 0.2;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.45, st);
        g.gain.exponentialRampToValueAtTime(0.001, st + 0.15);
        g.connect(dest);
        var o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(587.33, st);
        o.connect(g);
        o.start(st);
        o.stop(st + 0.15);
      }
    }},
    beep: { duration: 0.2, render: function (ctx, dest, t) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      g.connect(dest);
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(784, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
    }},
    tap: { duration: 0.1, render: function (ctx, dest, t) {
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      g.connect(dest);
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(330, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.1);
    }}
  };

  /**
   * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
   * Used to create fallback blob URLs for HTMLAudioElement playback.
   * @param {AudioBuffer} buffer - The rendered audio buffer to encode.
   * @returns {Blob} WAV-encoded audio blob.
   */
  function audioBufferToWav(buffer) {
    var numChannels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var format = 1; // PCM
    var bitsPerSample = 16;

    var channels = [];
    for (var c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }
    var numFrames = buffer.length;
    var bytesPerSample = bitsPerSample / 8;
    var blockAlign = numChannels * bytesPerSample;
    var dataSize = numFrames * blockAlign;
    var headerSize = 44;
    var arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    var view = new DataView(arrayBuffer);

    // WAV header
    function writeString(offset, str) {
      for (var i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave and write samples
    var offset = 44;
    for (var i = 0; i < numFrames; i++) {
      for (var c = 0; c < numChannels; c++) {
        var sample = channels[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Pre-render all tones into AudioBuffers and WAV blob URLs asynchronously.
   * Sets audioReady=true when all tones are processed.
   */
  function initToneBlobs() {
    var names = Object.keys(TONE_DEFS);
    var pending = names.length;

    names.forEach(function (name) {
      var def = TONE_DEFS[name];
      var sampleRate = 44100;
      var length = Math.ceil(def.duration * sampleRate);
      var offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, length, sampleRate);

      def.render(offlineCtx, offlineCtx.destination, 0);

      offlineCtx.startRendering().then(function (renderedBuffer) {
        toneBuffers[name] = renderedBuffer;
        var blob = audioBufferToWav(renderedBuffer);
        toneURLs[name] = URL.createObjectURL(blob);
        pending--;
        if (pending === 0) audioReady = true;
      }).catch(function () {
        pending--;
        if (pending === 0) audioReady = true;
      });
    });
  }

  /**
   * Initialize the persistent AudioContext and silent keep-alive oscillator.
   * Must be called from a user gesture (click/keydown) to comply with autoplay policy.
   * Subsequent calls resume the context if it was suspended.
   */
  function ensureLiveContext() {
    if (liveCtx) {
      // Resume if suspended (browsers suspend until user gesture)
      if (liveCtx.state === 'suspended') {
        liveCtx.resume().catch(function () {});
      }
      return;
    }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      liveCtx = new Ctx();

      // Silent keep-alive: a constant source at zero amplitude.
      // This keeps the AudioContext from being suspended in background tabs.
      var osc = liveCtx.createOscillator();
      var gain = liveCtx.createGain();
      gain.gain.value = 0; // completely silent
      osc.connect(gain);
      gain.connect(liveCtx.destination);
      osc.start();
      keepAliveNode = { osc: osc, gain: gain };
    } catch (e) {
      liveCtx = null;
    }
  }

  /**
   * Play a tone through the live AudioContext (reliable in background tabs).
   * @param {string} name - Tone name from TONE_DEFS.
   * @param {number} volume - Playback volume (0-1).
   * @returns {boolean} Whether playback succeeded.
   */
  function playToneLive(name, volume) {
    if (!liveCtx || liveCtx.state !== 'running') return false;
    var buf = toneBuffers[name];
    if (!buf) return false;
    try {
      var source = liveCtx.createBufferSource();
      source.buffer = buf;
      var gain = liveCtx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(liveCtx.destination);
      source.start(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Fallback: play a tone via HTMLAudioElement (works in foreground only).
   * @param {string} name - Tone name from TONE_DEFS.
   * @param {number} volume - Playback volume (0-1).
   */
  function playToneFallback(name, volume) {
    if (!toneURLs[name]) return;
    try {
      var audio = new Audio(toneURLs[name]);
      audio.volume = volume;
      audio.play().catch(function () {});
    } catch (e) {
      // Silently fail
    }
  }

  /**
   * Play a named tone at the configured volume.
   * Tries the live AudioContext first, falls back to HTMLAudioElement.
   * @param {string} name - Tone name from TONE_DEFS.
   * @param {boolean} [preview=false] - If true, bypass the sound-enabled check (for UI previews).
   */
  function playTone(name, preview) {
    if (!preview && (!config.sound || !config.sound.enabled)) return;
    if (!audioReady) return;
    var vol = config.sound.volume;
    // Try live AudioContext first (works in background tabs)
    if (!playToneLive(name, vol)) {
      // Fallback to HTMLAudioElement
      playToneFallback(name, vol);
    }
  }

  /**
   * Play the appropriate transition tone for a segment type.
   * @param {string} segType - 'work', 'break', or 'majorBreak'.
   */
  function playTransitionTone(segType) {
    if (!config.sound || !config.sound.enabled) return;
    var tone = segType === 'work' ? config.sound.workTone : config.sound.breakTone;
    playTone(tone);
  }

  // Force immediate timer catch-up when tab becomes visible again
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      // Resume AudioContext if it was suspended
      if (liveCtx && liveCtx.state === 'suspended') {
        liveCtx.resume().catch(function () {});
      }
      if (state === 'running') {
        tick();
      }
    }
  });


  /* ================================================================
     VISUAL FLASH
     ================================================================ */

  /** Trigger the full-screen flash overlay animation on phase transitions. */
  function flash() {
    elFlashOverlay.classList.remove('flash');
    void elFlashOverlay.offsetWidth; // force reflow
    elFlashOverlay.classList.add('flash');
  }


  /* ================================================================
     TOAST (skip undo)
     ================================================================ */

  /**
   * Show a toast notification at the bottom of the screen.
   * If a skip snapshot exists, includes an undo button.
   * @param {string} message - Text to display.
   */
  function showToast(message) {
    clearTimeout(toastTimerId);
    elToast.innerHTML = '<span>' + message + '</span>' +
      (skipSnapshot ? '<button class="toast-undo">undo</button>' : '');
    elToast.classList.add('visible');

    // Bind undo
    var undoBtn = elToast.querySelector('.toast-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', undoSkip);
    }

    toastTimerId = setTimeout(hideToast, 4000);
  }

  /** Hide the toast notification, clear its auto-dismiss timer, and discard any stale skip snapshot. */
  function hideToast() {
    elToast.classList.remove('visible');
    clearTimeout(toastTimerId);
    toastTimerId = null;
    skipSnapshot = null;
  }

  /** Undo the last skip, restoring the previous segment and timer state. */
  function undoSkip() {
    if (!skipSnapshot) return;
    currentIndex = skipSnapshot.currentIndex;
    remainingSeconds = skipSnapshot.remainingSeconds;
    if (skipSnapshot.loopCycleCount !== undefined) {
      loopCycleCount = skipSnapshot.loopCycleCount;
    }

    var prevState = skipSnapshot.state;
    skipSnapshot = null;
    hideToast();

    // Restore timer state
    stopTicking();
    state = prevState;
    if (prevState === 'running') {
      targetTime = Date.now() + remainingSeconds * 1000;
      startTicking();
    }

    updateDisplay();
  }


  /* ================================================================
     DESKTOP NOTIFICATIONS
     ================================================================ */

  /**
   * Fire a desktop notification if enabled and permitted.
   * @param {string} title - Notification title.
   * @param {string} body - Notification body text.
   */
  function fireNotification(title, body) {
    if (!config.notifications) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body: body, icon: '', silent: true });
    } catch (e) {
      // Silently fail
    }
  }


  /* ================================================================
     CONFIG & PERSISTENCE
     ================================================================ */

  /** Load configuration from localStorage, falling back to Pomodoro defaults. */
  function loadConfig() {
    var raw = localStorage.getItem(LS_CONFIG);
    if (raw) {
      try {
        config = JSON.parse(raw);
        // Validate structure
        if (!config.workMin || !config.breakMin || !Array.isArray(config.blocks) || config.blocks.length === 0) {
          throw new Error('invalid');
        }
      } catch (e) {
        config = null;
      }
    }
    if (!config) {
      config = deepClone(PRESETS.pomodoro);
    }
    // Ensure sound config exists
    if (!config.sound) {
      config.sound = deepClone(DEFAULT_SOUND);
    }
    // Ensure notifications config exists
    if (config.notifications === undefined) {
      config.notifications = false;
    }
    // Ensure autoContinue config exists
    if (config.autoContinue === undefined) {
      config.autoContinue = true;
    }
    // Ensure loop config exists
    if (config.loop === undefined) {
      config.loop = true;
    }

    // Load custom presets
    loadCustomPresets();

    activePreset = detectPreset();
  }

  /** Persist the current configuration to localStorage. */
  function saveConfig() {
    localStorage.setItem(LS_CONFIG, JSON.stringify(config));
  }

  /**
   * Apply a preset by name, preserving non-schedule settings (sound, behavior).
   * @param {string} name - Preset key: 'pomodoro', 'deepwork', or 'custom:<name>'.
   */
  function applyPreset(name) {
    var presetData = null;
    if (PRESETS[name]) {
      presetData = PRESETS[name];
    } else if (name.indexOf('custom:') === 0) {
      var customName = name.slice(7);
      if (customPresets[customName]) {
        presetData = customPresets[customName];
      }
    }
    if (!presetData) return;

    // Preserve non-schedule config
    var savedSound = config.sound ? deepClone(config.sound) : deepClone(DEFAULT_SOUND);
    var savedNotifications = config.notifications;
    var savedAutoContinue = config.autoContinue;
    var savedLoop = config.loop;
    config = deepClone(presetData);
    config.sound = savedSound;
    config.notifications = savedNotifications;
    config.autoContinue = savedAutoContinue;
    config.loop = savedLoop;
    activePreset = name;
    saveConfig();
    formFromConfig();
    renderBlocks();
    updatePresetButtons();
  }

  /**
   * Detect which preset (if any) matches the current config.
   * @returns {?string} Matching preset key, or null if custom.
   */
  function detectPreset() {
    // Check built-in presets
    for (var name in PRESETS) {
      if (matchesPreset(PRESETS[name])) return name;
    }
    // Check custom presets
    for (var cname in customPresets) {
      if (matchesPreset(customPresets[cname])) return 'custom:' + cname;
    }
    return null;
  }

  /**
   * Check if a preset's schedule matches the current config.
   * Ignores majorBreak on the last block (always normalized to 0 at runtime).
   * @param {Object} p - Preset schedule data.
   * @returns {boolean} True if the preset matches.
   */
  function matchesPreset(p) {
    if (p.workMin !== config.workMin) return false;
    if (p.breakMin !== config.breakMin) return false;
    if (p.blocks.length !== config.blocks.length) return false;
    for (var i = 0; i < p.blocks.length; i++) {
      if (p.blocks[i].cycles !== config.blocks[i].cycles) return false;
      // Last block's majorBreak is always 0 at runtime, so ignore it for matching
      var isLast = i === p.blocks.length - 1;
      if (!isLast && p.blocks[i].majorBreak !== config.blocks[i].majorBreak) return false;
    }
    return true;
  }

  /** Read form inputs into config, detect preset, and save. */
  function configFromForm() {
    config.workMin = clamp(parseInt(elCfgWork.value, 10) || 25, 1, 120);
    config.breakMin = clamp(parseInt(elCfgBreak.value, 10) || 5, 1, 60);

    var rows = elBlocksList.querySelectorAll('.block-row');
    config.blocks = [];
    for (var i = 0; i < rows.length; i++) {
      var cyclesInput = rows[i].querySelector('.block-cycles');
      var majorInput = rows[i].querySelector('.block-major');
      var cycles = clamp(parseInt(cyclesInput.value, 10) || 1, 1, 20);
      var isLast = i === rows.length - 1;
      var major = isLast ? 0 : clamp(parseInt(majorInput.value, 10) || 0, 0, 180);
      config.blocks.push({ cycles: cycles, majorBreak: major });
    }

    if (config.blocks.length === 0) {
      config.blocks.push({ cycles: 1, majorBreak: 0 });
    }

    activePreset = detectPreset();
    updatePresetButtons();
    saveConfig();
  }

  /** Populate cycle form inputs from current config values. */
  function formFromConfig() {
    elCfgWork.value = config.workMin;
    elCfgBreak.value = config.breakMin;
  }

  /** Update active/inactive styling on all preset buttons (built-in and custom). */
  function updatePresetButtons() {
    // Built-in preset buttons
    for (var i = 0; i < elPresetBtns.length; i++) {
      var name = elPresetBtns[i].getAttribute('data-preset');
      elPresetBtns[i].classList.toggle('active', name === activePreset);
    }
    // Custom preset buttons
    var customBtns = elCustomPresetsRow.querySelectorAll('.preset-btn');
    for (var j = 0; j < customBtns.length; j++) {
      var cname = customBtns[j].getAttribute('data-preset');
      customBtns[j].classList.toggle('active', cname === activePreset);
    }
  }


  /* ================================================================
     CUSTOM PRESETS
     ================================================================ */

  /** Load custom presets from localStorage into the customPresets object. */
  function loadCustomPresets() {
    var raw = localStorage.getItem(LS_PRESETS);
    if (raw) {
      try {
        customPresets = JSON.parse(raw);
        if (typeof customPresets !== 'object' || customPresets === null || Array.isArray(customPresets)) {
          customPresets = {};
        }
      } catch (e) {
        customPresets = {};
      }
    } else {
      customPresets = {};
    }
  }

  /** Persist custom presets to localStorage. */
  function saveCustomPresets() {
    localStorage.setItem(LS_PRESETS, JSON.stringify(customPresets));
  }

  /** Render custom preset buttons into the custom presets row. */
  function renderCustomPresets() {
    elCustomPresetsRow.innerHTML = '';
    var names = Object.keys(customPresets);
    if (names.length === 0) return;

    for (var i = 0; i < names.length; i++) {
      (function (cname) {
        var wrap = document.createElement('div');
        wrap.className = 'custom-preset-wrap';

        var btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.setAttribute('data-preset', 'custom:' + cname);
        btn.textContent = cname;
        btn.addEventListener('click', function () {
          applyPreset('custom:' + cname);
        });

        var del = document.createElement('button');
        del.className = 'custom-preset-delete';
        del.setAttribute('aria-label', 'Delete preset ' + cname);
        del.textContent = '\u00d7';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          deleteCustomPreset(cname);
        });

        wrap.appendChild(btn);
        wrap.appendChild(del);
        elCustomPresetsRow.appendChild(wrap);
      })(names[i]);
    }

    updatePresetButtons();
  }

  /**
   * Save the current schedule config as a named custom preset.
   * @param {string} name - Preset name (trimmed, max 20 chars).
   */
  function saveAsCustomPreset(name) {
    if (!name || !name.trim()) return;
    name = name.trim();
    // Snapshot only the schedule parts
    customPresets[name] = {
      workMin: config.workMin,
      breakMin: config.breakMin,
      blocks: deepClone(config.blocks)
    };
    saveCustomPresets();
    activePreset = 'custom:' + name;
    renderCustomPresets();
    updatePresetButtons();
  }

  /**
   * Delete a custom preset by name and update UI.
   * @param {string} name - Name of the preset to delete.
   */
  function deleteCustomPreset(name) {
    delete customPresets[name];
    saveCustomPresets();
    if (activePreset === 'custom:' + name) {
      activePreset = detectPreset();
    }
    renderCustomPresets();
    updatePresetButtons();
  }

  // Save preset UI handlers
  elSavePresetBtn.addEventListener('click', function () {
    elSavePresetBtn.style.display = 'none';
    elSavePresetInput.style.display = '';
    elPresetNameInput.value = '';
    elPresetNameInput.focus();
  });

  /** Hide the save-preset inline input and show the save button. */
  function closeSavePresetInput() {
    elSavePresetInput.style.display = 'none';
    elSavePresetBtn.style.display = '';
    elPresetNameInput.value = '';
  }

  elPresetNameConfirm.addEventListener('click', function () {
    var name = elPresetNameInput.value;
    if (name && name.trim()) {
      saveAsCustomPreset(name);
    }
    closeSavePresetInput();
  });

  elPresetNameCancel.addEventListener('click', closeSavePresetInput);

  elPresetNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var name = elPresetNameInput.value;
      if (name && name.trim()) {
        saveAsCustomPreset(name);
      }
      closeSavePresetInput();
    } else if (e.key === 'Escape') {
      closeSavePresetInput();
    }
  });


  /* ================================================================
     IMPORT / EXPORT
     ================================================================ */

  /** Export current config and custom presets as a JSON file download. */
  function exportConfig() {
    var data = {
      config: deepClone(config),
      customPresets: deepClone(customPresets)
    };
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'focus-thing.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import config and custom presets from a JSON file.
   * Validates structure before applying. Shows a toast on success or failure.
   * @param {File} file - The JSON file to import.
   */
  function importConfig(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);

        // Validate config
        if (data.config) {
          if (!data.config.workMin || !data.config.breakMin ||
              !Array.isArray(data.config.blocks) || data.config.blocks.length === 0) {
            showToast('Invalid config file');
            return;
          }
          config = data.config;
          // Ensure required fields
          if (!config.sound) config.sound = deepClone(DEFAULT_SOUND);
          if (config.notifications === undefined) config.notifications = false;
          if (config.autoContinue === undefined) config.autoContinue = true;
          if (config.loop === undefined) config.loop = true;
          saveConfig();
        }

        // Validate and merge custom presets
        if (data.customPresets && typeof data.customPresets === 'object' &&
            !Array.isArray(data.customPresets)) {
          for (var name in data.customPresets) {
            var p = data.customPresets[name];
            if (p.workMin && p.breakMin && Array.isArray(p.blocks) && p.blocks.length > 0) {
              customPresets[name] = p;
            }
          }
          saveCustomPresets();
        }

        // Re-render everything
        activePreset = detectPreset();
        formFromConfig();
        renderBlocks();
        renderCustomPresets();
        syncSoundUI();
        updatePresetButtons();
        if (state === 'idle') updateDisplay();
        showToast('Config imported');
      } catch (err) {
        showToast('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  elExportBtn.addEventListener('click', exportConfig);

  elImportBtn.addEventListener('click', function () {
    elImportFileInput.click();
  });

  elImportFileInput.addEventListener('change', function () {
    if (this.files && this.files[0]) {
      importConfig(this.files[0]);
      this.value = ''; // reset so same file can be re-imported
    }
  });


  /* ================================================================
     TIMELINE GENERATION
     ================================================================ */

  /**
   * Build the flat timeline of work/break segments from the current config.
   * In loop mode, generates an initial 20-pair buffer.
   * In finite mode, walks all blocks and cycles, merging adjacent breaks.
   * @returns {Array<{type: string, duration: number}>} The timeline array.
   */
  function buildTimeline() {
    var tl = [];
    var workSec = config.workMin * 60;
    var breakSec = config.breakMin * 60;

    if (config.loop) {
      // Loop mode: generate an initial buffer of work/break pairs
      for (var i = 0; i < 20; i++) {
        tl.push({ type: 'work', duration: workSec });
        tl.push({ type: 'break', duration: breakSec });
      }
      return tl;
    }

    for (var b = 0; b < config.blocks.length; b++) {
      var block = config.blocks[b];
      var isLastBlock = b === config.blocks.length - 1;

      for (var c = 0; c < block.cycles; c++) {
        var isLastCycleInBlock = c === block.cycles - 1;

        // Work segment
        tl.push({ type: 'work', duration: workSec });

        // Break logic: major break replaces short break at block boundaries
        if (isLastCycleInBlock && !isLastBlock && block.majorBreak > 0) {
          tl.push({ type: 'majorBreak', duration: block.majorBreak * 60 });
        } else {
          tl.push({ type: 'break', duration: breakSec });
        }
      }
    }

    return tl;
  }

  /**
   * Extend the loop-mode timeline buffer by appending 20 work/break pairs.
   * Called when currentIndex approaches the end of the existing buffer.
   */
  function extendLoopBuffer() {
    var workSec = config.workMin * 60;
    var breakSec = config.breakMin * 60;
    for (var i = 0; i < 20; i++) {
      timeline.push({ type: 'work', duration: workSec });
      timeline.push({ type: 'break', duration: breakSec });
    }
  }

  /**
   * Returns indices of work segments in the timeline, grouped by block.
   * Used for progress dots rendering.
   * @returns {Array<number[]>} Array of arrays of timeline indices.
   */
  function getWorkIndicesByBlock() {
    var groups = [];
    var blockIdx = 0;
    var cycleCount = 0;

    if (!config.blocks.length) return groups;

    groups.push([]);

    for (var i = 0; i < timeline.length; i++) {
      if (timeline[i].type === 'work') {
        groups[groups.length - 1].push(i);
        cycleCount++;
        if (cycleCount >= config.blocks[blockIdx].cycles) {
          blockIdx++;
          cycleCount = 0;
          if (blockIdx < config.blocks.length) {
            groups.push([]);
          }
        }
      }
    }

    return groups;
  }


  /* ================================================================
     TIMER ENGINE  (wall-clock based — immune to background throttling)
     ================================================================ */

  /** Start the tick interval and schedule a precise transition timer. */
  function startTicking() {
    clearInterval(tickIntervalId);
    tickIntervalId = setInterval(tick, 250);
    scheduleTransitionTimer();
  }

  /** Stop the tick interval and clear the transition timer. */
  function stopTicking() {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
    clearTransitionTimer();
  }

  /**
   * Schedule a setTimeout for the exact moment the current segment ends.
   * Unlike setInterval (throttled to ~1/min in background tabs), a one-shot
   * setTimeout for a specific future time fires more reliably. Even if the
   * browser delays it slightly, the tone plays within a few hundred ms of
   * the actual transition — far better than waiting for the next interval.
   */
  function scheduleTransitionTimer() {
    clearTransitionTimer();
    if (state !== 'running' || !targetTime) return;
    var delay = targetTime - Date.now();
    if (delay < 0) delay = 0;
    transitionTimerId = setTimeout(function () {
      transitionTimerId = null;
      if (state === 'running') tick();
    }, delay);
  }

  /** Clear the one-shot transition timer if active. */
  function clearTransitionTimer() {
    if (transitionTimerId) {
      clearTimeout(transitionTimerId);
      transitionTimerId = null;
    }
  }

  /** Start the timer: build timeline, set state to running, begin ticking. */
  function start() {
    ensureLiveContext(); // ensure audio is ready before timer starts
    configFromForm();
    timeline = buildTimeline();
    if (timeline.length === 0) return;

    currentIndex = 0;
    remainingSeconds = timeline[0].duration;
    loopCycleCount = 0;
    state = 'running';
    targetTime = Date.now() + remainingSeconds * 1000;

    startTicking();
    updateDisplay();
  }

  /**
   * Core timer tick — computes remaining time from wall clock, handles
   * segment transitions, and updates the display. Called every 250ms
   * and on visibility change.
   */
  function tick() {
    var now = Date.now();
    var secsLeft = Math.ceil((targetTime - now) / 1000);
    if (secsLeft < 0) secsLeft = 0;
    remainingSeconds = secsLeft;

    if (remainingSeconds <= 0) {
      // Track loop cycle completions
      if (config.loop && timeline[currentIndex] && timeline[currentIndex].type === 'work') {
        loopCycleCount++;
      }

      // Advance to next segment
      currentIndex++;

      // In loop mode, extend the timeline buffer if needed
      if (config.loop && currentIndex >= timeline.length) {
        extendLoopBuffer();
      }

      if (!config.loop && currentIndex >= timeline.length) {
        complete();
        return;
      }
      remainingSeconds = timeline[currentIndex].duration;
      targetTime = Date.now() + remainingSeconds * 1000;

      // Phase transition — play tone, flash, notify
      var newSeg = timeline[currentIndex];
      playTransitionTone(newSeg.type);
      flash();
      fireNotification(APP_NAME, phaseLabel(newSeg.type) + ' \u2014 ' + Math.floor(newSeg.duration / 60) + ' min');

      // If auto-continue is off, enter waiting state
      if (!config.autoContinue) {
        stopTicking();
        state = 'waiting';
        lastDisplayedSeconds = -1;
        updateDisplay();
        return;
      }

      // Schedule next transition timer for the new segment
      scheduleTransitionTimer();

      lastDisplayedSeconds = -1;
      updateDisplay();
      return;
    }

    // Only update DOM when the displayed second changes
    if (remainingSeconds !== lastDisplayedSeconds) {
      lastDisplayedSeconds = remainingSeconds;
      updateDisplay();
    }
  }

  /** Pause the timer, preserving remaining seconds. */
  function pause() {
    state = 'paused';
    stopTicking();
    // remainingSeconds is already accurate from last tick
    updateDisplay();
  }

  /** Resume the timer from a paused state. */
  function resume() {
    state = 'running';
    targetTime = Date.now() + remainingSeconds * 1000;
    startTicking();
    updateDisplay();
  }

  /** Toggle between running and paused states. */
  function togglePause() {
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  }

  /** Continue from the waiting state (when auto-continue is off). */
  function continueFromWaiting() {
    if (state !== 'waiting') return;
    state = 'running';
    targetTime = Date.now() + remainingSeconds * 1000;
    startTicking();
    updateDisplay();
  }

  /** Skip the current segment, saving a snapshot for undo. */
  function skip() {
    if (state !== 'running' && state !== 'paused' && state !== 'waiting') return;

    // Snapshot for undo
    skipSnapshot = {
      currentIndex: currentIndex,
      remainingSeconds: remainingSeconds,
      state: state,
      loopCycleCount: loopCycleCount
    };

    // Track loop cycle completion when skipping past a work segment
    if (config.loop && timeline[currentIndex] && timeline[currentIndex].type === 'work') {
      loopCycleCount++;
    }

    currentIndex++;

    // In loop mode, extend buffer if needed
    if (config.loop && currentIndex >= timeline.length) {
      extendLoopBuffer();
    }

    if (!config.loop && currentIndex >= timeline.length) {
      complete();
      showToast('Skipped');
      return;
    }
    remainingSeconds = timeline[currentIndex].duration;
    // Update targetTime if running
    if (state === 'running') {
      targetTime = Date.now() + remainingSeconds * 1000;
      scheduleTransitionTimer();
    }

    // If waiting, stay in waiting (user can continue or skip again)
    // If paused, stay paused but show next segment
    showToast('Skipped');
    updateDisplay();
  }

  /** Reset the timer to idle state, clearing all timer and render guard state. */
  function reset() {
    stopTicking();
    state = 'idle';
    currentIndex = 0;
    remainingSeconds = 0;
    loopCycleCount = 0;
    timeline = [];
    targetTime = 0;
    lastDisplayedSeconds = -1;
    lastRenderedControlState = '';
    lastRenderedProgressIndex = -1;
    lastRenderedProgressState = '';
    prevPhaseText = '';
    updateDisplay();
  }

  /** Mark the session as complete — play bell, flash, notify. */
  function complete() {
    stopTicking();
    state = 'done';
    remainingSeconds = 0;
    playTone('bell');
    flash();
    fireNotification(APP_NAME, 'Session complete!');
    updateDisplay();
  }


  /* ================================================================
     DISPLAY
     ================================================================ */

  /**
   * Master display update — sets main element classes, phase text, timer digits,
   * progress dots, controls, title, and ring based on current state.
   * Wipes elMain.className every call; all state classes applied here.
   */
  function updateDisplay() {
    // Reset main classes
    elMain.className = '';

    switch (state) {
      case 'idle':
        elMain.classList.add('idle');
        setPhaseText(APP_NAME);
        elTimer.innerHTML = 'press space to start';
        elTimer.onclick = start;
        renderProgressEmpty();
        renderControlsEmpty();
        break;

      case 'running':
      case 'paused':
        var seg = timeline[currentIndex];
        var phaseClass = seg.type === 'majorBreak' ? 'major-break' : seg.type;

        if (state === 'paused') {
          elMain.classList.add('paused');
        }
        elMain.classList.add(phaseClass);

        var pLabel = phaseLabel(seg.type);
        if (state === 'paused') {
          pLabel += ' \u2014 paused';
        }
        setPhaseText(pLabel);

        var rm = Math.floor(remainingSeconds / 60);
        var rs = remainingSeconds % 60;
        elTimer.innerHTML = pad(rm) + '<span class="colon">:</span>' + pad(rs);
        elTimer.onclick = null;

        renderProgress();
        renderControls();
        break;

      case 'done':
        elMain.classList.add('done');
        setPhaseText('Done');
        elTimer.innerHTML = '00<span class="colon">:</span>00';
        elTimer.onclick = null;
        renderProgressDone();
        renderControlsDone();
        break;

      case 'waiting':
        var wseg = timeline[currentIndex];
        elMain.classList.add('waiting');
        setPhaseText('Up next \u2014 ' + phaseLabel(wseg.type));
        elTimer.innerHTML = 'press space to continue';
        elTimer.onclick = continueFromWaiting;
        renderProgress();
        renderControlsWaiting();
        break;
    }

    updateTitle();
    updateRing();
  }

  /** Update the SVG progress ring based on elapsed time in the current segment. */
  function updateRing() {
    if (state === 'running' || state === 'paused') {
      var seg = timeline[currentIndex];
      var total = seg.duration;
      var elapsed = total - remainingSeconds;
      var progress = total > 0 ? elapsed / total : 0;
      var offset = RING_CIRCUMFERENCE * (1 - progress);
      elRingFill.style.strokeDasharray = RING_CIRCUMFERENCE;
      elRingFill.style.strokeDashoffset = offset;
    } else {
      // Reset ring
      elRingFill.style.strokeDasharray = RING_CIRCUMFERENCE;
      elRingFill.style.strokeDashoffset = RING_CIRCUMFERENCE;
    }
  }

  /**
   * Set the phase label text with a fade-in transition.
   * Skips update if the text hasn't changed.
   * @param {string} text - New phase label text.
   */
  function setPhaseText(text) {
    if (text === prevPhaseText) return;
    prevPhaseText = text;
    elPhase.classList.remove('transitioning');
    void elPhase.offsetWidth;
    elPhase.textContent = text;
    elPhase.classList.add('transitioning');
  }

  /** Update document.title with countdown and phase info. */
  function updateTitle() {
    var base = APP_NAME;
    switch (state) {
      case 'running':
      case 'paused':
        var seg = timeline[currentIndex];
        var label = phaseLabel(seg.type);
        if (state === 'paused') label += ' (Paused)';
        var rm = Math.floor(remainingSeconds / 60);
        var rs = remainingSeconds % 60;
        document.title = pad(rm) + ':' + pad(rs) + ' \u2014 ' + label + ' | ' + base;
        break;
      case 'done':
        document.title = 'Done | ' + base;
        break;
      case 'waiting':
        var wseg = timeline[currentIndex];
        document.title = 'Up next: ' + phaseLabel(wseg.type) + ' | ' + base;
        break;
      default:
        document.title = base;
    }
  }

  /** Update the wall clock display (HH:MM:SS). */
  function updateClock() {
    var now = new Date();
    elClock.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }


  /* ================================================================
     PROGRESS DOTS
     ================================================================ */

  /** Clear progress dots and reset render guards. */
  function renderProgressEmpty() {
    elProgress.innerHTML = '';
    lastRenderedProgressIndex = -1;
    lastRenderedProgressState = '';
  }

  /**
   * Render progress dots (finite mode) or cycle counter (loop mode).
   * Skips rebuilding if segment index and state haven't changed.
   */
  function renderProgress() {
    // Loop mode: show cycle counter instead of dots
    if (config.loop) {
      var loopHtml = '<span class="loop-counter">' + loopCycleCount + ' cycle' + (loopCycleCount !== 1 ? 's' : '') + '</span>';
      if (elProgress.innerHTML !== loopHtml) {
        elProgress.innerHTML = loopHtml;
      }
      return;
    }

    // Only rebuild if segment or state changed
    if (currentIndex === lastRenderedProgressIndex && state === lastRenderedProgressState) return;
    lastRenderedProgressIndex = currentIndex;
    lastRenderedProgressState = state;

    var groups = getWorkIndicesByBlock();
    var out = '';

    for (var g = 0; g < groups.length; g++) {
      if (g > 0) {
        out += '<div class="progress-gap"></div>';
      }
      for (var d = 0; d < groups[g].length; d++) {
        var idx = groups[g][d];
        var cls = 'progress-dot';
        if (idx < currentIndex) {
          cls += ' done';
        } else if (idx === currentIndex) {
          cls += ' current';
          if (state === 'paused') cls += ' paused';
        } else {
          // Check if we're on this work segment's break (idx+1)
          var nextIdx = idx + 1;
          if (currentIndex === nextIdx && nextIdx < timeline.length &&
              (timeline[nextIdx].type === 'break' || timeline[nextIdx].type === 'majorBreak')) {
            cls = 'progress-dot current';
            if (state === 'paused') cls += ' paused';
          }
        }
        out += '<div class="' + cls + '"></div>';
      }
    }

    elProgress.innerHTML = out;
  }

  /** Render all progress dots as completed (done state). */
  function renderProgressDone() {
    var groups = getWorkIndicesByBlock();
    var out = '';

    for (var g = 0; g < groups.length; g++) {
      if (g > 0) out += '<div class="progress-gap"></div>';
      for (var d = 0; d < groups[g].length; d++) {
        out += '<div class="progress-dot done"></div>';
      }
    }

    elProgress.innerHTML = out;
    lastRenderedProgressIndex = -1;
    lastRenderedProgressState = '';
  }


  /* ================================================================
     CONTROLS
     ================================================================ */

  /** Clear controls (idle state). */
  function renderControlsEmpty() {
    if (lastRenderedControlState === 'empty') return;
    lastRenderedControlState = 'empty';
    elControls.innerHTML = '';
  }

  /** Render running/paused controls: pause/resume, skip, reset. */
  function renderControls() {
    var key = state === 'paused' ? 'paused' : 'running';
    if (lastRenderedControlState === key) return;
    lastRenderedControlState = key;

    var pauseLabel = state === 'paused' ? 'resume' : 'pause';
    elControls.innerHTML =
      '<button class="ctrl-btn" data-action="pause">' + pauseLabel + '</button>' +
      '<span class="ctrl-sep">\u00b7</span>' +
      '<button class="ctrl-btn" data-action="skip">skip</button>' +
      '<span class="ctrl-sep">\u00b7</span>' +
      '<button class="ctrl-btn" data-action="reset">reset</button>';
  }

  /** Render done state controls: restart button. */
  function renderControlsDone() {
    if (lastRenderedControlState === 'done') return;
    lastRenderedControlState = 'done';
    elControls.innerHTML =
      '<button class="ctrl-btn" data-action="reset">restart</button>';
  }

  /** Render waiting state controls: continue, skip, reset. */
  function renderControlsWaiting() {
    if (lastRenderedControlState === 'waiting') return;
    lastRenderedControlState = 'waiting';
    elControls.innerHTML =
      '<button class="ctrl-btn" data-action="continue">continue</button>' +
      '<span class="ctrl-sep">\u00b7</span>' +
      '<button class="ctrl-btn" data-action="skip">skip</button>' +
      '<span class="ctrl-sep">\u00b7</span>' +
      '<button class="ctrl-btn" data-action="reset">reset</button>';
  }

  // Delegated click handler for controls
  elControls.addEventListener('click', function (e) {
    var btn = e.target.closest('.ctrl-btn');
    if (!btn) return;

    // Ensure AudioContext is initialized on user gesture
    ensureLiveContext();

    var action = btn.getAttribute('data-action');
    switch (action) {
      case 'pause': togglePause(); break;
      case 'skip': skip(); break;
      case 'reset': reset(); break;
      case 'continue': continueFromWaiting(); break;
    }
  });


  /* ================================================================
     BLOCKS UI
     ================================================================ */

  /** Render block rows in the settings drawer from current config. */
  function renderBlocks() {
    elBlocksList.innerHTML = '';

    for (var i = 0; i < config.blocks.length; i++) {
      var block = config.blocks[i];
      var isLast = i === config.blocks.length - 1;
      var canRemove = config.blocks.length > 1;

      var row = document.createElement('div');
      row.className = 'block-row';
      row.setAttribute('data-index', i);

      var cyclesInput = document.createElement('input');
      cyclesInput.type = 'number';
      cyclesInput.className = 'block-cycles';
      cyclesInput.min = '1';
      cyclesInput.max = '20';
      cyclesInput.value = block.cycles;

      var cyclesLabel = document.createElement('span');
      cyclesLabel.className = 'block-label';
      cyclesLabel.textContent = 'cycles';

      var arrow = document.createElement('span');
      arrow.className = 'block-arrow';
      arrow.textContent = '\u2192';

      row.appendChild(cyclesInput);
      row.appendChild(cyclesLabel);

      if (!isLast) {
        var majorInput = document.createElement('input');
        majorInput.type = 'number';
        majorInput.className = 'block-major';
        majorInput.min = '0';
        majorInput.max = '180';
        majorInput.value = block.majorBreak;

        var majorLabel = document.createElement('span');
        majorLabel.className = 'block-label';
        majorLabel.textContent = 'min break';

        row.appendChild(arrow);
        row.appendChild(majorInput);
        row.appendChild(majorLabel);
      } else {
        var endLabel = document.createElement('span');
        endLabel.className = 'block-end-label';
        endLabel.textContent = '\u2192 end';
        row.appendChild(endLabel);
      }

      if (canRemove) {
        var removeBtn = document.createElement('button');
        removeBtn.className = 'block-remove';
        removeBtn.setAttribute('aria-label', 'Remove block');
        removeBtn.textContent = '\u00d7';
        removeBtn.setAttribute('data-index', i);
        row.appendChild(removeBtn);
      }

      elBlocksList.appendChild(row);
    }
  }

  // Delegated events for blocks list
  elBlocksList.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.block-remove');
    if (!removeBtn) return;

    var idx = parseInt(removeBtn.getAttribute('data-index'), 10);
    if (config.blocks.length <= 1) return;

    config.blocks.splice(idx, 1);
    // If we removed a non-last block that is now the last, set its majorBreak to 0
    if (config.blocks.length > 0) {
      config.blocks[config.blocks.length - 1].majorBreak = 0;
    }
    saveConfig();
    renderBlocks();
    activePreset = detectPreset();
    updatePresetButtons();
  });

  elBlocksList.addEventListener('input', function (e) {
    if (e.target.matches('input[type="number"]')) {
      configFromForm();
    }
  });

  elAddBlock.addEventListener('click', function () {
    // Current last block gets a default major break
    if (config.blocks.length > 0) {
      config.blocks[config.blocks.length - 1].majorBreak = 30;
    }
    config.blocks.push({ cycles: 1, majorBreak: 0 });
    saveConfig();
    renderBlocks();
    activePreset = detectPreset();
    updatePresetButtons();
  });


  /* ================================================================
     DRAWER
     ================================================================ */

  /** Open the settings drawer, auto-pausing the timer if running. */
  function openDrawer() {
    drawerOpen = true;
    elDrawer.classList.add('open');
    elDrawer.setAttribute('aria-hidden', 'false');
    elBackdrop.classList.add('open');
    elSettingsToggle.classList.add('active');
    document.body.classList.add('drawer-open');

    if (state === 'running') {
      wasRunningBeforeDrawer = true;
      pause();
    } else {
      wasRunningBeforeDrawer = false;
    }
  }

  /** Close the settings drawer, resuming the timer if it was auto-paused. */
  function closeDrawer() {
    drawerOpen = false;
    elDrawer.classList.remove('open');
    elDrawer.setAttribute('aria-hidden', 'true');
    elBackdrop.classList.remove('open');
    elSettingsToggle.classList.remove('active');
    document.body.classList.remove('drawer-open');

    if (wasRunningBeforeDrawer && state === 'paused') {
      resume();
      wasRunningBeforeDrawer = false;
    }
  }

  /** Toggle the settings drawer open/closed. */
  function toggleDrawer() {
    if (drawerOpen) closeDrawer();
    else openDrawer();
  }

  elSettingsToggle.addEventListener('click', toggleDrawer);
  elBackdrop.addEventListener('click', closeDrawer);
  elDrawerClose.addEventListener('click', closeDrawer);


  /* ================================================================
     FOCUS MODE
     ================================================================ */

  /** Enter fullscreen focus mode, hiding all chrome. */
  function enterFocusMode() {
    if (focusMode) return;
    focusMode = true;
    document.body.classList.add('focus-mode');

    // Try browser fullscreen
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();

    // Show exit hint briefly
    elFocusHint.classList.add('visible');
    clearTimeout(focusHintTimerId);
    focusHintTimerId = setTimeout(function () {
      elFocusHint.classList.remove('visible');
    }, 2000);
  }

  /** Exit fullscreen focus mode, restoring UI chrome. */
  function exitFocusMode() {
    if (!focusMode) return;
    focusMode = false;
    document.body.classList.remove('focus-mode');
    elFocusHint.classList.remove('visible');

    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  /** Toggle focus mode on/off. */
  function toggleFocusMode() {
    if (focusMode) exitFocusMode();
    else enterFocusMode();
  }

  elFocusToggle.addEventListener('click', toggleFocusMode);
  elHelpToggle.addEventListener('click', toggleHints);

  // Detect when user exits fullscreen externally (Esc in browser)
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && focusMode) {
      focusMode = false;
      document.body.classList.remove('focus-mode');
      elFocusHint.classList.remove('visible');
    }
  });

  document.addEventListener('webkitfullscreenchange', function () {
    if (!document.webkitFullscreenElement && focusMode) {
      focusMode = false;
      document.body.classList.remove('focus-mode');
      elFocusHint.classList.remove('visible');
    }
  });


  /* ================================================================
     ACCENT PICKER
     ================================================================ */

  /** Build the accent color picker dots in the settings drawer. */
  function buildAccentPicker() {
    var currentAccent = elRoot.getAttribute('data-accent');
    elAccentPicker.innerHTML = '';

    ACCENTS.forEach(function (name) {
      var dot = document.createElement('button');
      dot.className = 'accent-dot' + (name === currentAccent ? ' active' : '');
      dot.setAttribute('role', 'radio');
      dot.setAttribute('aria-checked', name === currentAccent ? 'true' : 'false');
      dot.setAttribute('aria-label', name);
      dot.setAttribute('data-color', name);
      dot.style.backgroundColor = 'var(--' + name + ')';
      dot.addEventListener('click', function () {
        setAccent(name);
      });
      elAccentPicker.appendChild(dot);
    });
  }

  /**
   * Set the active accent color, updating the DOM and localStorage.
   * @param {string} name - Accent color name from ACCENTS.
   */
  function setAccent(name) {
    elRoot.setAttribute('data-accent', name);
    localStorage.setItem(LS_ACCENT, name);

    var dots = elAccentPicker.querySelectorAll('.accent-dot');
    for (var i = 0; i < dots.length; i++) {
      var isActive = dots[i].getAttribute('data-color') === name;
      dots[i].classList.toggle('active', isActive);
      dots[i].setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }


  /* ================================================================
     THEME TOGGLE
     ================================================================ */

  /** Toggle between mocha (dark) and latte (light) themes. */
  function toggleTheme() {
    var current = elRoot.getAttribute('data-theme');
    var next = current === 'mocha' ? 'latte' : 'mocha';
    elRoot.setAttribute('data-theme', next);
    localStorage.setItem(LS_THEME, next);
    updateThemeLabel();

    /* Sync the meta theme-color tag so the browser chrome matches */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'latte' ? '#eff1f5' : '#1e1e2e';
  }

  /** Update the theme switch button label to reflect current theme. */
  function updateThemeLabel() {
    var t = elRoot.getAttribute('data-theme');
    elThemeSwitch.textContent = t === 'mocha' ? 'switch to light' : 'switch to dark';
  }

  elThemeSwitch.addEventListener('click', toggleTheme);


  /* ================================================================
     SOUND UI
     ================================================================ */

  /**
   * Build a tone selector grid in a container element.
   * @param {HTMLElement} container - The element to populate with tone buttons.
   * @param {string} selectedTone - Currently selected tone name.
   * @param {function(string): void} onSelect - Callback when a tone is selected.
   */
  function buildToneSelector(container, selectedTone, onSelect) {
    container.innerHTML = '';
    for (var i = 0; i < TONE_NAMES.length; i++) {
      (function (name) {
        var btn = document.createElement('button');
        btn.className = 'tone-btn' + (name === selectedTone ? ' active' : '');
        btn.textContent = name;
        btn.setAttribute('data-tone', name);
        btn.addEventListener('click', function () {
          // Ensure AudioContext on user gesture
          ensureLiveContext();
          // Preview the tone (bypasses sound-enabled check)
          playTone(name, true);
          // Update selection
          onSelect(name);
          var btns = container.querySelectorAll('.tone-btn');
          for (var j = 0; j < btns.length; j++) {
            btns[j].classList.toggle('active', btns[j].getAttribute('data-tone') === name);
          }
        });
        container.appendChild(btn);
      })(TONE_NAMES[i]);
    }
  }

  /** Synchronize all sound/behavior UI controls with the current config. */
  function syncSoundUI() {
    var snd = config.sound || deepClone(DEFAULT_SOUND);
    elSoundToggle.checked = snd.enabled;
    elVolume.value = snd.volume;
    elVolumeNum.value = Math.round(snd.volume * 100);
    elNotificationsToggle.checked = !!config.notifications;
    elAutoContinueToggle.checked = config.autoContinue !== false;
    elLoopToggle.checked = !!config.loop;
    updateBlocksVisibility();
    buildToneSelector(elWorkToneSelector, snd.workTone, function (name) {
      config.sound.workTone = name;
      saveConfig();
    });
    buildToneSelector(elBreakToneSelector, snd.breakTone, function (name) {
      config.sound.breakTone = name;
      saveConfig();
    });
  }

  elSoundToggle.addEventListener('change', function () {
    config.sound.enabled = this.checked;
    saveConfig();
  });

  elVolume.addEventListener('input', function () {
    config.sound.volume = parseFloat(this.value);
    elVolumeNum.value = Math.round(config.sound.volume * 100);
    saveConfig();
  });

  // Preview tone on slider release
  elVolume.addEventListener('change', function () {
    ensureLiveContext();
    playTone(config.sound.workTone, true);
  });

  elVolumeNum.addEventListener('input', function () {
    var pct = clamp(parseInt(this.value, 10) || 0, 0, 100);
    config.sound.volume = pct / 100;
    elVolume.value = config.sound.volume;
    saveConfig();
  });

  elVolumeNum.addEventListener('change', function () {
    var pct = clamp(parseInt(this.value, 10) || 0, 0, 100);
    this.value = pct;
    config.sound.volume = pct / 100;
    elVolume.value = config.sound.volume;
    saveConfig();
    ensureLiveContext();
    playTone(config.sound.workTone, true);
  });

  elNotificationsToggle.addEventListener('change', function () {
    if (this.checked && 'Notification' in window && Notification.permission === 'default') {
      var toggle = this;
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') {
          toggle.checked = false;
          config.notifications = false;
        } else {
          config.notifications = true;
        }
        saveConfig();
      });
    } else {
      config.notifications = this.checked;
      saveConfig();
    }
  });

  elAutoContinueToggle.addEventListener('change', function () {
    config.autoContinue = this.checked;
    saveConfig();
  });

  elLoopToggle.addEventListener('change', function () {
    config.loop = this.checked;
    saveConfig();
    updateBlocksVisibility();
  });

  /** Show/hide the blocks section based on loop mode. */
  function updateBlocksVisibility() {
    if (config.loop) {
      elBlocksSection.style.display = 'none';
    } else {
      elBlocksSection.style.display = '';
    }
  }


  /* ================================================================
     CONFIG FORM CHANGE HANDLERS
     ================================================================ */

  elCfgWork.addEventListener('input', configFromForm);
  elCfgBreak.addEventListener('input', configFromForm);

  // Preset buttons
  for (var i = 0; i < elPresetBtns.length; i++) {
    elPresetBtns[i].addEventListener('click', function () {
      var name = this.getAttribute('data-preset');
      applyPreset(name);
    });
  }


  /* ================================================================
     KEYBOARD SHORTCUT HINTS
     ================================================================ */

  /** Build context-dependent keyboard shortcut hints HTML. */
  function buildHints() {
    var items = [];

    // Context-dependent shortcuts
    if (state === 'idle') {
      items.push(['Space', 'start']);
    } else if (state === 'running') {
      items.push(['Space', 'pause']);
      items.push(['S', 'skip']);
      items.push(['R', 'reset']);
    } else if (state === 'paused') {
      items.push(['Space', 'resume']);
      items.push(['S', 'skip']);
      items.push(['R', 'reset']);
    } else if (state === 'waiting') {
      items.push(['Space', 'continue']);
      items.push(['S', 'skip']);
      items.push(['R', 'reset']);
    } else if (state === 'done') {
      items.push(['Space', 'restart']);
    }

    // Always available
    items.push(['T', 'theme']);
    items.push([',', 'settings']);
    items.push(['F', 'focus']);
    items.push(['?', 'shortcuts']);

    var out = '';
    for (var i = 0; i < items.length; i++) {
      out += '<span class="hint-item">' +
              '<span class="hint-key">' + items[i][0] + '</span>' +
              '<span class="hint-label">' + items[i][1] + '</span>' +
              '</span>';
    }
    elHints.innerHTML = out;
  }

  /** Show the keyboard hints panel with a 5-second auto-dismiss. */
  function showHints() {
    buildHints();
    hintsVisible = true;
    elHints.classList.add('visible');
    elHints.setAttribute('aria-hidden', 'false');
    clearTimeout(hintsTimerId);
    hintsTimerId = setTimeout(hideHints, 5000);
  }

  /** Hide the keyboard hints panel. */
  function hideHints() {
    hintsVisible = false;
    elHints.classList.remove('visible');
    elHints.setAttribute('aria-hidden', 'true');
    clearTimeout(hintsTimerId);
    hintsTimerId = null;
  }

  /** Toggle the keyboard hints panel visibility. */
  function toggleHints() {
    if (hintsVisible) hideHints();
    else showHints();
  }


  /* ================================================================
     KEYBOARD SHORTCUTS
     ================================================================ */

  document.addEventListener('keydown', function (e) {
    // Don't intercept when typing in inputs
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') {
        e.target.blur();
        return;
      }
      return;
    }

    // Ensure AudioContext is initialized on user gesture
    ensureLiveContext();

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (state === 'idle') start();
        else if (state === 'running' || state === 'paused') togglePause();
        else if (state === 'waiting') continueFromWaiting();
        else if (state === 'done') reset();
        break;

      case 's':
      case 'S':
        if (state === 'running' || state === 'paused' || state === 'waiting') skip();
        break;

      case 'r':
      case 'R':
        if (state !== 'idle') reset();
        break;

      case 't':
      case 'T':
        toggleTheme();
        break;

      case 'f':
      case 'F':
        toggleFocusMode();
        break;

      case ',':
        toggleDrawer();
        break;

      case '?':
        toggleHints();
        break;

      case 'Escape':
        if (focusMode) exitFocusMode();
        else if (drawerOpen) closeDrawer();
        else if (hintsVisible) hideHints();
        break;
    }
  });


  /* ================================================================
     INIT
     ================================================================ */

  loadConfig();
  formFromConfig();
  renderBlocks();
  renderCustomPresets();
  buildAccentPicker();
  updateThemeLabel();
  syncSoundUI();
  initToneBlobs();

  // Set idle state
  state = 'idle';
  updateDisplay();

  // Ensure preset buttons reflect activePreset after all init is done
  activePreset = detectPreset();
  updatePresetButtons();

  // Clock always ticks
  updateClock();
  clockIntervalId = setInterval(updateClock, 1000);

})();
