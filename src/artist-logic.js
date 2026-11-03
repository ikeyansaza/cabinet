// 作家入力（名前 or ID）の解決ロジック。純粋関数。node --test でテストする。
// 画面は「作家名」で入力させ、artists.json のキー（ID）は裏で扱う。

/**
 * 入力文字列を作家 ID に解決する。
 *  - 空 → 作家なし
 *  - 既存の ID と一致 → その ID（従来どおり ID を直接入れても動く）
 *  - 既存作家の name と一致 → その作家の ID
 *  - どれでもない → 新規作家。ID は名前そのもの（日本語名はローマ字化できないため）
 * @returns {{id:string, isNew:boolean}}
 */
export function resolveArtist(input, artistsMap) {
  const text = String(input ?? '').trim();
  if (!text) return { id: '', isNew: false };
  const map = artistsMap || {};
  if (Object.prototype.hasOwnProperty.call(map, text)) return { id: text, isNew: false };
  const hit = Object.keys(map).find((k) => map[k] && map[k].name === text);
  if (hit) return { id: hit, isNew: false };
  return { id: text, isNew: true };
}

/** フォームに出す表示名。name があればそれ、無ければ ID、ID が空なら空 */
export function artistLabel(id, artistsMap) {
  if (!id) return '';
  const a = (artistsMap || {})[id];
  return (a && a.name) || id;
}

/**
 * artist / co_artist の 2 入力をまとめて解決する。
 * 新規作家は artists.json に追加するエントリ（{name}）として返す。
 * 同じ新規名が両方に入っていても 1 件だけ登録する。
 */
export function planArtistInputs(artistInput, coInput, artistsMap) {
  const a = resolveArtist(artistInput, artistsMap);
  const c = resolveArtist(coInput, artistsMap);
  const newArtists = {};
  for (const r of [a, c]) {
    if (r.isNew) newArtists[r.id] = { name: r.id };
  }
  return { artist: a.id, coArtist: c.id, newArtists };
}

/**
 * 自動登録された作家（name だけのエントリ）のうち、どの作品からも参照されなくなったものを消す。
 * 「モネ」と入れてから「クロード・モネ」に直したとき、古い「モネ」が候補に残り続けるのを防ぐ。
 * bio / born など name 以外を持つ作家は手で育てたマスタなので、参照が無くても消さない。
 * 元の artistsMap は変更しない。
 */
export function pruneUnusedStubs(artistsMap, speciesMap) {
  const used = new Set();
  for (const sp of Object.values(speciesMap || {})) {
    if (sp && sp.artist) used.add(sp.artist);
    if (sp && sp.co_artist) used.add(sp.co_artist);
  }
  const out = {};
  for (const [id, a] of Object.entries(artistsMap || {})) {
    const keys = a ? Object.keys(a) : [];
    const isStub = keys.length === 1 && keys[0] === 'name';
    if (isStub && !used.has(id)) continue;
    out[id] = a;
  }
  return out;
}
