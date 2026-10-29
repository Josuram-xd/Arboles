// Zombie escape graphic novel: walks the scene graph through the API and drives the HUD, enemies and endings.
const API = '/api';
const MAX_STAT = { health: 5, supplies: 5, noise: 5 };
const START_STAT = { health: 5, supplies: 3, noise: 0 };
const STAT_KEYS = ['health', 'supplies', 'noise'];
const ENEMY_LABELS = { walker: 'Caminante', runner: 'Corredor', brute: 'Bruto', horde: 'Horda' };
const ESCAPE_TEXT = {
  helicopter: { title: 'Helicóptero', text: 'Subes a la azotea justo cuando las aspas cortan el humo. Nadie más sube contigo.' },
  neighbor: { title: 'La vecina', text: 'Ella te abre la puerta del piso doce y bajáis juntos por la escalera de incendios.' },
  sewers: { title: 'Alcantarillas', text: 'El agua negra te lleva lejos del edificio. Huele a muerte, pero respiras.' },
};
const ESCAPE_NAMES = { helicopter: 'Helicóptero', neighbor: 'La vecina', sewers: 'Alcantarillas' };

// Plays a named sound; the audio module may be missing, so failures are ignored.
function playSound(name) {
  try {
    window.GameAudio?.play(name);
  } catch {
    /* audio is optional */
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Effects are integers in -3..3; anything else counts as 0.
function normalizeEffect(value) {
  return Number.isFinite(value) ? clamp(Math.trunc(value), -3, 3) : 0;
}

// Drawn zombie figure (SVG). The outer group positions it; the inner one is animated by CSS.
function zombieFigure(x, y, scale, cls, delay = 0) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><g class="zombie ${cls}" style="--d:${delay}ms">
    <circle class="zombie__head" cx="60" cy="26" r="18"/>
    <rect class="zombie__body" x="40" y="48" width="40" height="62" rx="8"/>
    <path class="zombie__arm" d="M42 56 L14 96 L22 102 L48 74 Z"/>
    <path class="zombie__arm" d="M78 56 L106 96 L98 102 L72 74 Z"/>
    <path class="zombie__leg" d="M44 106 L40 150 L52 150 L56 106 Z"/>
    <path class="zombie__leg" d="M76 106 L80 150 L68 150 L64 106 Z"/>
    <circle class="zombie__eye" cx="53" cy="24" r="2.5"/>
    <circle class="zombie__eye" cx="67" cy="24" r="2.5"/>
  </g></g>`;
}

const ENEMY_SVG = {
  walker: '<svg viewBox="0 0 120 160" aria-hidden="true">' + zombieFigure(0, 0, 1, 'zombie--walker') + '</svg>',
  runner: '<svg viewBox="0 0 120 160" aria-hidden="true">' + zombieFigure(0, 0, 1, 'zombie--runner') + '</svg>',
  brute: '<svg viewBox="-10 -6 140 176" aria-hidden="true">' + zombieFigure(0, 0, 1.15, 'zombie--brute') + '</svg>',
  horde:
    '<svg viewBox="0 0 300 160" aria-hidden="true">' +
    zombieFigure(0, 10, 0.8, 'zombie--horde', 0) +
    zombieFigure(70, 0, 0.9, 'zombie--horde', 120) +
    zombieFigure(150, 14, 0.75, 'zombie--horde', 240) +
    zombieFigure(212, 4, 0.9, 'zombie--horde', 60) +
    '</svg>',
};

class Game {
  constructor(root) {
    this.el = {
      stage: root.querySelector('#stage'),
      flash: root.querySelector('#flash'),
      stepCount: root.querySelector('#step-count'),
      btnTree: root.querySelector('#btn-tree'),
      btnRoute: root.querySelector('#btn-route'),
      btnRestart: root.querySelector('#btn-restart'),
      btnEscapes: root.querySelector('#btn-escapes'),
      error: root.querySelector('#error'),
      scene: root.querySelector('#scene'),
      title: root.querySelector('#scene-title'),
      enemy: root.querySelector('#enemy'),
      text: root.querySelector('#scene-text'),
      options: root.querySelector('#options'),
      ending: root.querySelector('#ending'),
      endingStamp: root.querySelector('#ending-stamp'),
      endingText: root.querySelector('#ending-text'),
      escapes: root.querySelector('#escape-paths'),
      route: root.querySelector('#route'),
      routeSteps: root.querySelector('#route-steps'),
      routeList: root.querySelector('#route-list'),
      trail: root.querySelector('#trail'),
      dialog: root.querySelector('#tree-dialog'),
      btnTreeClose: root.querySelector('#btn-tree-close'),
      treeContainer: root.querySelector('#tree-container'),
      treeMessage: root.querySelector('#tree-message'),
      meters: Object.fromEntries(
        STAT_KEYS.map((key) => [key, {
          value: root.querySelector(`#value-${key}`),
          fill: root.querySelector(`#fill-${key}`),
          floats: root.querySelector(`#floats-${key}`),
          track: root.querySelector(`#meter-${key} [role="meter"]`),
        }]),
      ),
    };
    this.stats = { ...START_STAT };
    this.steps = 0;
    this.history = [];
    this.busy = false;
    this.currentScene = null;
    this.treeData = null;
    this.treeController = null;
    this.optimalPath = null;
    this.titles = null;

    this.el.btnRoute.addEventListener('click', () => this.showOptimalPath());
    this.el.btnRestart.addEventListener('click', () => this.start());
    this.el.btnEscapes.addEventListener('click', () => this.toggleEscapePaths());
    this.el.btnTree.addEventListener('click', () => this.openTree());
    this.el.btnTreeClose.addEventListener('click', () => this.closeTree());
  }

  // Fetches JSON from the API; network and HTTP errors become user-facing messages.
  async request(url) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Revisa que este en marcha.');
    }
    if (!res.ok) {
      const msg = res.status === 404
        ? 'Esa escena no existe.'
        : `El servidor respondió con error ${res.status}.`;
      throw new Error(msg);
    }
    return res.json();
  }

  // Scene titles keyed by id, fetched once and cached.
  async getTitles() {
    if (!this.titles) {
      const scenes = await this.request(`${API}/scenes`);
      this.titles = new Map(scenes.map((scene) => [scene.id, scene.title]));
    }
    return this.titles;
  }

  showError(msg) {
    this.el.error.textContent = msg;
    this.el.error.hidden = !msg;
  }

  async start() {
    this.stats = { ...START_STAT };
    this.steps = 0;
    this.history = [];
    this.busy = false;
    this.el.ending.hidden = true;
    this.el.escapes.hidden = true;
    this.el.route.hidden = true;
    this.el.enemy.hidden = true;
    this.updateMeters(false);
    await this.loadScene('start', true);
  }

  async loadScene(id, isStart = false) {
    this.showError('');
    this.el.scene.setAttribute('aria-busy', 'true');
    try {
      const scene = await this.request(`${API}/scenes/${encodeURIComponent(id)}`);
      if (!isStart) this.steps += 1;
      this.history.push({ id: scene.id, title: scene.title });
      this.currentScene = scene;
      this.render(scene);
      this.updateTree();
    } catch (err) {
      this.showError(err.message);
    } finally {
      this.el.scene.setAttribute('aria-busy', 'false');
    }
  }

  // Player picks an option: apply its stat effects first, then walk to the target scene.
  async chooseOption(option) {
    if (this.busy) return;
    this.busy = true;
    try {
      playSound('click');
      this.applyEffects(option.effects);
      await this.loadScene(option.target);
    } finally {
      this.busy = false;
    }
  }

  applyEffects(effects = {}) {
    const before = { ...this.stats };
    const deltas = {};
    for (const key of STAT_KEYS) {
      const requested = normalizeEffect(effects[key]);
      this.stats[key] = clamp(before[key] + requested, 0, MAX_STAT[key]);
      deltas[key] = this.stats[key] - before[key];
    }
    this.updateMeters(true, deltas);

    if (deltas.health < 0) {
      playSound('hit');
      this.flashStage();
    } else if (deltas.health > 0) {
      playSound('heal');
    } else if (deltas.supplies > 0) {
      playSound('pickup');
    }
    if (deltas.noise > 0) this.shakeStage();
  }

  updateMeters(animate, deltas = {}) {
    for (const key of STAT_KEYS) {
      const meter = this.el.meters[key];
      const value = this.stats[key];
      const max = MAX_STAT[key];
      meter.value.textContent = `${value}/${max}`;
      meter.track.setAttribute('aria-valuenow', String(value));
      if (!animate) {
        // Set the fill without transition so the initial value does not slide in.
        meter.fill.style.transition = 'none';
        meter.fill.style.transform = `scaleX(${value / max})`;
        void meter.fill.offsetWidth;
        meter.fill.style.transition = '';
        continue;
      }
      meter.fill.style.transform = `scaleX(${value / max})`;
      const delta = deltas[key] ?? 0;
      if (delta !== 0) {
        const good = key === 'noise' ? delta < 0 : delta > 0;
        this.spawnFloat(meter.floats, `${delta > 0 ? '+' : ''}${delta}`, good ? 'good' : 'bad');
      }
    }
  }

  spawnFloat(container, text, tone) {
    const span = document.createElement('span');
    span.className = `float float--${tone}`;
    span.textContent = text;
    container.appendChild(span);
    setTimeout(() => span.remove(), 1200);
  }

  // Restarts a CSS class animation on an element.
  retrigger(element, className, duration) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    setTimeout(() => element.classList.remove(className), duration);
  }

  flashStage() {
    this.retrigger(this.el.flash, 'stage__flash--on', 600);
  }

  shakeStage() {
    this.retrigger(this.el.stage, 'stage--shake', 500);
  }

  render(scene) {
    const { title, text, options = [], ending, escape, enemy } = scene;
    this.el.title.textContent = title;
    this.el.stepCount.textContent = String(this.steps);
    this.renderEnemy(enemy);
    this.renderNarration(text);
    this.el.options.replaceChildren(...options.map((option) => this.createOption(option)));
    this.el.options.hidden = Boolean(ending);
    this.el.escapes.hidden = true;
    this.renderEnding(ending, escape);
    this.renderTrail();

    this.retrigger(this.el.scene, 'panel--enter', 900);
    this.el.title.focus();
  }

  renderEnemy(type) {
    const markup = ENEMY_SVG[type];
    if (!markup) {
      this.el.enemy.hidden = true;
      this.el.enemy.replaceChildren();
      return;
    }
    this.el.enemy.className = `enemy enemy--${type}`;
    this.el.enemy.innerHTML = `${markup}<p class="enemy__name">${ENEMY_LABELS[type]}</p>`;
    this.el.enemy.setAttribute('role', 'img');
    this.el.enemy.setAttribute('aria-label', `Enemigo: ${ENEMY_LABELS[type]}`);
    this.el.enemy.hidden = false;
    playSound(type);
  }

  // Each paragraph becomes its own caption box that appears in sequence.
  renderNarration(text) {
    const paragraphs = String(text ?? '').split(/\n\s*\n/).filter((p) => p.trim());
    this.el.text.replaceChildren(...paragraphs.map((paragraph, index) => {
      const p = document.createElement('p');
      p.className = 'caption';
      p.style.setProperty('--i', String(index));
      p.textContent = paragraph.trim();
      return p;
    }));
  }

  renderEnding(ending, escape) {
    this.el.ending.hidden = !ending;
    this.el.ending.dataset.ending = ending ?? '';
    this.el.ending.dataset.escape = escape ?? '';
    if (!ending) return;

    if (ending === 'victory') {
      const info = ESCAPE_TEXT[escape] ?? { title: 'Escapaste', text: 'Sales del edificio con vida.' };
      this.el.endingStamp.textContent = info.title;
      this.el.endingText.textContent = info.text;
      playSound('victory');
    } else {
      this.el.endingStamp.textContent = 'Fin';
      this.el.endingText.textContent = 'La horda te alcanza en el pasillo. Tu historia termina aquí.';
      playSound('death');
      this.flashStage();
      this.shakeStage();
    }
  }

  createOption(option) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bubble';
    button.textContent = option.text;
    button.addEventListener('click', () => this.chooseOption(option));
    li.appendChild(button);
    return li;
  }

  renderTrail() {
    const items = this.history.map((entry, index) => {
      const li = document.createElement('li');
      li.textContent = entry.title;
      if (index === this.history.length - 1) li.setAttribute('aria-current', 'step');
      return li;
    });
    this.el.trail.replaceChildren(...items);
  }

  pathIds() {
    return this.history.map((entry) => entry.id);
  }

  async showOptimalPath() {
    this.showError('');
    try {
      const [{ path, steps }, titles] = await Promise.all([
        this.request(`${API}/optimal-path`),
        this.getTitles().catch(() => new Map()),
      ]);
      if (!path) {
        this.el.route.hidden = true;
        this.optimalPath = null;
        this.showError('No hay ruta hacia una victoria desde el inicio.');
        return;
      }
      this.optimalPath = path;
      this.el.routeSteps.textContent = `${steps} pasos hasta la victoria.`;
      this.el.routeList.replaceChildren(
        ...path.map((id) => {
          const li = document.createElement('li');
          li.textContent = titles.get(id) ?? id;
          return li;
        }),
      );
      this.el.route.hidden = false;
      this.updateTree();
    } catch (err) {
      this.el.route.hidden = true;
      this.showError(err.message);
    }
  }

  // Lists the best route for each escape type from the server.
  async toggleEscapePaths() {
    if (!this.el.escapes.hidden) {
      this.el.escapes.hidden = true;
      return;
    }
    this.showError('');
    try {
      const [paths, titles] = await Promise.all([
        this.request(`${API}/escape-paths`),
        this.getTitles().catch(() => new Map()),
      ]);
      const sections = Object.keys(ESCAPE_NAMES).map((key) => {
        const wrap = document.createElement('div');
        wrap.className = 'escapes__item';
        const heading = document.createElement('h3');
        heading.className = 'escapes__name';
        heading.textContent = ESCAPE_NAMES[key];
        wrap.appendChild(heading);
        const entry = paths[key];
        if (!entry) {
          const none = document.createElement('p');
          none.className = 'escapes__none';
          none.textContent = 'Sin ruta disponible.';
          wrap.appendChild(none);
        } else {
          const info = document.createElement('p');
          info.className = 'escapes__steps';
          info.textContent = `${entry.steps} pasos`;
          const list = document.createElement('ol');
          list.className = 'escapes__list';
          for (const id of entry.path) {
            const li = document.createElement('li');
            li.textContent = titles.get(id) ?? id;
            list.appendChild(li);
          }
          wrap.append(info, list);
        }
        return wrap;
      });
      this.el.escapes.replaceChildren(...sections);
      this.el.escapes.hidden = false;
    } catch (err) {
      this.showError(err.message);
    }
  }

  // Shows the decision tree in the dialog, using the TreeView module when it is available.
  async openTree() {
    const dialog = this.el.dialog;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');

    this.el.treeMessage.hidden = true;
    if (!window.TreeView) {
      this.setTreeMessage('El visor del árbol no está disponible todavía.');
      return;
    }
    try {
      if (!this.treeData) this.treeData = await this.request(`${API}/tree`);
      if (!this.treeController) {
        this.treeController = window.TreeView.render(this.el.treeContainer, this.treeData, {
          pathIds: this.pathIds(),
          currentId: this.currentScene?.id,
          optimalPath: this.optimalPath,
          animate: true,
        });
      } else {
        this.updateTree();
      }
    } catch (err) {
      this.setTreeMessage(err.message);
    }
  }

  // Keeps the open tree in sync with the player's decisions.
  updateTree() {
    if (!this.treeController) return;
    try {
      this.treeController.update({ pathIds: this.pathIds(), currentId: this.currentScene?.id });
    } catch {
      /* the tree is cosmetic; a failed refresh must not break the game */
    }
  }

  setTreeMessage(msg) {
    this.el.treeMessage.textContent = msg;
    this.el.treeMessage.hidden = false;
  }

  closeTree() {
    if (typeof this.el.dialog.close === 'function') this.el.dialog.close();
    else this.el.dialog.removeAttribute('open');
  }
}

