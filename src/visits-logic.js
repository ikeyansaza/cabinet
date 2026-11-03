// visits-logic.js — DOM / Tauri に依存しない純粋ロジック（node --test でテストする）
//
// @typedef {{id:string, date:string, place:string, event?:string, kind:string, note?:string}} Visit
// @typedef {{category:string, file:string, date?:string, visit?:string}} Photo

/** YYYY-MM-DD 形式かつ実在する日付か。 */
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Date は 02-30 を 03-02 に繰り上げるので、往復して一致するかで実在を判定する
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 訪問に出てくる種類（重複なし、日本語ロケール順）。フィルタボタンの生成に使う。 */
export function kindsOf(visits) {
  return [...new Set(visits.map((v) => v.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

/** 1 年分の訪問から、訪問数・種類別内訳・ユニークな場所数・リピート数を出す。 */
export function summarizeYear(visits) {
  const byKind = {};
  for (const v of visits) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
  // 場所は表記ゆれの正規化をせず完全一致で数える（spec §9）
  const uniquePlaces = new Set(visits.map((v) => v.place)).size;
  return { count: visits.length, byKind, uniquePlaces, repeats: visits.length - uniquePlaces };
}

/**
 * 年ごとにまとめる。年は新しい順、年内は日付降順（同日は id 降順）。
 * summary はフィルタ前の年全体から計算し、行（visits）だけを kind で絞る。
 * フィルタ後に 0 件になった年は返さない。
 */
export function groupByYear(visits, kind = 'all') {
  const years = new Map();
  for (const v of visits) {
    const year = v.date.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(v);
  }
  const groups = [];
  for (const [year, all] of years) {
    const rows = (kind === 'all' ? all : all.filter((v) => v.kind === kind))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    if (rows.length === 0) continue;
    groups.push({ year, summary: summarizeYear(all), visits: rows });
  }
  return groups.sort((a, b) => b.year.localeCompare(a.year));
}

export function visitsOnDate(visits, date) {
  return visits.filter((v) => v.date === date);
}

/**
 * 写真を訪問に結びつける。
 *  1. photo.visit が実在する訪問を指していれば、日付が違ってもそれを優先。
 *  2. それ以外（visit 無し・存在しない ID）は撮影日で判定:
 *     同日の訪問が 1 件ならその訪問へ、2 件以上なら unassigned[date]（手動選択待ち）へ。
 *     0 件、または date 無しの写真はどこにも入れない。
 */
export function linkPhotos(photos, visits) {
  const byId = new Map(visits.map((v) => [v.id, v]));
  const byVisit = new Map();
  const unassigned = new Map();
  const push = (map, key, photo) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(photo);
  };
  for (const p of photos) {
    if (p.visit && byId.has(p.visit)) {
      push(byVisit, p.visit, p);
      continue;
    }
    if (!p.date) continue;
    const sameDay = visitsOnDate(visits, p.date);
    if (sameDay.length === 1) push(byVisit, sameDay[0].id, p);
    else if (sameDay.length >= 2) push(unassigned, p.date, p);
  }
  return { byVisit, unassigned };
}

function smallestUnused(isUsed) {
  let n = 1;
  while (isUsed(n)) n += 1;
  return n;
}

/** `${date}-${n}`（n は未使用の最小の正整数）。場所に依存しないので編集しても id は変わらない。 */
export function makeVisitId(date, existingIds) {
  const used = new Set(existingIds);
  return `${date}-${smallestUnused((n) => used.has(`${date}-${n}`))}`;
}

/** `w${n}`（n は未使用の最小の正整数）。 */
export function makeWishId(existingIds) {
  const used = new Set(existingIds);
  return `w${smallestUnused((n) => used.has(`w${n}`))}`;
}
