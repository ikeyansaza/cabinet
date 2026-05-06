/* gallery.js — mokomoko album */

(function () {
  'use strict';

  /* ── state ── */
  let allPhotos       = [];
  let speciesMap      = {};
  let artistsMap      = {};         // arts カテゴリのみで使う作家マスタ
  let currentCategory = null;       // 'animals' | 'arts' | その他カテゴリ名
  let visible         = [];
  let current         = 0;
  let activeTag       = 'all';
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

  async function modelUrl(relPath) {
    const T = await tauri();
    const dir = await T.invoke('get_active_dir');
    if (!dir) return relPath;
    const abs = `${dir}/${relPath}`.replace(/\\/g, '/');
    return T.convertFileSrc(abs);
  }

  /* ── elements ── */
  const grid      = document.getElementById('grid');
  const filters   = document.getElementById('filters');
  const countEl   = document.getElementById('count');
  const headerMeta = document.getElementById('header-meta');
  const lb        = document.getElementById('lb');
  const lbImg     = document.getElementById('lb-img');
  const lbImgWrap = document.getElementById('lb-img-wrap');
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
  const lb3d            = document.getElementById('lb-3d');
  const lb3dToggle      = document.getElementById('lb-3d-toggle');
  const lb3dViewer      = document.getElementById('lb-3d-viewer');
  const picker        = document.getElementById('picker');
  const pickerBtn     = document.getElementById('picker-btn');
  const categoryTabs   = document.getElementById('category-tabs');
  const lbEdit       = document.getElementById('lb-edit');
  const lbEditPanel  = document.getElementById('lb-edit-panel');
  const lbEditForm   = document.getElementById('lb-edit-form');
  const lbEditTitle  = document.getElementById('lb-edit-title');
  const lbEditCancel = document.getElementById('lb-edit-cancel');
  const lbEditClose  = document.getElementById('lb-edit-close');
  const lbEditSave   = document.getElementById('lb-edit-save');
  const lbEditStatus = document.getElementById('lb-edit-status');

  /* ── artist (arts カテゴリのみ) ──
     UI からの編集は species 側に統合（species 編集パネルから artist ID を切替できる）。
     作家マスタの bio 等を直接編集したい場合は artists.json を手で編集する。 */
  const artistBlocks = [
    {
      root: document.getElementById('lb-artist'),
      name: document.getElementById('lb-artist-name'),
      nameEn: document.getElementById('lb-artist-name-en'),
      meta: document.getElementById('lb-artist-meta'),
      features: document.getElementById('lb-artist-features'),
      bio: document.getElementById('lb-artist-bio'),
    },
    {
      root: document.getElementById('lb-artist-co'),
      name: document.getElementById('lb-artist-co-name'),
      nameEn: document.getElementById('lb-artist-co-name-en'),
      meta: document.getElementById('lb-artist-co-meta'),
      features: document.getElementById('lb-artist-co-features'),
      bio: document.getElementById('lb-artist-co-bio'),
    },
  ];

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
      currentCategory = category;
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
      const [photos, species, artists, category] = await Promise.all([
        T.invoke('read_photos_json'),
        T.invoke('read_species_json'),
        T.invoke('read_artists_json'),
        T.invoke('get_current_category'),
      ]);
      allPhotos       = photos || [];
      speciesMap      = species || {};
      artistsMap      = artists || {};
      currentCategory = category || null;
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
      // 自分で species.json / artists.json を書き換えたときも watcher が発火する。
      // 全部まとめて再読込して状態を同期させる。
      const [photos, species, artists] = await Promise.all([
        T.invoke('read_photos_json'),
        T.invoke('read_species_json'),
        T.invoke('read_artists_json'),
      ]);
      allPhotos = photos || [];
      speciesMap = species || {};
      artistsMap = artists || {};
      applyFilter(activeTag);
      // ライトボックスが開いていれば作家情報の更新も反映
      if (lb.classList.contains('open')) {
        const p = visible[current];
        if (p) renderSpecies(p.species);
      }
    });
  }

  /* ── init ── */
  function init() {
    buildTagButtons();
    applyFilter('all');

    const total = allPhotos.length;
    const catLabel = currentCategory || '—';
    headerMeta.textContent = `${total} photos · ${catLabel}`;
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

  function getCardTitle(photo) {
    if (photo.title) return photo.title;
    const sp = speciesMap[photo.species];
    if (!sp) return photo.file;
    if (currentCategory === 'arts') {
      return sp.title || artistsMap[sp.artist]?.name || photo.file;
    }
    return sp.name_ja || photo.file;
  }

  function createCard(photo, i) {
    const cardTitle = getCardTitle(photo);
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
    const cardTitle = getCardTitle(photo);
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

    // 写真を切り替えるたびにズーム状態は破棄する（前の写真の倍率が残ると混乱するため）
    resetZoom();

    photoUrl(p.file).then(url => { lbImg.src = url; });
    lbImg.alt = getCardTitle(p);

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
    // species 切替時は 3D ビューアの状態を毎回リセットする
    // （別個体に遷移したのに前のモデルが展開されたままだと混乱するため）
    reset3d();
    artistBlocks.forEach(b => { b.root.hidden = true; });

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

    if (currentCategory === 'arts') {
      renderArtwork(sp);
    } else {
      renderAnimal(sp);
    }
  }

  // animals（および未指定カテゴリ）向け。従来挙動と同じ。
  function renderAnimal(sp) {
    lbSpNameJa.textContent = sp.name_ja || '';
    lbSpNameEn.textContent = sp.name_en || '';

    const metaParts = [];
    if (sp.habitat) metaParts.push(sp.habitat);
    if (sp.size)    metaParts.push(sp.size);
    lbSpMeta.textContent = metaParts.join(' · ');
    lbSpMeta.hidden = metaParts.length === 0;

    renderFeaturesInto(lbSpFeatures, sp.features);

    lbSpDescription.textContent = sp.description || '';
    lbSpDescription.hidden = !sp.description;

    setupModelToggle(sp.model);
    lbSpecies.hidden = false;
  }

  // arts 向け。作品エントリ + 参照する作家エントリを併記する。
  // animals 側と違って features は出さない（メタ情報過多で description と冗長になるため）。
  function renderArtwork(sp) {
    // 作品: title を name_ja スロット、name_en は表示しない（多言語タイトルは将来必要なら拡張）
    lbSpNameJa.textContent = sp.title || '';
    lbSpNameEn.textContent = '';

    const primaryArtist  = sp.artist    ? artistsMap[sp.artist]    : null;
    const coArtist       = sp.co_artist ? artistsMap[sp.co_artist] : null;

    const metaParts = [];
    const primaryLabel = primaryArtist?.name || sp.artist;
    const coLabel      = coArtist?.name      || sp.co_artist;
    if (primaryLabel && coLabel) metaParts.push(`${primaryLabel} × ${coLabel}`);
    else if (primaryLabel)       metaParts.push(primaryLabel);
    if (sp.year)   metaParts.push(sp.year);
    if (sp.medium) metaParts.push(sp.medium);
    lbSpMeta.textContent = metaParts.join(' · ');
    lbSpMeta.hidden = metaParts.length === 0;

    // arts では features は表示しない
    lbSpFeatures.innerHTML = '';
    lbSpFeatures.hidden = true;

    lbSpDescription.textContent = sp.description || '';
    lbSpDescription.hidden = !sp.description;

    // arts では 3D は未対応。固定で隠す。
    lb3d.hidden = true;
    lbSpecies.hidden = false;

    // 作家ブロック（主作家／共作）
    renderArtistInto(artistBlocks[0], sp.artist,    primaryArtist);
    renderArtistInto(artistBlocks[1], sp.co_artist, coArtist);
  }

  function renderArtistInto(block, artistId, artist) {
    if (!artistId) {
      block.root.hidden = true;
      return;
    }
    // 作家ブロックでは features は表示しない（bio に集約）
    block.features.innerHTML = '';
    block.features.hidden = true;

    if (!artist) {
      block.name.textContent = artistId;
      block.nameEn.textContent = '';
      block.nameEn.hidden = true;
      block.meta.textContent = '';
      block.meta.hidden = true;
      block.bio.textContent = '';
      block.bio.hidden = true;
      block.root.hidden = false;
      return;
    }
    block.name.textContent = artist.name || artistId;
    block.nameEn.textContent = artist.name_en || '';
    block.nameEn.hidden = !artist.name_en;

    const metaParts = [];
    if (artist.born && artist.died) metaParts.push(`${artist.born}–${artist.died}`);
    else if (artist.born) metaParts.push(`${artist.born}–`);
    else if (artist.died) metaParts.push(`–${artist.died}`);
    block.meta.textContent = metaParts.join(' · ');
    block.meta.hidden = metaParts.length === 0;

    block.bio.textContent = artist.bio || '';
    block.bio.hidden = !artist.bio;

    block.root.hidden = false;
  }

  function renderFeaturesInto(ul, features) {
    ul.innerHTML = '';
    if (Array.isArray(features) && features.length > 0) {
      features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      });
      ul.hidden = false;
    } else {
      ul.hidden = true;
    }
  }

  /* ── 3D model viewer ── */
  let current3dModel = null;

  function setupModelToggle(modelPath) {
    if (!modelPath) {
      lb3d.hidden = true;
      current3dModel = null;
      return;
    }
    current3dModel = modelPath;
    lb3dToggle.textContent = '[ view in 3D ]';
    lb3dToggle.disabled = false;
    lb3d.hidden = false;
  }

  function reset3d() {
    // <model-viewer> は GPU リソースを掴むので DOM から確実に外す
    lb3dViewer.replaceChildren();
    lb3dViewer.hidden = true;
    lb3dToggle.textContent = '[ view in 3D ]';
  }

  async function expand3d() {
    if (!current3dModel) return;
    const url = await modelUrl(current3dModel);

    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', url);
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('auto-rotate-delay', '3000');
    mv.setAttribute('interaction-prompt', 'none');
    mv.setAttribute('shadow-intensity', '0');
    mv.setAttribute('exposure', '1.0');
    mv.addEventListener('error', () => {
      lb3dViewer.replaceChildren();
      const err = document.createElement('div');
      err.className = 'lb-3d-error';
      err.textContent = '[ 3D model unavailable ]';
      lb3dViewer.appendChild(err);
    });

    lb3dViewer.replaceChildren(mv);
    lb3dViewer.hidden = false;
    lb3dToggle.textContent = '[ hide 3D ]';
  }

  function collapse3d() {
    lb3dViewer.replaceChildren();
    lb3dViewer.hidden = true;
    lb3dToggle.textContent = '[ view in 3D ]';
  }

  lb3dToggle.addEventListener('click', () => {
    if (lb3dViewer.hidden) {
      expand3d();
    } else {
      collapse3d();
    }
  });

  function closeLB() {
    lb.classList.remove('open');
    lbImg.src = '';
    reset3d();
    resetZoom();
  }

  /* ── zoom & pan ──
     ホイール/ピンチでズーム（ピンチは Mac では wheel + ctrlKey として届く）。
     ダブルクリックで 1x ↔ ZOOM_DBLCLICK を切替。ズーム中はドラッグでパン。
     openLB / closeLB のたびにリセットする。 */
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const ZOOM_DBLCLICK = 2;
  let zoomScale = 1;
  let zoomTx = 0;
  let zoomTy = 0;
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginTx = 0;
  let panOriginTy = 0;

  function applyZoomTransform() {
    lbImg.style.transform = `translate(${zoomTx}px, ${zoomTy}px) scale(${zoomScale})`;
    lbImgWrap.classList.toggle('zoomed', zoomScale > 1);
  }

  function resetZoom() {
    zoomScale = 1;
    zoomTx = 0;
    zoomTy = 0;
    panning = false;
    lbImgWrap.classList.remove('panning');
    applyZoomTransform();
  }

  // clientX/Y を image 中心からのオフセットに変換し、その点を固定したままスケールを変える。
  // ホイール zoom で「カーソル下の点が動かない」挙動になる。
  function zoomAtClientPoint(clientX, clientY, factor) {
    const rect = lbImg.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top  - rect.height / 2;
    const oldScale = zoomScale;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldScale * factor));
    if (newScale === oldScale) return;
    zoomTx = cx - (cx - zoomTx) * (newScale / oldScale);
    zoomTy = cy - (cy - zoomTy) * (newScale / oldScale);
    zoomScale = newScale;
    if (zoomScale <= ZOOM_MIN + 0.001) {
      zoomScale = 1;
      zoomTx = 0;
      zoomTy = 0;
    }
    applyZoomTransform();
  }

  function zoomAtCenter(factor) {
    const rect = lbImgWrap.getBoundingClientRect();
    zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  lbImgWrap.addEventListener('wheel', (e) => {
    // 編集パネルが開いてるときに誤操作で背景がズームしないように
    if (!lbEditPanel.hidden) return;
    e.preventDefault();
    // Mac トラックパッドはホイールイベントを高頻度で吐くので係数は控えめに。
    // ピンチ（wheel + ctrlKey）も同じ扱い。
    const factor = e.deltaY < 0 ? 1.03 : 1 / 1.03;
    zoomAtClientPoint(e.clientX, e.clientY, factor);
  }, { passive: false });

  lbImgWrap.addEventListener('dblclick', (e) => {
    if (!lbEditPanel.hidden) return;
    e.preventDefault();
    if (zoomScale > 1) {
      resetZoom();
    } else {
      // 1x のとき: クリックした点を中心に ZOOM_DBLCLICK までズーム
      zoomAtClientPoint(e.clientX, e.clientY, ZOOM_DBLCLICK);
    }
  });

  // mousedown のデフォルト動作（text selection / focus シフト）を抑止する。
  // dblclick で近隣要素にフォーカスが飛んだり、ハイライトが走るのを防ぐ。
  // pointerdown とは別イベントなので、パン用の pointerdown ハンドラには影響しない。
  lbImgWrap.addEventListener('mousedown', (e) => e.preventDefault());

  lbImgWrap.addEventListener('pointerdown', (e) => {
    if (zoomScale <= 1) return;       // 1x のときはパンしない
    if (e.button !== 0) return;       // 左ボタンのみ
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginTx = zoomTx;
    panOriginTy = zoomTy;
    lbImgWrap.classList.add('panning');
    try { lbImgWrap.setPointerCapture(e.pointerId); } catch { /* iOS Safari 等で失敗しても致命的ではない */ }
    e.preventDefault();
  });

  lbImgWrap.addEventListener('pointermove', (e) => {
    if (!panning) return;
    zoomTx = panOriginTx + (e.clientX - panStartX);
    zoomTy = panOriginTy + (e.clientY - panStartY);
    applyZoomTransform();
  });

  function endPan() {
    if (!panning) return;
    panning = false;
    lbImgWrap.classList.remove('panning');
  }
  lbImgWrap.addEventListener('pointerup', endPan);
  lbImgWrap.addEventListener('pointercancel', endPan);
  lbImgWrap.addEventListener('pointerleave', endPan);

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
  lbClose.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      closeLB();
    }
  });
  lbPrev.addEventListener('click',  () => navigate(-1));
  lbNext.addEventListener('click',  () => navigate(+1));

  lb.addEventListener('click', e => {
    // 編集パネル開閉中は外側クリックで閉じない（誤って入力中の値を捨てない）
    if (e.target === lb && lbEditPanel.hidden) closeLB();
  });

  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') {
      // ESC は内側の状態から順にひとつずつ解除する:
      //   1. 編集パネル開いていれば閉じる
      //   2. ズームしていれば 1x に戻す
      //   3. それ以外でライトボックスを閉じる
      if (!lbEditPanel.hidden) closeEditPanel();
      else if (zoomScale > 1) resetZoom();
      else closeLB();
      return;
    }
    if (!lbEditPanel.hidden) return; // 編集中は ← → / ズームキーを無効化
    if (e.key === 'ArrowLeft')  navigate(-1);
    if (e.key === 'ArrowRight') navigate(+1);
    // ズーム: + / = で拡大, - で縮小, 0 でリセット
    if (e.key === '+' || e.key === '=') { zoomAtCenter(1.2); e.preventDefault(); }
    if (e.key === '-') { zoomAtCenter(1 / 1.2); e.preventDefault(); }
    if (e.key === '0') { resetZoom(); e.preventDefault(); }
  });

  /* ── edit panel ── */
  lbEdit.addEventListener('click', openEditPanel);
  lbEditCancel.addEventListener('click', closeEditPanel);
  lbEditClose.addEventListener('click', closeEditPanel);
  lbEditForm.addEventListener('submit', onEditSubmit);

  // 現在のカテゴリに応じて表示するモードを返す（既知カテゴリ以外は animals 扱い）
  function editMode() {
    return currentCategory === 'arts' ? 'arts' : 'animals';
  }

  function applyEditFormMode(mode) {
    lbEditPanel.dataset.mode = mode;
    lbEditTitle.textContent = mode === 'arts' ? 'edit artwork' : 'edit species';
    lbEditPanel.querySelectorAll('label[data-mode]').forEach(label => {
      label.hidden = label.dataset.mode !== mode;
    });
  }

  function openEditPanel() {
    const p = visible[current];
    if (!p) return;
    const mode = editMode();
    const speciesId = p.species || slugifyFilename(p.file);
    const sp = (p.species && speciesMap[p.species]) || {};
    editingOriginalEntry = sp;

    applyEditFormMode(mode);

    const f = lbEditForm.elements;
    f.species_id.value = speciesId;

    if (mode === 'arts') {
      f.title.value     = sp.title     || '';
      f.artist.value    = sp.artist    || '';
      f.co_artist.value = sp.co_artist || '';
      f.year.value      = sp.year      || '';
      f.medium.value    = sp.medium    || '';
      f.features.value  = '';
    } else {
      f.name_ja.value  = sp.name_ja || '';
      f.name_en.value  = sp.name_en || '';
      f.habitat.value  = sp.habitat || '';
      f.size.value     = sp.size    || '';
      f.features.value = (sp.features || []).join('\n');
    }
    f.description.value = sp.description || '';

    setEditStatus('', null);
    lbEditPanel.hidden = false;
    if (mode === 'arts') f.title.focus();
    else f.name_ja.focus();
  }

  function closeEditPanel() {
    lbEditPanel.hidden = true;
    setEditStatus('', null);
  }

  async function onEditSubmit(e) {
    e.preventDefault();
    const f = lbEditForm.elements;
    const mode = lbEditPanel.dataset.mode || editMode();
    const speciesId = f.species_id.value.trim();
    if (!speciesId) {
      setEditStatus('species ID を入力してください', false);
      f.species_id.focus();
      return;
    }

    // 元エントリを spread して、フォームに無いフィールド（model 等）を保持
    const entry = { ...editingOriginalEntry };

    if (mode === 'arts') {
      setOrDelete(entry, 'title',     f.title.value.trim());
      setOrDelete(entry, 'artist',    f.artist.value.trim());
      setOrDelete(entry, 'co_artist', f.co_artist.value.trim());
      setOrDelete(entry, 'year',      f.year.value.trim());
      setOrDelete(entry, 'medium',    f.medium.value.trim());
      // arts では features は使わない & animals 用フィールドが残っていたら掃除
      ['features', 'name_ja', 'name_en', 'habitat', 'size'].forEach(k => delete entry[k]);
    } else {
      setOrDelete(entry, 'name_ja', f.name_ja.value.trim());
      setOrDelete(entry, 'name_en', f.name_en.value.trim());
      setOrDelete(entry, 'habitat', f.habitat.value.trim());
      setOrDelete(entry, 'size',    f.size.value.trim());
      // animals では arts 用のフィールドが残っていたら掃除する
      ['title', 'artist', 'co_artist', 'year', 'medium'].forEach(k => delete entry[k]);

      const features = f.features.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      if (features.length > 0) entry.features = features;
      else delete entry.features;
    }

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
