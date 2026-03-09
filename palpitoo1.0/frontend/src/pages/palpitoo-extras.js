/**
 * palpitoo-extras.js
 * Toggle AMOLED + Banner de Palpite Esquecido + Navbar Inteligente
 *
 * IMPORTANTE: Todo o CSS está no style.css.
 * Este arquivo NÃO injeta nenhum estilo inline.
 */

'use strict';

const AMOLED_KEY  = 'palpitoo_amoled';
const BANNER_KEY  = 'palpitoo_banner_rodada';

/* ── Aplica AMOLED antes do primeiro paint ── */
if (localStorage.getItem(AMOLED_KEY) === 'on') {
  document.body.classList.add('amoled');
}

/* =========================================
   1. TOGGLE AMOLED
   ========================================= */

function injetarToggleAmoled() {
  /* Se o botão já foi inserido pelo HTML, só conecta o listener */
  const existente = document.getElementById('amoled-toggle');
  if (existente) {
    existente.addEventListener('click', toggleAmoled);
    return;
  }

  /* Fallback: injeta dinamicamente (para páginas sem o HTML atualizado) */
  const userArea = document.querySelector('.navbar-user');
  if (!userArea) return;

  const toggle = document.createElement('button');
  toggle.id = 'amoled-toggle';
  toggle.className = 'amoled-toggle';
  toggle.title = 'Alternar modo AMOLED';
  toggle.type = 'button';
  toggle.innerHTML = `
    <span class="amoled-toggle-label">AMOLED</span>
    <div class="amoled-toggle-track"></div>
    <span class="amoled-badge">ON</span>
  `;
  toggle.style.cssText = 'background:none;border:none;padding:0;cursor:pointer;display:flex;align-items:center;gap:8px;';
  toggle.addEventListener('click', toggleAmoled);

  const avatar = userArea.querySelector('.navbar-avatar');
  avatar ? userArea.insertBefore(toggle, avatar) : userArea.prepend(toggle);
}

function toggleAmoled() {
  const ligado = document.body.classList.toggle('amoled');
  localStorage.setItem(AMOLED_KEY, ligado ? 'on' : 'off');
  mostrarToast(
    ligado ? '🖤 Modo AMOLED ativado' : '🌑 Modo Dark padrão',
    'info'
  );
}

/* =========================================
   2. BANNER PALPITE ESQUECIDO
   ========================================= */

async function verificarPalpiteEsquecido() {
  const craqueId = localStorage.getItem('craqueId') || localStorage.getItem('id_craque');
  if (!craqueId) return;

  try {
    const resJogos = await fetch('https://palpitoo-api.onrender.com/jogos');
    if (!resJogos.ok) return;
    const jogos = await resJogos.json();

    const abertos = jogos.filter(j => j.status !== 'finalizado');
    if (!abertos.length) return;

    const rodadaNum = abertos[0].rodada ?? abertos[0].numero_rodada ?? 1;

    /* Já foi fechado nesta sessão? */
    if (sessionStorage.getItem(`${BANNER_KEY}_${rodadaNum}`)) return;

    const resPalpites = await fetch(`https://palpitoo-api.onrender.com/meus-palpites/${craqueId}`);
    if (!resPalpites.ok) return;
    const palpites = await resPalpites.json();

    const jaPalpitou = palpites.some(p =>
      (p.rodada ?? p.numero_rodada ?? 1) === rodadaNum
    );
    if (jaPalpitou) return;

    /* Calcula countdown se tiver prazo salvo */
    const prazoRaw  = localStorage.getItem(`palpitoo_prazo_rodada_${rodadaNum}`);
    let countdownTxt = '';
    let isUrgente    = false;

    if (prazoRaw) {
      const diff = new Date(prazoRaw) - Date.now();
      if (diff <= 0) return; /* prazo expirado */
      const horas  = Math.floor(diff / 3600000);
      const mins   = Math.floor((diff % 3600000) / 60000);
      isUrgente    = horas < 1;
      countdownTxt = isUrgente
        ? `${mins}min`
        : horas < 24
          ? `${horas}h ${mins}min`
          : `${Math.floor(horas / 24)}d ${horas % 24}h`;
    }

    exibirBanner(rodadaNum, countdownTxt, isUrgente);

  } catch (e) {
    console.debug('[palpitoo-extras] banner check:', e.message);
  }
}

