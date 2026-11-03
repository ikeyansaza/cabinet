// visits.js — 訪問記録ビュー。gallery.js とは body[data-mode] と CustomEvent だけで連携する。
import { invoke, listen, convertFileSrc } from './tauri.js';
import {
  groupByYear, kindsOf, linkPhotos, visitsOnDate, isValidDate, makeVisitId, makeWishId,
  isValidVisit, isValidWish, partition,
} from './visits-logic.js';

const view = document.getElementById('visits-view');
const modeButtons = document.querySelectorAll('#mode-toggle .mode-btn');

const state = {
  visits: [],
  wishlist: [],
  photos: [],
  kind: 'all',   // 種類フィルタ
  parent: null,  // parent_dir（未設定なら null）
  openId: null,      // 詳細を展開中の訪問 ID
  editingId: null,   // 編集フォームを開いている訪問 ID
  armedDeleteId: null, // delete を 1 回押した訪問 ID（2 回目で実行）
  editingWishNoteId: null, // メモを編集中の行きたい場所 ID
  form: null,        // 上部の追加フォーム { initial, submitLabel, onSubmit(values) }。null なら閉じている
  error: '',         // 直近の保存失敗メッセージ
  readFailed: false, // visits.json が壊れていて読めない（この間は編集させない）
  skippedVisits: [], // id / date 等が欠けた手編集の訪問。表示せず、保存時にそのまま書き戻す
  skippedWishes: [],
  snapshot: '',      // 最後に読んだ visits.json の内容（外部で書き換えられたかの検出用）
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
  view.hidden = mode === 'gallery';
  if (mode !== 'gallery') {
    // 追加フォームや削除確認は、モードをまたいで持ち越さない
    state.error = ''; state.form = null; state.openId = null; state.editingId = null; state.armedDeleteId = null; state.editingWishNoteId = null;
    reload();
  }
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
    state.skippedVisits = []; state.skippedWishes = []; state.readFailed = false;
    render();
    return;
  }
  try {
    const [data, photos] = await Promise.all([
      invoke('read_visits_json'),
      invoke('read_all_photos'),
    ]);
    const v = partition(data?.visits || [], isValidVisit);
    const w = partition(data?.wishlist || [], isValidWish);
    state.visits = v.valid;
    state.wishlist = w.valid;
    state.skippedVisits = v.invalid;
    state.skippedWishes = w.invalid;
    state.photos = photos || [];
    state.snapshot = JSON.stringify(data);
    state.readFailed = false;
  } catch (err) {
    // visits.json が壊れている等。空として扱って保存すると既存の記録を上書きしてしまうので、編集を止める
    state.visits = []; state.wishlist = []; state.skippedVisits = []; state.skippedWishes = [];
    state.readFailed = true;
    state.error = String(err);
  }
  render();
}

// 自分や外部が写真・JSON を書き換えたときも visits モード中は追従する
listen('photos-updated', () => {
  if (document.body.dataset.mode === 'visits') reload();
});

/* ── 保存 ── */
// state.visits / state.wishlist を visits.json に書く。
// - 読み込み時に除外した不正な手編集エントリは、そのまま書き戻して失わない。
// - 最後に読んだ後で visits.json が外部から書き換えられていたら、上書きせず読み直して中止する。
async function saveVisits() {
  try {
    const current = await invoke('read_visits_json');
    if (JSON.stringify(current) !== state.snapshot) {
      state.error = 'visits.json が外部で変更されていたので読み直しました。もう一度操作してください';
      await reload();
      return false;
    }
    await invoke('write_visits_json', {
      value: {
        visits: [...state.visits, ...state.skippedVisits],
        wishlist: [...state.wishlist, ...state.skippedWishes],
      },
    });
    state.snapshot = JSON.stringify(await invoke('read_visits_json'));
    state.error = '';
    render();
    return true;
  } catch (err) {
    state.error = `保存失敗: ${err}`;
    try { await reload(); } catch (e) { render(); }
    return false;
  }
}

// 新しい訪問の ID。写真が参照している ID（削除済みの訪問のものを含む）とも衝突させない
const newVisitId = (date) => makeVisitId(
  date,
  state.visits.concat(state.skippedVisits).map((v) => v.id),
  state.photos.map((p) => p.visit).filter(Boolean),
);

const todayLocal = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（ローカル日付）

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

