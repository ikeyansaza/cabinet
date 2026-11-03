import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDate, kindsOf, summarizeYear, groupByYear, linkPhotos,
  visitsOnDate, makeVisitId, makeWishId, isValidVisit, isValidWish, partition,
} from './visits-logic.js';

const v = (id, date, place, kind, extra = {}) => ({ id, date, place, kind, ...extra });

const v2025 = [
  v('2025-01-25-1', '2025-01-25', '野毛山動物園', '動物園'),
  v('2025-03-09-1', '2025-03-09', 'よこはま動物園ズーラシア', '動物園'),
  v('2025-10-12-1', '2025-10-12', 'アーティゾン美術館', '美術館', { event: '葛飾北斎展' }),
  v('2025-12-21-1', '2025-12-21', '野毛山動物園', '美術館'),
];

test('summarizeYear counts visits, kinds, unique places and repeats', () => {
  const s = summarizeYear(v2025);
  assert.equal(s.count, 4);
  assert.deepEqual(s.byKind, { 動物園: 2, 美術館: 2 });
  assert.equal(s.uniquePlaces, 3);
  assert.equal(s.repeats, 1);
});

test('summarizeYear of nothing is all zero', () => {
  assert.deepEqual(summarizeYear([]), { count: 0, byKind: {}, uniquePlaces: 0, repeats: 0 });
});

test('groupByYear orders years desc, rows by date desc then id desc', () => {
  const all = [
    ...v2025,
    v('2026-04-27-1', '2026-04-27', '那須ステンドグラス美術館', '美術館'),
    v('2026-04-27-2', '2026-04-27', '藤城清治美術館', '美術館'),
  ];
  const g = groupByYear(all);
  assert.deepEqual(g.map((x) => x.year), ['2026', '2025']);
  assert.deepEqual(g[0].visits.map((x) => x.id), ['2026-04-27-2', '2026-04-27-1']);
  assert.equal(g[1].visits[0].id, '2025-12-21-1');
});

test('groupByYear filter narrows rows but keeps the whole-year summary', () => {
  const all = [...v2025, v('2026-04-27-1', '2026-04-27', '那須ステンドグラス美術館', '美術館')];
  const g = groupByYear(all, '動物園');
  assert.deepEqual(g.map((x) => x.year), ['2025']); // 2026 には動物園が無いので年ごと消える
  assert.equal(g[0].visits.length, 2);
  assert.equal(g[0].summary.count, 4);
});

test('kindsOf returns unique kinds', () => {
  assert.deepEqual(kindsOf(v2025).sort(), ['動物園', '美術館']);
});

test('isValidDate accepts only real YYYY-MM-DD', () => {
  assert.equal(isValidDate('2025-10-12'), true);
  for (const bad of ['2025-2-3', '2025-02-30', '', '20251012', '2025-13-01']) {
    assert.equal(isValidDate(bad), false, bad);
  }
});

test('visitsOnDate returns visits of that date', () => {
  assert.deepEqual(visitsOnDate(v2025, '2025-10-12').map((x) => x.id), ['2025-10-12-1']);
  assert.deepEqual(visitsOnDate(v2025, '2000-01-01'), []);
});

test('makeVisitId never reuses a number: it takes max+1 for the date', () => {
  assert.equal(makeVisitId('2025-10-12', []), '2025-10-12-1');
  assert.equal(makeVisitId('2025-10-12', ['2025-10-12-1']), '2025-10-12-2');
  // 歯抜けを埋めない（削除した訪問の ID を再利用すると、写真の visit が別の訪問に付け替わってしまう）
  assert.equal(makeVisitId('2025-10-12', ['2025-10-12-2']), '2025-10-12-3');
  // 他の日の ID は数えない
  assert.equal(makeVisitId('2025-10-12', ['2025-10-11-5']), '2025-10-12-1');
});

