// visits.js — 訪問記録ビュー。gallery.js とは body[data-mode] と CustomEvent だけで連携する。
import { invoke, listen } from './tauri.js';
import { groupByYear, kindsOf, linkPhotos } from './visits-logic.js';

const view = document.getElementById('visits-view');
const modeButtons = document.querySelectorAll('#mode-toggle .mode-btn');

const state = {
  visits: [],
  wishlist: [],
  photos: [],
  kind: 'all',   // 種類フィルタ
  parent: null,  // parent_dir（未設定なら null）
};

/* ── DOM ヘルパ（文字列は必ず textContent で入れる） ── */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ── モード切替 ── */
function setMode(mode) {
  document.body.dataset.mode = mode;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  view.hidden = mode !== 'visits';
  if (mode === 'visits') reload();
}

modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.body.dataset.mode = 'gallery';

/* ── 写真を gallery で開く（別カテゴリなら gallery.js 側でカテゴリを切り替える） ── */
function openPhoto(category, file) {
  setMode('gallery');
  window.dispatchEvent(new CustomEvent('cabinet:open-photo', { detail: { category, file } }));
}

/* ── データ読み込み ── */
async function reload() {
  state.parent = await invoke('get_parent_dir');
  if (!state.parent) {
    state.visits = []; state.wishlist = []; state.photos = [];
    render();
    return;
  }
  const [data, photos] = await Promise.all([
    invoke('read_visits_json'),
    invoke('read_all_photos'),
  ]);
  state.visits = data?.visits || [];
  state.wishlist = data?.wishlist || [];
  state.photos = photos || [];
  render();
}

// 自分や外部が写真・JSON を書き換えたときも visits モード中は追従する
listen('photos-updated', () => {
  if (document.body.dataset.mode === 'visits') reload();
});

/* ── 描画 ── */
function summaryText(s) {
  const kinds = Object.entries(s.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' / ');
  const places = `${s.uniquePlaces} か所` + (s.repeats > 0 ? `（リピート ${s.repeats}）` : '');
  return `${s.count} visits · ${kinds} · ${places}`;
}

function renderFilters() {
  const bar = el('div', 'visits-filters');
  bar.appendChild(el('span', 'filter-label', 'filter'));
  for (const kind of ['all', ...kindsOf(state.visits)]) {
    const btn = el('button', 'tag', kind);
    btn.type = 'button';
    if (kind === state.kind) btn.classList.add('active');
    btn.addEventListener('click', () => { state.kind = kind; render(); });
    bar.appendChild(btn);
  }
  return bar;
}

function renderRow(visit, photoCount) {
  const row = el('div', 'visit-row');
  row.appendChild(el('span', 'visit-date', visit.date.slice(5).replace('-', '/')));
  const main = el('span', 'visit-place', visit.place);
  if (visit.event) main.appendChild(el('span', 'visit-event', ` · ${visit.event}`));
  if (visit.note) main.appendChild(el('span', 'visit-note-mark', '•'));
  row.appendChild(main);
  row.appendChild(el('span', 'visit-kind', visit.kind));
  row.appendChild(el('span', 'visit-count', photoCount > 0 ? `${photoCount}枚` : ''));
  return row;
}

function render() {
  view.replaceChildren();

  if (!state.parent) {
    view.appendChild(el('div', 'visits-message', 'フォルダを先に選択してください'));
    return;
  }
  if (state.visits.length === 0) {
    view.appendChild(el('div', 'visits-message', 'まだ訪問記録がありません'));
    return;
  }

  view.appendChild(renderFilters());

  const { byVisit } = linkPhotos(state.photos, state.visits);
  const groups = groupByYear(state.visits, state.kind);
  if (groups.length === 0) {
    view.appendChild(el('div', 'visits-message', 'この種類の訪問はありません'));
    return;
  }
  for (const g of groups) {
    const section = el('div', 'visits-year');
    const head = el('div', 'visits-year-head');
    head.appendChild(el('span', 'visits-year-title', g.year));
    head.appendChild(el('span', 'visits-year-summary', summaryText(g.summary)));
    section.appendChild(head);
    for (const v of g.visits) {
      section.appendChild(renderRow(v, (byVisit.get(v.id) || []).length));
    }
    view.appendChild(section);
  }
}