function button(label, onClick, className = 'visit-btn') {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/* ── フォーム（追加・編集・「行った」で共用） ── */
function buildVisitForm({ initial, submitLabel, onSubmit, onCancel }) {
  const form = el('form', 'visit-form');
  form.autocomplete = 'off';
  const fields = {};

  const field = (name, label, node) => {
    const wrap = el('label', null, label);
    node.name = name;
    wrap.appendChild(node);
    form.appendChild(wrap);
    fields[name] = node;
  };
  const input = (value) => { const i = el('input'); i.type = 'text'; i.value = value || ''; i.spellcheck = false; return i; };

  field('date', 'date (YYYY-MM-DD)', input(initial.date));
  field('place', 'place', input(initial.place));
  field('event', 'event', input(initial.event));
  const kind = input(initial.kind);
  kind.setAttribute('list', 'visit-kinds');
  field('kind', 'kind', kind);
  const note = el('textarea');
  note.rows = 3;
  note.value = initial.note || '';
  field('note', 'note', note);

  const status = el('div', 'visit-form-status');
  form.appendChild(status);

  const actions = el('div', 'visit-form-actions');
  actions.appendChild(button('cancel', onCancel));
  const submit = el('button', 'visit-btn visit-btn-primary', submitLabel);
  submit.type = 'submit';
  actions.appendChild(submit);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
      date: fields.date.value.trim(),
      place: fields.place.value.trim(),
      event: fields.event.value.trim(),
      kind: fields.kind.value.trim(),
      note: fields.note.value.trim(),
    };
    if (!isValidDate(values.date)) { status.textContent = '日付は YYYY-MM-DD で入力してください'; return; }
    if (!values.place) { status.textContent = 'place を入力してください'; return; }
    if (!values.kind) { status.textContent = 'kind を入力してください'; return; }
    submit.disabled = true;
    await onSubmit(values);
    submit.disabled = false;
  });
  return form;
}

// 編集で event / note を空にしたら、そのキーを消す（スプレッドで古い値が残らないように）
function withoutEmpty(entry, values) {
  if (!values.event) delete entry.event;
  if (!values.note) delete entry.note;
  return entry;
}

// フォームの値 → visits.json の訪問オブジェクト（空の event / note はキーごと省く）
function toVisit(id, v) {
  return { id, date: v.date, place: v.place, ...(v.event ? { event: v.event } : {}), kind: v.kind, ...(v.note ? { note: v.note } : {}) };
}

/* ── 詳細（行の下に展開） ── */
function thumb(photo) {
  const img = el('img', 'visit-thumb');
  img.loading = 'lazy';
  img.alt = photo.file;
  img.src = convertFileSrc(`${state.parent}/${photo.category}/${photo.file}`);
  img.addEventListener('click', (e) => { e.stopPropagation(); openPhoto(photo.category, photo.file); });
  return img;
}

function renderDetail(visit, linked, unassignedForDate) {
  const box = el('div', 'visit-detail');

  if (state.editingId === visit.id) {
    box.appendChild(buildVisitForm({
      initial: visit,
      submitLabel: 'save',
      onCancel: () => { state.editingId = null; render(); },
      onSubmit: async (values) => {
        const i = state.visits.findIndex((x) => x.id === visit.id);
        // id は変えない（photos.json から参照されている）。フォームに無い手編集のフィールドも残す
        if (i >= 0) state.visits[i] = withoutEmpty({ ...state.visits[i], ...toVisit(visit.id, values) }, values);
        state.editingId = null;
        await saveVisits();
      },
    }));
    return box;
  }

  // メモ（空にしたら note キーごと削除）
  const note = el('textarea', 'visit-note');
  note.rows = 2;
  note.placeholder = 'memo';
  note.value = visit.note || '';
  const saveNote = async () => {
    const next = note.value.trim();
    if (next === (visit.note || '')) return;
    if (next) visit.note = next; else delete visit.note;
    await saveVisits();
  };
  note.addEventListener('click', (e) => e.stopPropagation());
  note.addEventListener('change', saveNote);
  box.appendChild(note);

  if (linked.length > 0) {
    const row = el('div', 'visit-photos');
    linked.forEach((p) => row.appendChild(thumb(p)));
    box.appendChild(row);
  }

  // 同日に複数の訪問がある日の、まだどの訪問にも割り当てていない写真
  if (unassignedForDate && unassignedForDate.length > 0) {
    box.appendChild(el('div', 'visit-sub', 'この日の未割り当て写真'));
    const row = el('div', 'visit-photos');
    const candidates = visitsOnDate(state.visits, visit.date);
    unassignedForDate.forEach((p) => {
      const cell = el('div', 'visit-unassigned');
      cell.appendChild(thumb(p));
      const sel = el('select');
      sel.appendChild(Object.assign(el('option', null, '—'), { value: '' }));
      candidates.forEach((c) => {
        sel.appendChild(Object.assign(el('option', null, c.event ? `${c.place} · ${c.event}` : c.place), { value: c.id }));
      });
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        try {
          await invoke('update_photo_visit', { category: p.category, file: p.file, visit: sel.value });
          await reload();
        } catch (err) {
          state.error = `保存失敗: ${err}`;
          render();
        }
      });
      cell.appendChild(sel);
      row.appendChild(cell);
    });
    box.appendChild(row);
  }

  const actions = el('div', 'visit-actions');
  actions.appendChild(button('edit', () => { state.editingId = visit.id; state.armedDeleteId = null; render(); }));
  const armed = state.armedDeleteId === visit.id;
  actions.appendChild(button(armed ? 'really delete?' : 'delete', async () => {
    if (!armed) { state.armedDeleteId = visit.id; render(); return; }
    // 写真側の visit は書き換えない。存在しない ID を指す visit は linkPhotos が無視する（spec §9）
    state.visits = state.visits.filter((x) => x.id !== visit.id);
    state.openId = null;
    state.armedDeleteId = null;
    await saveVisits();
  }));
  box.appendChild(actions);
  return box;
}

