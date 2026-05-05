/* gallery.js — mokomoko album */

(function () {
  'use strict';

  /* ── state ── */
  let allPhotos  = [];
  let speciesMap = {};
  let visible    = [];
  let current    = 0;
  let activeTag  = 'all';

  /* ── tauri 連携ヘルパ ── */
  let tauriApi = null;
  async function tauri() {
    if (!tauriApi) tauriApi = await import('./tauri.js');
    return tauriApi;
  }

  async function photoUrl(file) {
    const T = await tauri();
    const dir = await T.invoke('get_active_dir');
    if (!dir) return `photos/${file}`; // フォールバック
    const abs = `${dir}/${file}`.replace(/\\/g, '/');
    return T.convertFileSrc(abs);
  }

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
  const lbSpecies       = document.getElementById('lb-species');
  const lbSpNameJa      = document.getElementById('lb-species-name-ja');
  const lbSpNameEn      = document.getElementById('lb-species-name-en');
  const lbSpMeta        = document.getElementById('lb-species-meta');
  const lbSpFeatures    = document.getElementById('lb-species-features');
  const lbSpDescription = document.getElementById('lb-species-description');
  const picker        = document.getElementById('picker');
  const pickerBtn     = document.getElementById('picker-btn');
  const categoryTabs   = document.getElementById('category-tabs');

  /* ── boot: フォルダ未設定なら picker、設定済なら refreshCategories ── */
  import('./tauri.js').then(async (T) => {
    await setupMenuListeners(T);
    const parent = await T.invoke('get_parent_dir');
    if (parent) {
      await refreshCategories(T);
    } else {
      showPicker(T);
    }
  });

  async function refreshCategories(T) {
    const cats = await T.invoke('list_categories');
    const active = await T.invoke('get_current_category');
    renderCategoryTabs(T, cats, active);
    if (cats.length === 0) {
      grid.innerHTML = '<div class="empty">サブフォルダ（カテゴリ）を作成してください</div>';
      grid.hidden = false;
      picker.hidden = true;
      return;
    }
    if (active) {
      await loadAll(T);
    } else {
      // 防御: 一覧があるのに active が無いケース
      await chooseCategory(T, cats[0]);
    }
  }

  function renderCategoryTabs(T, cats, active) {
    categoryTabs.innerHTML = '';
    if (cats.length === 0) {
      categoryTabs.hidden = true;
      return;
    }
    categoryTabs.hidden = false;
    cats.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cat-tab';
      if (cat === active) btn.classList.add('active');
      btn.dataset.cat = cat;
      btn.textContent = cat;
      btn.addEventListener('click', () => chooseCategory(T, cat));
      categoryTabs.appendChild(btn);
    });
  }

  async function chooseCategory(T, category) {
    try {
      await T.invoke('set_current_category', { category });
      categoryTabs.querySelectorAll('.cat-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === category);
      });
      await loadAll(T);
    } catch (err) {
      console.warn(`[album] カテゴリ切替失敗: ${err}`);
    }
  }

  async function loadAll(T) {
    try {
      const [photos, species] = await Promise.all([
        T.invoke('read_photos_json'),
        T.invoke('read_species_json'),
      ]);
      allPhotos  = photos || [];
      speciesMap = species || {};
      picker.hidden = true;
      grid.hidden = false;
      init();
    } catch (err) {
      grid.innerHTML = `<div class="loading">error: ${err.message}</div>`;
    }
  }

  async function rescan(T) {
    try {
      const photos = await T.invoke('rescan');
      allPhotos = photos || [];
      applyFilter(activeTag);
    } catch (err) {
      console.warn(`[album] rescan 失敗: ${err}`);
    }
  }

  let pickerWired = false;
  let pickerInFlight = false;

  function showPicker(T) {
    picker.hidden = false;
    grid.hidden = true;

    if (pickerWired) return;
    pickerWired = true;

    pickerBtn.addEventListener('click', async () => {
      if (pickerInFlight) return;
      const path = await T.pickFolder();
      if (path) await chooseFolder(T, path);
    });

    // 視覚フィードバックは HTML5 で、実パスは tauri://drag-drop イベントから
    picker.addEventListener('dragover', (e) => {
      e.preventDefault();
      picker.classList.add('dragover');
    });
    picker.addEventListener('dragleave', () => {
      picker.classList.remove('dragover');
    });

    T.listen('tauri://drag-drop', async (event) => {
      picker.classList.remove('dragover');
      if (pickerInFlight) return;
      const paths = event.payload?.paths || [];
      const path = paths[0];
      if (path) await chooseFolder(T, path);
    });
  }

  async function chooseFolder(T, path) {
    if (pickerInFlight) return;
    pickerInFlight = true;
    pickerBtn.disabled = true;
    try {
      await T.invoke('set_parent_dir', { path });
      await refreshCategories(T);
    } catch (err) {
      alert(`フォルダ設定エラー: ${err}`);
    } finally {
      pickerInFlight = false;
      pickerBtn.disabled = false;
    }
  }

  async function setupMenuListeners(T) {
    await T.listen('menu:open_folder', async () => {
      const path = await T.pickFolder();
      if (path) await chooseFolder(T, path);
    });
    await T.listen('menu:rescan', async () => {
      await rescan(T);
    });
    await T.listen('photos-updated', async () => {
      const photos = await T.invoke('read_photos_json');
      allPhotos = photos || [];
      applyFilter(activeTag);
    });
  }

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
      const cardTitle = photo.title || speciesMap[photo.species]?.name_ja || photo.file;
      const metaParts = [...(photo.tags || []), photo.date].filter(Boolean);

      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', cardTitle);

      const img = document.createElement('img');
      img.className = 'loading';
      img.alt = cardTitle;
      img.loading = 'lazy';
      photoUrl(photo.file).then(url => { img.src = url; });
      img.addEventListener('load',  () => img.classList.replace('loading', 'loaded'));
      img.addEventListener('error', () => img.classList.replace('loading', 'loaded'));

      const info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML = `
        <div class="card-title">${esc(cardTitle)}</div>
        <div class="card-meta">${esc(metaParts.join(' · '))}</div>
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
    const wasAlreadyOpen = lb.classList.contains('open');
    current = i;
    const p = visible[i];

    photoUrl(p.file).then(url => { lbImg.src = url; });
    lbImg.alt = p.title || speciesMap[p.species]?.name_ja || p.file;

    if (p.title) {
      lbTitle.textContent = p.title;
      lbTitle.hidden = false;
    } else {
      lbTitle.hidden = true;
    }

    const tagList = p.tags || [];
    if (tagList.length > 0) {
      lbTags.innerHTML = tagList
        .map(t => `<span class="lb-tag">${esc(t)}</span>`)
        .join('');
      lbTags.hidden = false;
    } else {
      lbTags.hidden = true;
    }

    const lines = [];
    if (p.camera) lines.push(p.camera);
    if (p.lens)   lines.push(p.lens);
    if (p.exif)   lines.push(p.exif);
    if (p.date)   lines.push(p.date);
    lbExif.textContent = lines.join('\n');

    renderSpecies(p.species);

    updateCounter();
    lb.classList.add('open');
    // 初回オープン時のみ close へフォーカス。prev/next ナビ中はフォーカスを奪わない
    if (!wasAlreadyOpen) lbClose.focus();
  }

  /* ── species (encyclopedia) block ── */
  function renderSpecies(speciesId) {
    if (!speciesId) {
      lbSpecies.hidden = true;
      return;
    }
    const sp = speciesMap[speciesId];
    if (!sp) {
      console.warn(`[gallery] species "${speciesId}" は species.json に未定義です。`);
      lbSpecies.hidden = true;
      return;
    }

    lbSpNameJa.textContent = sp.name_ja || '';
    lbSpNameEn.textContent = sp.name_en || '';

    const metaParts = [];
    if (sp.habitat) metaParts.push(sp.habitat);
    if (sp.size)    metaParts.push(sp.size);
    lbSpMeta.textContent = metaParts.join(' · ');
    lbSpMeta.hidden = metaParts.length === 0;

    lbSpFeatures.innerHTML = '';
    if (Array.isArray(sp.features) && sp.features.length > 0) {
      sp.features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        lbSpFeatures.appendChild(li);
      });
      lbSpFeatures.hidden = false;
    } else {
      lbSpFeatures.hidden = true;
    }

    lbSpDescription.textContent = sp.description || '';
    lbSpDescription.hidden = !sp.description;

    lbSpecies.hidden = false;
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
