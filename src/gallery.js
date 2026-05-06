/* gallery.js — mokomoko album */

(function () {
  'use strict';

  /* ── state ── */
  let allPhotos  = [];
  let speciesMap = {};
  let visible    = [];
  let current    = 0;
  let activeTag  = 'all';
  // 編集パネルを開いたときの元の species エントリ。保存時に spread して
  // フォームに無いフィールド（model 等）を保持する。
  let editingOriginalEntry = {};

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
  const lbEdit       = document.getElementById('lb-edit');
  const lbEditPanel  = document.getElementById('lb-edit-panel');
  const lbEditForm   = document.getElementById('lb-edit-form');
  const lbEditCancel = document.getElementById('lb-edit-cancel');
  const lbEditClose  = document.getElementById('lb-edit-close');
  const lbEditSave   = document.getElementById('lb-edit-save');
  const lbEditStatus = document.getElementById('lb-edit-status');

  /* ── grid のクリック / キー操作は delegation で受ける（カード再生成時にリスナ重複しないように） ── */
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !grid.contains(card)) return;
    const idx = Number(card.dataset.index);
    if (Number.isFinite(idx)) openLB(idx);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    const idx = Number(card.dataset.index);
    if (Number.isFinite(idx)) openLB(idx);
  });

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
      // カテゴリ / フォルダ切替時はファイル名衝突によるカード誤再利用を避けるため明示クリア
      grid.replaceChildren();
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
      // 自分で species.json を書き換えたときも watcher が発火する。
      // photos と species 両方を再読込して状態を同期させる。
      const [photos, species] = await Promise.all([
        T.invoke('read_photos_json'),
        T.invoke('read_species_json'),
      ]);
      allPhotos = photos || [];
      speciesMap = species || {};
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

  /* ── grid render ──
     ファイル名をキーにした差分更新。既存カードはそのまま再利用するので、
     watcher 起因の rescan で全カードがフェードし直す（チカチカ）のを防ぐ */
  function renderGrid() {
    if (visible.length === 0) {
      grid.replaceChildren();
      grid.innerHTML = '<div class="empty">no photos found</div>';
      return;
    }

    const existing = new Map();
    for (const node of grid.children) {
      if (node.dataset && node.dataset.file) {
        existing.set(node.dataset.file, node);
      }
    }

    const next = visible.map((photo, i) => {
      const reused = existing.get(photo.file);
      if (reused) {
        reused.dataset.index = String(i);
        updateCardInfo(reused, photo);
        return reused;
      }
      return createCard(photo, i);
    });

    grid.replaceChildren(...next);
  }

  function createCard(photo, i) {
    const cardTitle = photo.title || speciesMap[photo.species]?.name_ja || photo.file;
    const metaParts = [...(photo.tags || []), photo.date].filter(Boolean);

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.file = photo.file;
    card.dataset.index = String(i);
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
    return card;
  }

  function updateCardInfo(card, photo) {
    const cardTitle = photo.title || speciesMap[photo.species]?.name_ja || photo.file;
    const metaText = [...(photo.tags || []), photo.date].filter(Boolean).join(' · ');
    card.setAttribute('aria-label', cardTitle);
    const titleEl = card.querySelector('.card-title');
    const metaEl = card.querySelector('.card-meta');
    if (titleEl) titleEl.textContent = cardTitle;
    if (metaEl) metaEl.textContent = metaText;
    const img = card.querySelector('img');
    if (img) img.alt = cardTitle;
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
    if (sp.author)  metaParts.push(sp.author);
    if (sp.year)    metaParts.push(sp.year);
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
    if (!lbEditPanel.hidden) return; // 編集中はナビ無効。意図せぬ離脱で入力を失わないため
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
    // 編集パネル開閉中は外側クリックで閉じない（誤って入力中の値を捨てない）
    if (e.target === lb && lbEditPanel.hidden) closeLB();
  });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') {
      if (!lbEditPanel.hidden) closeEditPanel();
      else closeLB();
      return;
    }
    if (!lbEditPanel.hidden) return; // 編集中は ← → を無効化
    if (e.key === 'ArrowLeft')  navigate(-1);
    if (e.key === 'ArrowRight') navigate(+1);
  });

  /* ── edit panel ── */
  lbEdit.addEventListener('click', openEditPanel);
  lbEditCancel.addEventListener('click', closeEditPanel);
  lbEditClose.addEventListener('click', closeEditPanel);
  lbEditForm.addEventListener('submit', onEditSubmit);

  function openEditPanel() {
    const p = visible[current];
    if (!p) return;
    const speciesId = p.species || slugifyFilename(p.file);
    const sp = (p.species && speciesMap[p.species]) || {};
    editingOriginalEntry = sp;

    const f = lbEditForm.elements;
    f.species_id.value = speciesId;
    f.name_ja.value    = sp.name_ja || '';
    f.name_en.value    = sp.name_en || '';
    f.author.value     = sp.author  || '';
    f.year.value       = sp.year    || '';
    f.habitat.value    = sp.habitat || '';
    f.size.value       = sp.size    || '';
    f.features.value   = (sp.features || []).join('\n');
    f.description.value = sp.description || '';

    setEditStatus('', null);
    lbEditPanel.hidden = false;
    f.name_ja.focus();
  }

  function closeEditPanel() {
    lbEditPanel.hidden = true;
    setEditStatus('', null);
  }

  async function onEditSubmit(e) {
    e.preventDefault();
    const f = lbEditForm.elements;
    const speciesId = f.species_id.value.trim();
    if (!speciesId) {
      setEditStatus('species ID を入力してください', false);
      f.species_id.focus();
      return;
    }

    // 元エントリを spread して、フォームに無いフィールド（model 等）を保持
    const entry = { ...editingOriginalEntry };
    setOrDelete(entry, 'name_ja', f.name_ja.value.trim());
    setOrDelete(entry, 'name_en', f.name_en.value.trim());
    setOrDelete(entry, 'author',  f.author.value.trim());
    setOrDelete(entry, 'year',    f.year.value.trim());
    setOrDelete(entry, 'habitat', f.habitat.value.trim());
    setOrDelete(entry, 'size',    f.size.value.trim());

    const features = f.features.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (features.length > 0) entry.features = features;
    else delete entry.features;

    setOrDelete(entry, 'description', f.description.value.trim());

    const newSpeciesMap = { ...speciesMap, [speciesId]: entry };
    const p = visible[current];

    lbEditSave.disabled = true;
    setEditStatus('saving...', null);
    try {
      const T = await tauri();
      await T.invoke('write_species_json', { value: newSpeciesMap });
      // 写真側のリンクが変わる場合のみ書き戻す（同一 ID の説明文だけ編集なら photos.json は触らない）
      if (p.species !== speciesId) {
        await T.invoke('update_photo_species', { file: p.file, species: speciesId });
      }

      // 楽観的にローカル state も更新（watcher が直後に同じ内容で発火する）
      speciesMap = newSpeciesMap;
      const orig = allPhotos.find(x => x.file === p.file);
      if (orig) orig.species = speciesId;
      p.species = speciesId;

      renderSpecies(speciesId);
      renderGrid();
      setEditStatus('saved', true);
      setTimeout(closeEditPanel, 600);
    } catch (err) {
      setEditStatus(`保存失敗: ${err}`, false);
    } finally {
      lbEditSave.disabled = false;
    }
  }

  function setOrDelete(obj, key, value) {
    if (value) obj[key] = value;
    else delete obj[key];
  }

  function setEditStatus(msg, ok) {
    lbEditStatus.textContent = msg;
    lbEditStatus.classList.toggle('ok', ok === true);
  }

  function slugifyFilename(file) {
    return file
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /* ── util ── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