test('makeVisitId also avoids ids still referenced by photos', () => {
  assert.equal(makeVisitId('2025-10-12', ['2025-10-12-1'], ['2025-10-12-4']), '2025-10-12-5');
});

test('isValidVisit requires id, valid date, place and kind as strings', () => {
  assert.equal(isValidVisit(v('2025-10-12-1', '2025-10-12', 'a', '美術館')), true);
  assert.equal(isValidVisit({ place: 'x', kind: '動物園' }), false);          // id / date 無し
  assert.equal(isValidVisit(v('i', '2025-13-40', 'a', 'k')), false);           // 日付が不正
  assert.equal(isValidVisit(v('i', '2025-10-12', '', 'k')), false);            // place 空
  assert.equal(isValidVisit(v('i', '2025-10-12', 'a', undefined)), false);     // kind 無し
  assert.equal(isValidVisit(null), false);
});

test('isValidWish requires id, place and kind', () => {
  assert.equal(isValidWish({ id: 'w1', place: 'a', kind: '牧場' }), true);
  assert.equal(isValidWish({ id: 'w1', place: 'a' }), false);
});

test('partition splits valid and invalid entries without losing any', () => {
  const good = v('2025-10-12-1', '2025-10-12', 'a', '美術館');
  const bad = { place: 'x', kind: '動物園' };
  const r = partition([good, bad, null], isValidVisit);
  assert.deepEqual(r.valid, [good]);
  assert.deepEqual(r.invalid, [bad, null]);
});

test('makeWishId picks the smallest unused number', () => {
  assert.equal(makeWishId(['w1', 'w3']), 'w2');
  assert.equal(makeWishId([]), 'w1');
});

const twin = [
  v('2025-10-12-1', '2025-10-12', 'アーティゾン美術館', '美術館'),
  v('2025-10-12-2', '2025-10-12', 'グッチ銀座ギャラリー', '美術館'),
  v('2025-11-24-1', '2025-11-24', '上野動物園', '動物園'),
];
const ph = (file, extra = {}) => ({ category: 'arts', file, ...extra });

test('linkPhotos links a photo on a single-visit date automatically', () => {
  const r = linkPhotos([ph('a.jpg', { date: '2025-11-24' })], twin);
  assert.deepEqual(r.byVisit.get('2025-11-24-1').map((p) => p.file), ['a.jpg']);
  assert.equal(r.unassigned.size, 0);
});

test('linkPhotos leaves same-day-twin photos unassigned', () => {
  const r = linkPhotos([ph('a.jpg', { date: '2025-10-12' })], twin);
  assert.deepEqual(r.unassigned.get('2025-10-12').map((p) => p.file), ['a.jpg']);
  assert.equal(r.byVisit.size, 0);
});

test('linkPhotos honours an explicit visit even on a twin day', () => {
  const r = linkPhotos([ph('a.jpg', { date: '2025-10-12', visit: '2025-10-12-2' })], twin);
  assert.deepEqual(r.byVisit.get('2025-10-12-2').map((p) => p.file), ['a.jpg']);
  assert.equal(r.unassigned.size, 0);
});

test('linkPhotos ignores a dangling visit id and falls back to the date rule', () => {
  const r = linkPhotos([ph('a.jpg', { date: '2025-11-24', visit: 'gone' })], twin);
  assert.deepEqual(r.byVisit.get('2025-11-24-1').map((p) => p.file), ['a.jpg']);
});

test('linkPhotos skips photos with no date or no matching visit without throwing', () => {
  const r = linkPhotos([ph('a.jpg'), ph('b.jpg', { date: '1999-01-01' })], twin);
  assert.equal(r.byVisit.size, 0);
  assert.equal(r.unassigned.size, 0);
});

test('linkPhotos honours an explicit visit even when the dates differ', () => {
  const r = linkPhotos([ph('a.jpg', { date: '2025-01-01', visit: '2025-11-24-1' })], twin);
  assert.deepEqual(r.byVisit.get('2025-11-24-1').map((p) => p.file), ['a.jpg']);
});
