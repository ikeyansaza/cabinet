// Notion 貼り付けデータ（Markdown 表）→ visits.json 変換。1 回限りの移行用。
import { makeVisitId, makeWishId } from '../src/visits-logic.js';

/** '2026年10月3日  ' → '2026-10-03'。形式外は throw。 */
export function parseDate(jp) {
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(String(jp).trim());
  if (!m) throw new Error(`invalid date: ${jp}`);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** '場所@イベント' を最初の @ で分割。@ が無ければ event キーを持たない。 */
export function splitPlaceEvent(s) {
  const i = s.indexOf('@');
  if (i < 0) return { place: s.trim() };
  return { place: s.slice(0, i).trim(), event: s.slice(i + 1).trim() };
}

export const artKind = (place) => (place.includes('博物館') ? '博物館' : '美術館');
export const wishKind = (place) => (place.includes('牧場') ? '牧場' : '動物園');

function isDate(s) {
  try { parseDate(s); return true; } catch { return false; }
}

/**
 * Markdown 表 → セル配列の配列。区切り行（---）と、先頭セルが日付でない行（ヘッダー）は除く。
 * 美術系の表は Markdown 上のヘッダー位置にデータの 1 行目が来ているので、
 * 「日付で始まるか」で判定してデータとして残す。
 */
export function parseRows(markdown) {
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^-+$/.test(c)))
    .filter((cells) => isDate(cells[0]));
}

/** 3 つの入力文字列から { visits, wishlist } を作る。visits は日付昇順（同日は入力順）。 */
export function convert({ animals, arts, next }) {
  const raw = [];
  for (const [date, place, kind] of parseRows(animals)) {
    raw.push({ date: parseDate(date), place, kind });
  }
  for (const [date, placeEvent] of parseRows(arts)) {
    const { place, event } = splitPlaceEvent(placeEvent);
    raw.push({ date: parseDate(date), place, ...(event ? { event } : {}), kind: artKind(place) });
  }
  // Array.prototype.sort は安定なので、同日は入力順（動物系 → 美術系）が保たれる
  raw.sort((a, b) => a.date.localeCompare(b.date));

  const ids = [];
  const visits = raw.map((r) => {
    const id = makeVisitId(r.date, ids);
    ids.push(id);
    return { id, date: r.date, place: r.place, ...(r.event ? { event: r.event } : {}), kind: r.kind };
  });

  const wishIds = [];
  const wishlist = next
    .split('\n')
    .map((l) => /^-\s*\[[ x]\]\s*(.+)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => {
      const place = m[1].trim();
      const id = makeWishId(wishIds);
      wishIds.push(id);
      return { id, place, kind: wishKind(place) };
    });

  return { visits, wishlist };
}
