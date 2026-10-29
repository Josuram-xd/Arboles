// Zombie survival graphic novel: walks the scene tree through the API.
const API = '/api';

class Game {
  constructor(root) {
    this.el = {
      stepCount: root.querySelector('#step-count'),
      btnRoute: root.querySelector('#btn-route'),
      error: root.querySelector('#error'),
      scene: root.querySelector('#scene'),
      title: root.querySelector('#scene-title'),
      text: root.querySelector('#scene-text'),
      options: root.querySelector('#options'),
      ending: root.querySelector('#ending'),
      endingStamp: root.querySelector('#ending-stamp'),
      endingText: root.querySelector('#ending-text'),
      btnRestart: root.querySelector('#btn-restart'),
      route: root.querySelector('#route'),
      routeSteps: root.querySelector('#route-steps'),
      routeList: root.querySelector('#route-list'),
      trail: root.querySelector('#trail'),
    };
    this.steps = 0;
    this.history = [];
    this.el.btnRoute.addEventListener('click', () => this.showOptimalPath());
    this.el.btnRestart.addEventListener('click', () => this.start());
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

  showError(msg) {
    this.el.error.textContent = msg;
    this.el.error.hidden = !msg;
  }

  async start() {
    this.steps = 0;
    this.history = [];
    this.el.ending.hidden = true;
    this.el.route.hidden = true;
    await this.loadScene('start', true);
  }

  async loadScene(id, isStart = false) {
    this.showError('');
    this.el.scene.setAttribute('aria-busy', 'true');
    try {
      const scene = await this.request(`${API}/scenes/${encodeURIComponent(id)}`);
      if (!isStart) this.steps += 1;
      this.history.push({ id: scene.id, title: scene.title });
      this.render(scene);
    } catch (err) {
      this.showError(err.message);
    } finally {
      this.el.scene.setAttribute('aria-busy', 'false');
    }
  }

  render(scene) {
    const { title, text, options = [], ending } = scene;
    this.el.title.textContent = title;
    this.el.text.textContent = text;
    this.el.stepCount.textContent = String(this.steps);
    this.el.options.replaceChildren(...options.map((option) => this.createOption(option)));
    this.el.options.hidden = Boolean(ending);

    this.el.ending.hidden = !ending;
    this.el.ending.dataset.ending = ending ?? '';
    if (ending) {
      const victory = ending === 'victory';
      this.el.endingStamp.textContent = victory ? 'Sobreviviste' : 'Fin';
      this.el.endingText.textContent = victory
        ? 'Llegaste al amanecer. El refugio sigue en pie.'
        : 'Te alcanzaron. La horda se lleva lo que queda.';
    }
    this.renderTrail();

    this.el.scene.classList.remove('panel--enter');
    void this.el.scene.offsetWidth; // restart the entry animation
    this.el.scene.classList.add('panel--enter');
    this.el.title.focus();
  }

  createOption(option) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bubble';
    button.textContent = option.text;
    button.addEventListener('click', () => this.loadScene(option.target));
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

  async showOptimalPath() {
    this.showError('');
    try {
      const [{ path, steps }, scenes] = await Promise.all([
        this.request(`${API}/optimal-path`),
        this.request(`${API}/scenes`).catch(() => []),
      ]);
      if (!path) {
        this.el.route.hidden = true;
        this.showError('No hay ruta hacia una victoria desde el inicio.');
        return;
      }
      const titles = new Map(scenes.map((scene) => [scene.id, scene.title]));
      this.el.routeSteps.textContent = `${steps} pasos hasta la victoria.`;
      this.el.routeList.replaceChildren(
        ...path.map((id) => {
          const li = document.createElement('li');
          li.textContent = titles.get(id) ?? id;
          return li;
        }),
      );
      this.el.route.hidden = false;
    } catch (err) {
      this.el.route.hidden = true;
      this.showError(err.message);
    }
  }
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
  const game = new Game(document.getElementById('game'));
  game.start();
});
