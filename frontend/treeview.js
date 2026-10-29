/* Decision tree viewer (F2). Shared by the editor and the game.
   window.TreeView.render(container, treeData, {pathIds, currentId, optimalPath, animate}) -> {update({pathIds, currentId})}
   Draws the nested /api/tree data as SVG. Text is always set with textContent. */
(function () {
  'use strict';

  const NODE_W = 156;
  const NODE_H = 56;
  const LEVEL_H = 112;
  const LEAF_W = 184;
  const PAD = 40;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'g', 'rect', 'text', 'path', 'circle', 'title']);
  const ESCAPE_LABELS = { helicopter: 'Helicóptero', neighbor: 'Vecina', sewers: 'Alcantarillas' };
  const ENEMY_LABELS = { walker: 'Caminante', runner: 'Corredor', brute: 'Bruto', horde: 'Horda' };

  // DOM helper: SVG or HTML element depending on tag; "on*" keys are listeners; children are text or nodes.
  function el(tag, attrs = {}, ...children) {
    const node = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function truncate(text, max) {
    const s = String(text == null ? '' : text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // Simple layout: leaves get consecutive x slots, parents sit above the midpoint of their children.
  function layout(root) {
    const all = [];
    let leaf = 0;
    function build(node, depth, parent) {
      const entry = { node, depth, parent, x: 0, y: depth * LEVEL_H, kids: [], el: null, edge: null, status: 'none' };
      all.push(entry);
      const kids = node.children || [];
      if (!kids.length) {
        entry.x = leaf++ * LEAF_W;
      } else {
        for (const child of kids) entry.kids.push(build(child, depth + 1, entry));
        entry.x = (entry.kids[0].x + entry.kids[entry.kids.length - 1].x) / 2;
      }
      return entry;
    }
    build(root, 0, null);
    return all; // pre-order: parents always come before their children
  }

  function subtitle(node) {
    if (node.repeated) return 'Ya visitada';
    if (node.ending === 'victory') return ESCAPE_LABELS[node.escape] || 'Victoria';
    if (node.ending === 'death') return 'Muerte';
    return truncate(node.option_text || '', 26);
  }

  function render(container, treeData, options = {}) {
    container.replaceChildren();
    if (!treeData) {
      container.append(el('p', { class: 'tv-empty' }, 'Sin árbol que mostrar.'));
      return { update() {} };
    }

    const entries = layout(treeData);
    const xs = entries.map(e => e.x);
    const ys = entries.map(e => e.y);
    const home = {
      x: Math.min(...xs) - NODE_W / 2 - PAD,
      y: -NODE_H / 2 - PAD,
      w: Math.max(...xs) - Math.min(...xs) + NODE_W + 2 * PAD,
      h: Math.max(...ys) + NODE_H + 2 * PAD
    };
    const view = { ...home };
    const animated = Boolean(options.animate);
    const state = {
      pathIds: new Set(options.pathIds || []),
      currentId: options.currentId || null,
      optimal: new Set(options.optimalPath || [])
    };

    const svg = el('svg', {
      class: 'tv-svg', role: 'img', 'aria-label': 'Árbol de decisiones',
      viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`, preserveAspectRatio: 'xMidYMid meet'
    });
    const edgesG = el('g', { class: 'tv-edges' });
    const nodesG = el('g', { class: 'tv-nodes' });
    svg.append(edgesG, nodesG);

    for (const e of entries) {
      const delay = `${e.depth * 160}ms`;
      if (e.parent) {
        const p = e.parent;
        const y1 = p.y + NODE_H / 2;
        const y2 = e.y - NODE_H / 2;
        const mid = (y1 + y2) / 2;
        e.edge = el('path', { class: 'tv-edge', d: `M${p.x},${y1} C${p.x},${mid} ${e.x},${mid} ${e.x},${y2}` },
          e.node.option_text ? el('title', {}, e.node.option_text) : null);
        if (animated) e.edge.style.setProperty('--tv-delay', delay);
        edgesG.append(e.edge);
      }
      const kids = [];
      if (e.node.enemy) {
        kids.push(el('circle', { class: 'tv-enemy', cx: NODE_W / 2 - 8, cy: -NODE_H / 2 + 8, r: 5 },
          el('title', {}, ENEMY_LABELS[e.node.enemy] || e.node.enemy)));
      }
      e.el = el('g', { transform: `translate(${e.x},${e.y})` },
        el('title', {}, e.node.option_text ? `${e.node.name} (${e.node.option_text})` : e.node.name),
        el('rect', { class: 'tv-box', x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 4 }),
        el('text', { class: 'tv-name', 'text-anchor': 'middle', y: -4 }, truncate(e.node.name || e.node.id, 20)),
        el('text', { class: 'tv-sub', 'text-anchor': 'middle', y: 14 }, subtitle(e.node)),
        ...kids);
      if (animated) e.el.style.setProperty('--tv-delay', delay);
      nodesG.append(e.el);
    }

    // Walks the tree in pre-order and sets each node's status and CSS classes.
    function applyStates() {
      const { pathIds, currentId, optimal } = state;
      let currentDone = false;
      for (const e of entries) {
        const n = e.node;
        const visited = pathIds.has(n.id) && !n.repeated;
        if (!pathIds.size) e.status = 'none';
        else if (visited) e.status = 'visited';
        else if (e.parent && (e.parent.status === 'visited' || e.parent.status === 'off')) e.status = 'off';
        else e.status = 'dim';

        const classes = ['tv-node'];
        if (animated) classes.push('tv-animate');
        if (n.ending) classes.push(`tv-${n.ending}`);
        if (n.repeated) classes.push('tv-ghost');
        if (e.status !== 'none') classes.push(`tv-${e.status}`);
        if (visited && !currentDone && n.id === currentId) {
          classes.push('tv-current');
          currentDone = true;
        }
        if (optimal.has(n.id) && !visited && !n.repeated) classes.push('tv-optimal');
        e.el.setAttribute('class', classes.join(' '));

        if (e.edge) {
          const edgeClass = ['tv-edge'];
          if (animated) edgeClass.push('tv-animate');
          if (e.status === 'visited') edgeClass.push('tv-edge--path');
          else if (e.status === 'off') edgeClass.push('tv-edge--off');
          e.edge.setAttribute('class', edgeClass.join(' '));
        }
      }
    }

    // Zoom and pan on the SVG viewBox.
    function applyView() {
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    }

    function zoomBy(factor) {
      const cx = view.x + view.w / 2;
      const cy = view.y + view.h / 2;
      const w = Math.min(Math.max(view.w * factor, home.w / 8), home.w * 3);
      const ratio = w / view.w;
      view.w = w;
      view.h *= ratio;
      view.x = cx - view.w / 2;
      view.y = cy - view.h / 2;
      applyView();
    }

    function resetView() {
      Object.assign(view, home);
      applyView();
    }

    let drag = null;
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomBy(ev.deltaY > 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    svg.addEventListener('pointerdown', (ev) => {
      drag = { x: ev.clientX, y: ev.clientY };
      svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      // With "meet", the scale is the larger of the two ratios.
      const scale = Math.max(view.w / svg.clientWidth, view.h / svg.clientHeight);
      view.x -= (ev.clientX - drag.x) * scale;
      view.y -= (ev.clientY - drag.y) * scale;
      drag = { x: ev.clientX, y: ev.clientY };
      applyView();
    });
    const endDrag = () => { drag = null; };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    const toolbar = el('div', { class: 'tv-toolbar' },
      el('button', { type: 'button', class: 'tv-btn', 'aria-label': 'Acercar', onclick: () => zoomBy(1 / 1.2) }, '+'),
      el('button', { type: 'button', class: 'tv-btn', 'aria-label': 'Alejar', onclick: () => zoomBy(1.2) }, '−'),
      el('button', { type: 'button', class: 'tv-btn', onclick: resetView }, 'Restablecer'));

    container.append(el('div', { class: 'tv-root' }, toolbar, svg));
    applyStates();

    return {
      update(next = {}) {
        if ('pathIds' in next) state.pathIds = new Set(next.pathIds || []);
        if ('currentId' in next) state.currentId = next.currentId || null;
        if ('optimalPath' in next) state.optimal = new Set(next.optimalPath || []);
        applyStates();
      }
    };
  }

  window.TreeView = { render };
})();
