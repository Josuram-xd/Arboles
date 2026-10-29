// Juego de aventura: navega el arbol de escenas consumiendo la API.
const API = '/api';

class Juego {
  constructor(raiz) {
    this.el = {
      contador: raiz.querySelector('#contador'),
      btnRuta: raiz.querySelector('#btn-ruta'),
      error: raiz.querySelector('#error'),
      escena: raiz.querySelector('#escena'),
      titulo: raiz.querySelector('#titulo'),
      texto: raiz.querySelector('#texto'),
      opciones: raiz.querySelector('#opciones'),
      final: raiz.querySelector('#final'),
      finalSello: raiz.querySelector('#final-sello'),
      finalEtiqueta: raiz.querySelector('#final-etiqueta'),
      btnReiniciar: raiz.querySelector('#btn-reiniciar'),
      ruta: raiz.querySelector('#ruta'),
      rutaPasos: raiz.querySelector('#ruta-pasos'),
      rutaLista: raiz.querySelector('#ruta-lista'),
      migas: raiz.querySelector('#migas'),
    };
    this.pasos = 0;
    this.historial = [];
    this.el.btnRuta.addEventListener('click', () => this.verRutaOptima());
    this.el.btnReiniciar.addEventListener('click', () => this.iniciar());
  }

  async pedir(url) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Revisa que este en marcha.');
    }
    if (!res.ok) {
      const msg = res.status === 404 ? 'Esa escena no existe.' : `El servidor respondio con error ${res.status}.`;
      throw new Error(msg);
    }
    return res.json();
  }

  mostrarError(msg) {
    this.el.error.textContent = msg;
    this.el.error.hidden = !msg;
  }

  async iniciar() {
    this.pasos = 0;
    this.historial = [];
    this.el.final.hidden = true;
    this.el.ruta.hidden = true;
    await this.cargarEscena('inicio', true);
  }

  async cargarEscena(id, esInicio = false) {
    this.mostrarError('');
    this.el.escena.setAttribute('aria-busy', 'true');
    try {
      const escena = await this.pedir(`${API}/escenas/${encodeURIComponent(id)}`);
      if (!esInicio) this.pasos += 1;
      this.historial.push({ id: escena.id, titulo: escena.titulo });
      this.renderizar(escena);
    } catch (err) {
      this.mostrarError(err.message);
    } finally {
      this.el.escena.setAttribute('aria-busy', 'false');
    }
  }

  renderizar(escena) {
    const { titulo, texto, opciones = [], final } = escena;
    this.el.titulo.textContent = titulo;
    this.el.texto.textContent = texto;
    this.el.contador.textContent = String(this.pasos);
    this.el.opciones.replaceChildren(...opciones.map((op) => this.crearOpcion(op)));
    this.el.opciones.hidden = Boolean(final);

    this.el.final.hidden = !final;
    this.el.final.dataset.tipo = final ?? '';
    if (final) {
      const victoria = final === 'victoria';
      this.el.finalSello.textContent = victoria ? 'Sobreviviste' : 'Fin';
      this.el.finalEtiqueta.textContent = victoria
        ? 'Llegaste al amanecer. El refugio sigue en pie.'
        : 'Te alcanzaron. La horda se lleva lo que queda.';
    }
    this.renderizarMigas();

    this.el.escena.classList.remove('vineta--entrar');
    void this.el.escena.offsetWidth; // reinicia la animacion
    this.el.escena.classList.add('vineta--entrar');
    this.el.titulo.focus({ preventScroll: false });
  }

  crearOpcion(opcion) {
    const li = document.createElement('li');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'globo';
    boton.textContent = opcion.texto;
    boton.addEventListener('click', () => this.cargarEscena(opcion.destino));
    li.appendChild(boton);
    return li;
  }

  renderizarMigas() {
    const items = this.historial.map((h, i) => {
      const li = document.createElement('li');
      li.textContent = h.titulo;
      if (i === this.historial.length - 1) li.setAttribute('aria-current', 'step');
      return li;
    });
    this.el.migas.replaceChildren(...items);
  }

  async verRutaOptima() {
    this.mostrarError('');
    try {
      const [{ ruta, pasos }, escenas] = await Promise.all([
        this.pedir(`${API}/ruta-optima`),
        this.pedir(`${API}/escenas`).catch(() => []),
      ]);
      const titulos = new Map(escenas.map((e) => [e.id, e.titulo]));
      this.el.rutaPasos.textContent = `${pasos} pasos hasta la victoria.`;
      this.el.rutaLista.replaceChildren(
        ...ruta.map((id) => {
          const li = document.createElement('li');
          li.textContent = titulos.get(id) ?? id;
          return li;
        }),
      );
      this.el.ruta.hidden = false;
    } catch (err) {
      this.el.ruta.hidden = true;
      this.mostrarError(err.message);
    }
  }
}

function activarVista(nombre) {
  const esJuego = nombre === 'juego';
  for (const boton of document.querySelectorAll('.pestana')) {
    const activa = boton.dataset.vista === nombre;
    boton.setAttribute('aria-selected', String(activa));
    boton.tabIndex = activa ? 0 : -1;
  }
  document.getElementById('vista-juego').hidden = !esJuego;
  const vistaEditor = document.getElementById('vista-editor');
  vistaEditor.hidden = esJuego;

  if (!esJuego && !vistaEditor.dataset.iniciada) {
    if (typeof window.initEditor === 'function') {
      window.initEditor(vistaEditor);
      vistaEditor.dataset.iniciada = 'true';
    } else {
      vistaEditor.textContent = 'El editor no se pudo cargar. Recarga la pagina.';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  for (const boton of document.querySelectorAll('.pestana')) {
    boton.addEventListener('click', () => activarVista(boton.dataset.vista));
  }
  const juego = new Juego(document.getElementById('juego'));
  juego.iniciar();
});