function renderRow(visit, photoCount, onToggle) {
  const row = el('div', 'visit-row');
  row.addEventListener('click', onToggle);
  row.appendChild(el('span', 'visit-date', visit.date.slice(5).replace('-', '/')));
  const main = el('span', 'visit-place', visit.place);
  if (visit.event) main.appendChild(el('span', 'visit-event', ` · ${visit.event}`));
  if (visit.note) main.appendChild(el('span', 'visit-note-mark', '•'));
  row.appendChild(main);
  row.appendChild(el('span', 'visit-kind', visit.kind));
  row.appendChild(el('span', 'visit-count', photoCount > 0 ? `${photoCount}枚` : ''));
  return row;
}

// 種類の入力補完（フォーム・wishlist 追加欄で共用。id=visit-kinds を list 属性で参照する）
function kindsDatalist() {
  const dl = el('datalist');
  dl.id = 'visit-kinds';
  kindsOf(state.visits).forEach((k) => { const o = el('option'); o.value = k; dl.appendChild(o); });
  return dl;
}

/* ── 行きたい場所（日付なし）。「行った」で訪問に昇格する ── */
function renderWishlist() {
  const section = el('div', 'visits-next');
  const head = el('div', 'visits-year-head');
  head.appendChild(el('span', 'visits-year-title', 'next'));
  head.appendChild(el('span', 'visits-year-summary', `${state.wishlist.length} places`));
  section.appendChild(head);

  for (const w of state.wishlist) {
    const row = el('div', 'visit-row visit-row-static');
    row.appendChild(el('span', 'visit-date', '·'));
    const main = el('span', 'visit-place', w.place);
    if (state.editingWishNoteId === w.id) {
      // 「何を見たいか」などのメモをその場で編集（Enter か save で保存、空にすると note を消す）
      const form = el('form', 'wish-note-form');
      const input = el('input');
      input.type = 'text';
      input.value = w.note || '';
      input.placeholder = '何を見たい？';
      input.spellcheck = false;
      form.append(input, button('cancel', () => { state.editingWishNoteId = null; render(); }));
      const save = el('button', 'visit-btn visit-btn-primary', 'save');
      save.type = 'submit';
      form.appendChild(save);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const next = input.value.trim();
        if (next) w.note = next; else delete w.note;
        state.editingWishNoteId = null;
        await saveVisits();
      });
      main.appendChild(form);
      setTimeout(() => input.focus(), 0);
    } else if (w.note) {
      main.appendChild(el('div', 'wish-note', w.note));
    }
    row.appendChild(main);
    row.appendChild(el('span', 'visit-kind', w.kind));
    const actions = el('span', 'visit-actions');
    actions.appendChild(button('memo', () => { state.editingWishNoteId = w.id; state.armedDeleteId = null; render(); }));
    actions.appendChild(button('[ visited ]', () => {
      // 訪問フォームを place / kind 事前入力・日付は今日で開く。保存したときだけ 1 回の書き込みで昇格する
      state.form = {
        initial: { date: todayLocal(), place: w.place, kind: w.kind, note: w.note },
        submitLabel: 'add',
        onSubmit: async (values) => {
          state.visits.push(toVisit(newVisitId(values.date), values));
          state.wishlist = state.wishlist.filter((x) => x.id !== w.id);
          state.form = null;
          await saveVisits();
        },
      };
      render();
      window.scrollTo(0, 0);
    }));
    const armed = state.armedDeleteId === w.id;
    actions.appendChild(button(armed ? 'really delete?' : 'delete', async () => {
      if (!armed) { state.armedDeleteId = w.id; render(); return; }
      state.wishlist = state.wishlist.filter((x) => x.id !== w.id);
      state.armedDeleteId = null;
      await saveVisits();
    }));
    row.appendChild(actions);
    section.appendChild(row);
  }

  // 追加欄
  const add = el('form', 'visits-next-add');
  add.autocomplete = 'off';
  const place = el('input'); place.type = 'text'; place.name = 'place'; place.placeholder = 'place'; place.spellcheck = false;
  const kind = el('input'); kind.type = 'text'; kind.name = 'kind'; kind.placeholder = 'kind'; kind.setAttribute('list', 'visit-kinds');
  const memo = el('input'); memo.type = 'text'; memo.name = 'note'; memo.placeholder = 'memo（何を見たい？）'; memo.spellcheck = false;
  const submit = el('button', 'visit-btn', 'add');
  submit.type = 'submit';
  add.append(place, kind, memo, submit);
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = place.value.trim();
    const k = kind.value.trim();
    if (!p || !k) return; // 両方そろうまで何もしない
    const note = memo.value.trim();
    state.wishlist.push({ id: makeWishId(state.wishlist.map((w) => w.id)), place: p, kind: k, ...(note ? { note } : {}) });
    await saveVisits();
  });
  section.appendChild(add);
  return section;
}

