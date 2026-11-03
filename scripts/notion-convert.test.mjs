import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, splitPlaceEvent, artKind, wishKind, parseRows, convert,
} from './notion-convert.mjs';

test('parseDate converts Japanese dates with padding and surrounding spaces', () => {
  assert.equal(parseDate('2026年10月3日  '), '2026-10-03');
  assert.equal(parseDate('2024年12月14日'), '2024-12-14');
  assert.throws(() => parseDate('2026/10/3'));
});

test('splitPlaceEvent splits on the first @', () => {
  assert.deepEqual(splitPlaceEvent('横浜市美術館@佐藤雅彦展'), { place: '横浜市美術館', event: '佐藤雅彦展' });
  const r = splitPlaceEvent('N’s Yard');
  assert.deepEqual(r, { place: 'N’s Yard' });
  assert.equal('event' in r, false);
});

test('artKind and wishKind classify by name', () => {
  assert.equal(artKind('江戸東京博物館'), '博物館');
  assert.equal(artKind('福岡市博物館'), '博物館');
  assert.equal(artKind('六本木クロッシング'), '美術館');
  assert.equal(wishKind('伊香保グリーン牧場'), '牧場');
  assert.equal(wishKind('群馬サファリパーク'), '動物園');
});

test('parseRows drops separators and header rows but keeps a date-first first row', () => {
  const arts = '| 2022年7月3日   | 東京国立近代美術館 |\n| --- | --- |\n| 2022年7月30日  | 福岡アジア美術館 |';
  assert.deepEqual(parseRows(arts), [
    ['2022年7月3日', '東京国立近代美術館'],
    ['2022年7月30日', '福岡アジア美術館'],
  ]);
  const animals = '| 日付 | 場所 | 種類 |\n| --- | --- | --- |\n| 2026年10月3日  | まかいの牧場 | 牧場 |';
  assert.deepEqual(parseRows(animals), [['2026年10月3日', 'まかいの牧場', '牧場']]);
});

test('convert merges tables, sorts by date, assigns unique ids, splits events', () => {
  const animals = '| 日付 | 場所 | 種類 |\n| --- | --- | --- |\n| 2025年10月12日  | 上野動物園 | 動物園 |';
  const arts = [
    '| 2025年10月12日  | アーティゾン美術館@葛飾北斎展 |',
    '| --- | --- |',
    '| 2025年10月12日  | グッチ銀座ギャラリー@横尾忠則展 |',
    '| 2024年10月14日  | 佐賀県立美術館 |',
  ].join('\n');
  const next = '- [ ]  伊香保グリーン牧場\n- [ ]  群馬サファリパーク';
  const { visits, wishlist } = convert({ animals, arts, next });
  assert.deepEqual(visits.map((x) => x.date), ['2024-10-14', '2025-10-12', '2025-10-12', '2025-10-12']);
  assert.equal(new Set(visits.map((x) => x.id)).size, 4);
  const art = visits.find((x) => x.place === 'アーティゾン美術館');
  assert.equal(art.event, '葛飾北斎展');
  assert.equal(art.kind, '美術館');
  assert.equal(visits.some((x) => 'note' in x), false);
  assert.deepEqual(wishlist.map((w) => [w.place, w.kind]), [['伊香保グリーン牧場', '牧場'], ['群馬サファリパーク', '動物園']]);
  assert.equal(new Set(wishlist.map((w) => w.id)).size, 2);
});