function exibirBanner(rodadaNum, countdownTxt, isUrgente) {
  if (document.getElementById('banner-palpite-esquecido')) return;

  const cdHtml = countdownTxt
    ? `<span class="banner-countdown${isUrgente ? ' urgente' : ''}" id="banner-cd">⏱ ${countdownTxt}</span>`
    : '';

  const banner = document.createElement('div');
  banner.id = 'banner-palpite-esquecido';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <div class="banner-urgencia"></div>
    <div class="banner-inner">
      <span class="banner-icone">🦆</span>
      <div class="banner-texto">
        <div class="banner-titulo">Rodada ${rodadaNum} sem palpite!</div>
        <div class="banner-subtitulo">O Pato está te esperando. Não perca seus pontos.</div>
      </div>
      ${cdHtml}
      <a href="palpites.html" class="banner-cta" id="banner-cta-link">Palpitar agora</a>
      <button class="banner-fechar" id="banner-fechar-btn" aria-label="Fechar">✕</button>
    </div>
  `;

  /* Insere logo após a navbar */
  const navbar = document.querySelector('.navbar, .cabecalho-palpitoo');
  if (navbar) {
    navbar.insertAdjacentElement('afterend', banner);
  } else {
    document.body.prepend(banner);
  }

  /* Dispara a animação no próximo frame */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => banner.classList.add('visivel'));
  });

  /* Fechar */
  function fechar() {
    sessionStorage.setItem(`${BANNER_KEY}_${rodadaNum}`, '1');
    banner.classList.remove('visivel');
    banner.classList.add('saindo');
    banner.addEventListener('animationend', () => banner.remove(), { once: true });
  }

  document.getElementById('banner-fechar-btn').addEventListener('click', fechar);
  document.getElementById('banner-cta-link').addEventListener('click', fechar);

  /* Countdown ao vivo quando urgente */
  if (isUrgente) {
    const prazoRaw = localStorage.getItem(`palpitoo_prazo_rodada_${rodadaNum}`);
    if (prazoRaw) {
      const prazo = new Date(prazoRaw);
      const iv = setInterval(() => {
        const diff = prazo - Date.now();
        if (diff <= 0) { clearInterval(iv); fechar(); return; }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        const el = document.getElementById('banner-cd');
        if (el) el.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      }, 1000);
    }
  }
}

/* =========================================
   3. NAVBAR INTELIGENTE — Ligas
   ========================================= */
function redirecionarNavbarLigas() {
  const ligaId    = localStorage.getItem('liga_ativa_id');
  const linkLigas = document.querySelector('.nav-links a[href="ligas.html"]');
  if (ligaId && linkLigas) {
    linkLigas.href = 'minhaliga.html';
  }
}

/* =========================================
   TOAST (fallback se a página não tiver o próprio)
   ========================================= */
function mostrarToast(msg, tipo = 'info') {
  if (typeof window.mostrarAviso === 'function') {
    window.mostrarAviso(msg, tipo);
    return;
  }

  let container = document.getElementById('container-avisos');
  if (!container) {
    container = document.createElement('div');
    container.id = 'container-avisos';
    document.body.appendChild(container);
  }

  const icons = { sucesso: '✅', erro: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `aviso-toast aviso-${tipo}`;
  toast.innerHTML = `<span>${icons[tipo] ?? 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('aviso-saindo');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3000);
}

/* =========================================
   INIT
   ========================================= */
function init() {
  injetarToggleAmoled();
  verificarPalpiteEsquecido();
  redirecionarNavbarLigas();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}