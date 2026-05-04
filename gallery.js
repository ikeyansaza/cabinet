/* gallery.js — mokomoko album */

(function () {
  'use strict';

  /* ── state ── */
  let allPhotos = [];
  let visible   = [];
  let current   = 0;
  let activeTag = 'all';

  /* ── elements ── */
  const grid      = document.getElementById('grid');
  const filters   = document.getElementById('filters');
  const countEl   = document.getElementById('count');
  const headerMeta = document.getElementById('header-meta');
  const lb        = document.getElementById('lb');
  const lbImg     = document.getElementById('lb-img');
  const lbTitle   = document.getElementById('lb-title');
  const lbTags    = document.getElementById('lb-tags');
  const lbExif    = document.getElementById('lb-exif');
  const lbClose   = document.getElementById('lb-close');
  const lbPrev    = document.getElementById('lb-prev');
  const lbNext    = document.getElementById('lb-next');

  /* ── load photos.json ── */
  fetch('photos.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      allPhotos = data;
      init();
    })
    .catch(err => {
      grid.innerHTML = `<div class="loading">error: ${err.message}</div>`;
    });

  /* ── init ── */
  function init() {
    buildTagButtons();
    applyFilter('all');

    const total = allPhotos.length;
    headerMeta.textContent = `${total} photos · animals`;
  }

  /* ── tag buttons ── */
  function buildTagButtons() {
    const tagSet = new Set();
    allPhotos.forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));

    const sorted = [...tagSet].sort();
    sorted.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'tag';
      btn.dataset.tag = tag;
      btn.textContent = tag;
      btn.addEventListener('click', () => applyFilter(tag));
      filters.appendChild(btn);
    });

    filters.querySelectorAll('.tag').forEach(btn => {
      btn.addEventListener('click', () => {
        filters.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  /* ── filter ── */
  function applyFilter(tag) {
    activeTag = tag;
    visible = tag === 'all'
      ? [...allPhotos]
      : allPhotos.filter(p => (p.tags || []).includes(tag));

    renderGrid();
    countEl.textContent = visible.length;
  }

  /* ── grid render ── */
  function renderGrid() {
    grid.innerHTML = '';

    if (visible.length === 0) {
      grid.innerHTML = '<div class="empty">no photos found</div>';
      return;
    }

    visible.forEach((photo, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', photo.title || photo.file);

      const img = document.createElement('img');
      img.className = 'loading';
      img.alt = photo.title || '';
      img.loading = 'lazy';
      img.src = `photos/${photo.file}`;
      img.addEventListener('load',  () => img.classList.replace('loading', 'loaded'));
      img.addEventListener('error', () => img.classList.replace('loading', 'loaded'));

      const info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML = `
        <div class="card-title">${esc(photo.title || photo.file)}</div>
        <div class="card-meta">${esc((photo.tags || []).join(' · '))} · ${esc(photo.date || '')}</div>
      `;

      card.appendChild(img);
      card.appendChild(info);
      card.addEventListener('click', () => openLB(i));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openLB(i); });

      grid.appendChild(card);
    });
  }

  /* ── lightbox ── */
  function openLB(i) {
    current = i;
    const p = visible[i];

    lbImg.src = `photos/${p.file}`;
    lbImg.alt = p.title || p.file;
    lbTitle.textContent = p.title || p.file;

    lbTags.innerHTML = (p.tags || [])
      .map(t => `<span class="lb-tag">${esc(t)}</span>`)
      .join('');

    const lines = [];
    if (p.camera) lines.push(p.camera);
    if (p.lens)   lines.push(p.lens);
    if (p.exif)   lines.push(p.exif);
    if (p.date)   lines.push(p.date);
    lbExif.textContent = lines.join('\n');

    updateCounter();
    lb.classList.add('open');
    lbClose.focus();
  }

  function closeLB() {
    lb.classList.remove('open');
    lbImg.src = '';
  }

  function navigate(dir) {
    current = (current + dir + visible.length) % visible.length;
    openLB(current);
  }

  function updateCounter() {
    const el = document.getElementById('lb-counter');
    if (el) el.textContent = `${current + 1} / ${visible.length}`;
  }

  lbClose.addEventListener('click', closeLB);
  lbPrev.addEventListener('click',  () => navigate(-1));
  lbNext.addEventListener('click',  () => navigate(+1));

  lb.addEventListener('click', e => {
    if (e.target === lb) closeLB();
  });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLB();
    if (e.key === 'ArrowLeft')  navigate(-1);
    if (e.key === 'ArrowRight') navigate(+1);
  });

  /* ── util ── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
