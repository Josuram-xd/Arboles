/* Scene editor and tree viewer (F2). Vanilla JS, no build.
   Exposes window.initEditor(container). Data text is always inserted with textContent. */
(function () {
  'use strict';

  const API = '/api';
  const ENDINGS = { '': 'Ninguno', victory: 'Victoria', death: 'Muerte' };
  const MESSAGES = {
    404: 'La escena no existe.',
    409: 'Conflicto: el id ya existe o hay otra escena que lo necesita.',
    422: 'Datos no válidos.'
  };

  class ApiError extends Error {
    constructor(status, detail) {
      super('HTTP ' + status);
      this.status = status;
      this.detail = detail;
    }
  }

  // Small DOM helper: props map to attributes, "on*" keys become listeners, children are text or nodes.
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function extractDetail(data) {
    const d = data && data.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(x => (x && x.msg) || '').filter(Boolean).join('; ');
    return '';
  }

  function validateLocal(scene) {
    if (!scene.id) return 'El id es obligatorio.';
    if (!scene.title) return 'El título es obligatorio.';
    if (!scene.text) return 'El texto es obligatorio.';
    if (scene.options.some(o => !o.text || !o.target)) return 'Cada opción necesita texto y destino.';
    return '';
  }

  class SceneEditor {
    constructor(container) {
      this.container = container;
      this.scenes = [];
      this.editingId = null;
      this.pathIds = new Set();
      this.build();
    }

    async start() {
      this.newScene();
      await this.refresh();
    }

    /* ---------- API ---------- */

    async api(path, method = 'GET', body = null) {
      const options = { method, headers: {} };
      if (body !== null) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const res = await fetch(API + path, options);
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, extractDetail(data));
      return data;
    }

    errorMessage(err, context = {}) {
      if (!(err instanceof ApiError)) return 'No se pudo conectar con el servidor.';
      const base = context[err.status] || MESSAGES[err.status] || `Error del servidor (${err.status}).`;
      return err.detail ? `${base} ${err.detail}` : base;
    }

    notify(zone, text, type = 'error') {
      zone.textContent = text;
      zone.dataset.type = type;
    }

    /* ---------- Layout ---------- */

    build() {
      this.notice = h('p', { class: 'ed-notice', role: 'status', 'aria-live': 'polite' });
      this.listEl = h('ul', { class: 'ed-list' });
      this.validationEl = h('div', { class: 'ed-validation' });
      this.treeEl = h('div', { class: 'ed-tree' });
      this.pathEl = h('div', { class: 'ed-path' });
      this.formTitle = h('h3', { class: 'ed-subtitle' }, 'Nueva escena');
      this.buildForm();

      this.container.replaceChildren(h('section', { class: 'ed-root' },
        h('header', { class: 'ed-header' },
          h('h2', { class: 'ed-title' }, 'Editor de escenas'),
          h('button', { type: 'button', class: 'ed-btn', onclick: () => this.refresh() }, 'Actualizar')),
        this.notice,
        h('div', { class: 'ed-grid' },
          h('section', { class: 'ed-panel' },
            h('h3', { class: 'ed-subtitle' }, 'Escenas'),
            h('button', { type: 'button', class: 'ed-btn ed-btn--primary', onclick: () => this.newScene() }, 'Nueva escena'),
            this.listEl),
          h('section', { class: 'ed-panel' }, this.formTitle, this.form)),
        h('div', { class: 'ed-grid' },
          h('section', { class: 'ed-panel' },
            h('h3', { class: 'ed-subtitle' }, 'Validación'),
            this.validationEl),
          h('section', { class: 'ed-panel' },
            h('h3', { class: 'ed-subtitle' }, 'Árbol'),
            h('p', { class: 'ed-legend' },
              h('span', { class: 'ed-swatch ed-swatch--victory' }), ' Victoria  ',
              h('span', { class: 'ed-swatch ed-swatch--death' }), ' Muerte  ',
              h('span', { class: 'ed-swatch ed-swatch--path' }), ' Ruta óptima'),
            this.treeEl,
            h('h4', { class: 'ed-subtitle ed-subtitle--minor' }, 'Ruta óptima'),
            this.pathEl))));
    }

    buildForm() {
      this.inputId = h('input', { type: 'text', autocomplete: 'off', required: true });
      this.inputTitle = h('input', { type: 'text', required: true });
      this.textInput = h('textarea', { rows: 4, required: true });
      this.endingSelect = h('select', {}, Object.entries(ENDINGS).map(([v, t]) => h('option', { value: v }, t)));
      this.optionsEl = h('div', { class: 'ed-options' });
      this.formNotice = h('p', { class: 'ed-notice', role: 'alert' });
      this.deleteBtn = h('button', { type: 'button', class: 'ed-btn ed-btn--danger', onclick: () => this.askDelete() }, 'Eliminar');
      this.confirmZone = h('div', { class: 'ed-confirm', hidden: true },
        h('span', {}, '¿Eliminar esta escena?'),
        h('button', { type: 'button', class: 'ed-btn ed-btn--danger', onclick: () => this.confirmDelete() }, 'Confirmar'),
        h('button', { type: 'button', class: 'ed-btn', onclick: () => this.cancelDelete() }, 'Cancelar'));

      this.form = h('form', {
        class: 'ed-form', novalidate: true,
        onsubmit: (e) => { e.preventDefault(); this.save(); }
      },
        h('label', { class: 'ed-field' }, h('span', {}, 'Id'), this.inputId),
        h('label', { class: 'ed-field' }, h('span', {}, 'Título'), this.inputTitle),
        h('label', { class: 'ed-field' }, h('span', {}, 'Texto'), this.textInput),
        h('label', { class: 'ed-field' }, h('span', {}, 'Final'), this.endingSelect),
        h('fieldset', { class: 'ed-fieldset' },
          h('legend', {}, 'Opciones'),
          this.optionsEl,
          h('button', { type: 'button', class: 'ed-btn', onclick: () => this.addOption() }, 'Agregar opción')),
        this.formNotice,
        h('div', { class: 'ed-actions' },
          h('button', { type: 'submit', class: 'ed-btn ed-btn--primary' }, 'Guardar'),
          this.deleteBtn),
        this.confirmZone);
    }

    /* ---------- Form state ---------- */

    newScene() {
      this.editingId = null;
      this.fill({ id: '', title: '', text: '', ending: null, options: [] });
      this.updateEditMode();
    }

    updateEditMode() {
      const editing = this.editingId !== null;
      this.inputId.readOnly = editing;
      this.formTitle.textContent = editing ? 'Editar escena' : 'Nueva escena';
      this.cancelDelete();
      this.notify(this.formNotice, '');
      this.markSelection();
    }

    fill(scene) {
      this.inputId.value = scene.id;
      this.inputTitle.value = scene.title;
      this.textInput.value = scene.text;
      this.endingSelect.value = scene.ending || '';
      this.optionsEl.replaceChildren(...(scene.options || []).map(o => this.optionRow(o.text, o.target)));
    }

    readForm() {
      return {
        id: this.inputId.value.trim(),
        title: this.inputTitle.value.trim(),
        text: this.textInput.value.trim(),
        ending: this.endingSelect.value || null,
        options: [...this.optionsEl.querySelectorAll('.ed-option')].map(row => ({
          text: row.querySelector('.ed-option-text').value.trim(),
          target: row.querySelector('.ed-target').value
        }))
      };
    }

    optionRow(text = '', target = '') {
      const select = h('select', { class: 'ed-target', 'aria-label': 'Destino de la opción' });
      this.fillTargets(select, target);
      const row = h('div', { class: 'ed-option' },
        h('input', { type: 'text', class: 'ed-option-text', value: text, placeholder: 'Texto de la opción', 'aria-label': 'Texto de la opción' }),
        select,
        h('button', { type: 'button', class: 'ed-btn ed-btn--ghost', 'aria-label': 'Quitar opción', onclick: () => row.remove() }, '×'));
      return row;
    }

    addOption() {
      this.optionsEl.append(this.optionRow());
    }

    fillTargets(select, value = '') {
      const ids = this.scenes.map(s => s.id);
      const options = [h('option', { value: '' }, 'Elige destino'), ...ids.map(id => h('option', { value: id }, this.label(id)))];
      if (value && !ids.includes(value)) options.push(h('option', { value }, value + ' (no existe)'));
      select.replaceChildren(...options);
      select.value = value;
    }

    refreshTargets() {
      this.optionsEl.querySelectorAll('.ed-target').forEach(s => this.fillTargets(s, s.value));
    }

    label(id) {
      const scene = this.scenes.find(s => s.id === id);
      return scene ? `${scene.title} (${id})` : id;
    }

    /* ---------- Save / delete ---------- */

    async save() {
      const scene = this.readForm();
      const error = validateLocal(scene);
      if (error) return this.notify(this.formNotice, error);
      const creating = this.editingId === null;
      try {
        if (creating) {
          await this.api('/scenes', 'POST', scene);
          this.editingId = scene.id;
        } else {
          await this.api(`/scenes/${encodeURIComponent(this.editingId)}`, 'PUT', scene);
        }
        this.updateEditMode();
        this.notify(this.formNotice, 'Escena guardada.', 'ok');
        await this.refresh();
      } catch (err) {
        const context = creating ? { 409: 'Ya existe una escena con ese id.' } : {};
        this.notify(this.formNotice, this.errorMessage(err, context));
      }
    }

    askDelete() {
      this.confirmZone.hidden = false;
      this.deleteBtn.hidden = true;
      this.confirmZone.querySelector('button').focus();
    }

    cancelDelete() {
      this.confirmZone.hidden = true;
      this.deleteBtn.hidden = this.editingId === null;
    }

    async confirmDelete() {
      const id = this.editingId;
      this.cancelDelete();
      try {
        await this.api(`/scenes/${encodeURIComponent(id)}`, 'DELETE');
        this.newScene();
        this.notify(this.notice, `Escena "${id}" eliminada.`, 'ok');
        await this.refresh();
      } catch (err) {
        this.notify(this.formNotice, this.errorMessage(err, {
          404: 'La escena ya no existe.',
          409: 'No se puede eliminar: otra escena apunta a ella o es la escena inicial.'
        }));
      }
    }

    async edit(id) {
      try {
        const scene = await this.api(`/scenes/${encodeURIComponent(id)}`);
        this.editingId = id;
        this.fill(scene);
        this.updateEditMode();
      } catch (err) {
        this.notify(this.formNotice, this.errorMessage(err, { 404: 'La escena ya no existe.' }));
      }
    }

    /* ---------- Lists, validation, tree ---------- */

    async refresh() {
      await this.loadScenes();
      await Promise.all([this.loadTree(), this.loadValidation()]);
    }

    async loadScenes() {
      try {
        this.scenes = await this.api('/scenes');
        this.renderList();
        this.refreshTargets();
      } catch (err) {
        this.notify(this.notice, this.errorMessage(err));
      }
    }

    renderList() {
      if (!this.scenes.length) {
        this.listEl.replaceChildren(h('li', { class: 'ed-empty' }, 'No hay escenas.'));
        return;
      }
      this.listEl.replaceChildren(...this.scenes.map(s => h('li', {},
        h('button', { type: 'button', class: 'ed-item', 'data-id': s.id, onclick: () => this.edit(s.id) },
          h('span', { class: 'ed-item-title' }, s.title),
          h('span', { class: 'ed-item-id' }, s.id),
          s.ending && h('span', { class: `ed-badge ed-badge--${s.ending}` }, ENDINGS[s.ending])))));
      this.markSelection();
    }

    markSelection() {
      this.listEl.querySelectorAll('.ed-item').forEach(b => {
        b.setAttribute('aria-current', b.dataset.id === this.editingId ? 'true' : 'false');
      });
    }

    async loadValidation() {
      try {
        const r = await this.api('/validate');
        const sections = [
          ['Inalcanzables', r.unreachable],
          ['Sin salida', r.dead_ends],
          ['Destinos rotos', r.broken_targets]
        ];
        this.validationEl.replaceChildren(...sections.map(([title, ids]) => h('div', { class: 'ed-block' },
          h('h4', { class: 'ed-subtitle ed-subtitle--minor' }, `${title} (${ids.length})`),
          ids.length
            ? h('ul', { class: 'ed-ids' }, ids.map(id => h('li', {}, this.label(id))))
            : h('p', { class: 'ed-ok' }, 'Sin casos.'))));
      } catch (err) {
        this.validationEl.replaceChildren(h('p', { class: 'ed-error' }, this.errorMessage(err)));
      }
    }

    async loadTree() {
      try {
        const tree = await this.api('/tree');
        let optimal = { path: [], steps: 0 };
        try {
          optimal = await this.api('/optimal-path');
        } catch (err) {
          this.notify(this.notice, 'No se pudo calcular la ruta óptima. ' + this.errorMessage(err));
        }
        this.pathIds = new Set(optimal.path || []);
        this.treeEl.replaceChildren(h('ul', { class: 'ed-tree-root' }, this.treeNode(tree)));
        this.pathEl.replaceChildren(this.renderPath(optimal));
      } catch (err) {
        this.treeEl.replaceChildren(h('p', { class: 'ed-error' }, this.errorMessage(err)));
      }
    }

    treeNode(node) {
      const classes = ['ed-node'];
      if (node.ending) classes.push(`ed-ending--${node.ending}`);
      if (this.pathIds.has(node.id)) classes.push('ed-on-path');
      const children = (node.children || []).map(c => this.treeNode(c));
      return h('li', {},
        h('span', { class: classes.join(' ') }, node.name || node.id, ' ', h('code', { class: 'ed-item-id' }, node.id)),
        children.length ? h('ul', {}, children) : null);
    }

    renderPath(optimal) {
      if (!optimal.path || !optimal.path.length) return h('p', { class: 'ed-ok' }, 'No hay ruta hasta una victoria.');
      return h('div', {},
        h('p', { class: 'ed-legend' }, `${optimal.steps} pasos`),
        h('ol', { class: 'ed-path-list' }, optimal.path.map(id => h('li', {}, this.label(id)))));
    }
  }

  window.initEditor = function (container) {
    const editor = new SceneEditor(container);
    editor.start();
    return editor;
  };
})();
