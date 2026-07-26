import { Game } from './game/game.js';
import { QUALITY_PRESETS } from './engine/renderer.js';
import { LEVELS } from './game/levels.js';

const $ = (id) => document.getElementById(id);

const screens = {
  loading: $('loading'),
  menu: $('menu'),
  settings: $('settings'),
  chapters: $('chapters'),
  pause: $('pause'),
  ending: $('ending'),
};

function show(name) {
  Object.entries(screens).forEach(([key, node]) => {
    if (!node) return;
    node.classList.toggle('hidden', key !== name);
  });
  $('overlay').classList.toggle('hidden', name === null);
}

async function boot() {
  show('loading');
  // let the loading screen paint before the (synchronous) texture bake
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const canvas = $('view');
  let game;
  try {
    game = new Game(canvas);
  } catch (err) {
    console.error(err);
    $('loadingText').innerHTML = 'تعذّر تشغيل WebGL2 على هذا الجهاز.<br><small>جرّب متصفحاً آخر أو فعّل تسريع الرسوميات.</small>';
    return;
  }
  window.__game = game;
  game.start();

  // --- menu ---------------------------------------------------------------
  const saved = game.loadProgress();
  $('continueBtn').classList.toggle('hidden', !saved);
  if (saved) $('continueLabel').textContent = LEVELS[saved.chapter]?.subtitle || '';

  const startGame = async (chapterIndex) => {
    show(null);
    game.audio.resume();
    await game.loadChapter(chapterIndex);
    game.input.requestLock();
  };

  $('newGameBtn').addEventListener('click', () => startGame(0));
  $('continueBtn').addEventListener('click', () => startGame(saved ? saved.chapter : 0));
  $('chaptersBtn').addEventListener('click', () => show('chapters'));
  $('settingsBtn').addEventListener('click', () => show('settings'));
  $('backFromSettings').addEventListener('click', () => show(game.state === 'playing' ? 'pause' : 'menu'));
  $('backFromChapters').addEventListener('click', () => show('menu'));

  // chapter list
  const list = $('chapterList');
  LEVELS.forEach((level, i) => {
    const button = document.createElement('button');
    button.className = 'chapter-item';
    button.innerHTML = `<span class="num">${i + 1}</span><span><b>${level.subtitle}</b><small>${level.objective}</small></span>`;
    button.addEventListener('click', () => startGame(i));
    list.appendChild(button);
  });

  // --- settings -----------------------------------------------------------
  const qualitySelect = $('qualitySelect');
  Object.entries(QUALITY_PRESETS).forEach(([key, preset]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    qualitySelect.appendChild(option);
  });

  const bind = (id, key, transform = (v) => v, after = null) => {
    const node = $(id);
    if (!node) return;
    const isCheck = node.type === 'checkbox';
    if (isCheck) node.checked = game.settings[key];
    else node.value = game.settings[key];
    const label = $(`${id}Value`);
    const paint = () => { if (label) label.textContent = Number(node.value).toFixed(node.step === '1' ? 0 : 2); };
    paint();
    node.addEventListener('input', () => {
      game.settings[key] = transform(isCheck ? node.checked : node.value);
      paint();
      game.applySettings();
      game.saveSettings();
      if (after) after();
    });
  };

  bind('qualitySelect', 'quality', (v) => v);
  bind('sensitivityRange', 'sensitivity', Number);
  bind('masterRange', 'master', Number);
  bind('musicRange', 'music', Number);
  bind('invertToggle', 'invertY', Boolean);
  bind('voiceToggle', 'voice', Boolean);
  bind('subtitleToggle', 'subtitles', Boolean);

  const voiceNote = $('voiceNote');
  const refreshVoiceNote = () => {
    voiceNote.textContent = game.voice.available
      ? (game.voice.hasArabicVoice
        ? `صوت عربي مُفعّل: ${game.voice.voice.name}`
        : 'لا يوجد صوت عربي مثبّت — سيُستخدم أقرب صوت متاح مع الترجمة.')
      : 'المتصفح لا يدعم النطق — ستظهر الحوارات كترجمة نصية مؤقّتة.';
  };
  refreshVoiceNote();
  setTimeout(refreshVoiceNote, 1200);

  // --- pause / death / ending ---------------------------------------------
  $('resumeBtn').addEventListener('click', () => { show(null); game.setPaused(false); });
  $('pauseSettingsBtn').addEventListener('click', () => show('settings'));
  $('quitBtn').addEventListener('click', () => {
    game.setPaused(true);
    game.state = 'menu';
    game.hud.setVisible(false);
    show('menu');
  });
  $('retryBtn').addEventListener('click', () => { game.retry(); });
  $('menuFromDeath').addEventListener('click', () => {
    game.hud.showDeath(false);
    game.hud.setVisible(false);
    game.state = 'menu';
    show('menu');
  });
  $('endingBtn').addEventListener('click', () => {
    game.state = 'menu';
    game.hud.setVisible(false);
    show('menu');
  });

  game.onStateChange = (state) => {
    if (state === 'paused') show('pause');
    if (state === 'playing') show(null);
    if (state === 'ending') show('ending');
  };

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (game.state === 'playing' && !game.paused) game.setPaused(true);
    else if (game.paused && !screens.settings.classList.contains('hidden')) show('pause');
  });

  show('menu');
}

boot();