// Mute button: label and aria-pressed reflect the persisted mute state.
function setupMute() {
  const button = document.getElementById('btn-mute');
  if (!window.GameAudio) {
    button.disabled = true;
    button.textContent = 'Sonido no disponible';
    return;
  }
  const sync = () => {
    const muted = Boolean(window.GameAudio.isMuted());
    button.setAttribute('aria-pressed', String(muted));
    button.textContent = muted ? 'Sonido: silenciado' : 'Sonido: activado';
  };
  button.addEventListener('click', () => {
    try {
      window.GameAudio.toggleMute();
    } catch {
      /* ignore: audio is optional */
    }
    sync();
  });
  sync();
}

// Switches between the Game and Editor tabs; the editor is initialized on first open.
function activateView(name) {
  const isGame = name === 'game';
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  document.getElementById('view-game').hidden = !isGame;
  const editorView = document.getElementById('view-editor');
  editorView.hidden = isGame;

  if (!isGame && !editorView.dataset.initialized) {
    if (typeof window.initEditor === 'function') {
      window.initEditor(editorView);
      editorView.dataset.initialized = 'true';
    } else {
      editorView.textContent = 'El editor no se pudo cargar. Recarga la página.';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => activateView(tab.dataset.view));
  }
  setupMute();
  const game = new Game(document.getElementById('game'));
  game.start();
});