function render() {
  view.replaceChildren();

  if (!state.parent) {
    view.appendChild(el('div', 'visits-message', 'フォルダを先に選択してください'));
    return;
  }

  if (state.error) view.appendChild(el('div', 'visits-error', state.error));
  if (state.readFailed) {
    // 壊れた visits.json を空として扱わない。直すまで編集させない
    view.appendChild(el('div', 'visits-message', 'visits.json を直してから、もう一度 visits を開いてください'));
    return;
  }
  const skipped = state.skippedVisits.length + state.skippedWishes.length;
  if (skipped > 0) view.appendChild(el('div', 'visits-error', `${skipped} 件の不正な記録（id / date / place / kind が欠けている）は表示していません。保存してもファイルには残します`));
  view.appendChild(kindsDatalist());

  // next モード: 行きたい場所だけを出す（「行った」で開く訪問フォームもここに出る）
  if (document.body.dataset.mode === 'next') {
    if (state.form) {
      view.appendChild(buildVisitForm({ ...state.form, onCancel: () => { state.form = null; render(); } }));
    }
    view.appendChild(renderWishlist());
    return;
  }

  // ツールバー: 種類フィルタ + [ add visit ]
  const toolbar = el('div', 'visits-toolbar');
  toolbar.appendChild(renderFilters());
  toolbar.appendChild(button('[ add visit ]', () => {
    state.form = {
      initial: { date: todayLocal() },
      submitLabel: 'add',
      onSubmit: async (values) => {
        state.visits.push(toVisit(newVisitId(values.date), values));
        state.form = null;
        await saveVisits();
      },
    };
    render();
  }));
  view.appendChild(toolbar);

  if (state.form) {
    view.appendChild(buildVisitForm({
      ...state.form,
      onCancel: () => { state.form = null; render(); },
    }));
  }

  if (state.visits.length === 0) {
    view.appendChild(el('div', 'visits-message', 'まだ訪問記録がありません'));
    return;
  }

  const { byVisit, unassigned } = linkPhotos(state.photos, state.visits);
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
      const linked = byVisit.get(v.id) || [];
      section.appendChild(renderRow(v, linked.length, () => {
        state.openId = state.openId === v.id ? null : v.id;
        state.editingId = null;
        state.armedDeleteId = null;
        render();
      }));
      if (state.openId === v.id) section.appendChild(renderDetail(v, linked, unassigned.get(v.date)));
    }
    view.appendChild(section);
  }
}
