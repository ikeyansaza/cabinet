import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtist, artistLabel, planArtistInputs } from './artist-logic.js';

const artists = {
  yoshitomo_nara: { name: '奈良美智', name_en: 'Yoshitomo Nara' },
  taro_okamoto: { name: '岡本太郎' },
  noname: {},
};

test('空入力は作家なし', () => {
  assert.deepEqual(resolveArtist('  ', artists), { id: '', isNew: false });
});

test('名前が一致すればその作家の ID に解決する', () => {
  assert.deepEqual(resolveArtist('奈良美智', artists), { id: 'yoshitomo_nara', isNew: false });
});

test('前後の空白は無視する', () => {
  assert.deepEqual(resolveArtist(' 岡本太郎 ', artists), { id: 'taro_okamoto', isNew: false });
});

test('ID をそのまま入れても既存作家に解決する（従来の入力も壊さない）', () => {
  assert.deepEqual(resolveArtist('taro_okamoto', artists), { id: 'taro_okamoto', isNew: false });
});

test('未登録の名前は新規作家（ID は名前そのもの）', () => {
  assert.deepEqual(resolveArtist('クロード・モネ', artists), { id: 'クロード・モネ', isNew: true });
});

test('artistsMap が空でも新規扱いで落ちない', () => {
  assert.deepEqual(resolveArtist('モネ', undefined), { id: 'モネ', isNew: true });
});

test('表示ラベルは name、無ければ ID、ID も無ければ空', () => {
  assert.equal(artistLabel('yoshitomo_nara', artists), '奈良美智');
  assert.equal(artistLabel('noname', artists), 'noname');
  assert.equal(artistLabel('unknown_id', artists), 'unknown_id');
  assert.equal(artistLabel('', artists), '');
  assert.equal(artistLabel(undefined, artists), '');
});

test('artist と co_artist をまとめて解決し、新規作家は重複なく登録対象にする', () => {
  const plan = planArtistInputs('モネ', 'モネ', artists);
  assert.equal(plan.artist, 'モネ');
  assert.equal(plan.coArtist, 'モネ');
  assert.deepEqual(plan.newArtists, { 'モネ': { name: 'モネ' } });
});

test('既存作家だけなら newArtists は空', () => {
  const plan = planArtistInputs('奈良美智', '', artists);
  assert.equal(plan.artist, 'yoshitomo_nara');
  assert.equal(plan.coArtist, '');
  assert.deepEqual(plan.newArtists, {});
});

import { pruneUnusedStubs } from './artist-logic.js';

test('どこからも参照されない name だけの作家（自動登録の残骸）は消す', () => {
  const map = { 'モネ': { name: 'モネ' }, 'クロード・モネ': { name: 'クロード・モネ' } };
  const species = { a: { artist: 'クロード・モネ' } };
  assert.deepEqual(pruneUnusedStubs(map, species), { 'クロード・モネ': { name: 'クロード・モネ' } });
});

test('参照されていれば name だけでも残す（artist / co_artist どちらでも）', () => {
  const map = { x: { name: 'x' }, y: { name: 'y' } };
  const species = { a: { artist: 'x' }, b: { co_artist: 'y' } };
  assert.deepEqual(pruneUnusedStubs(map, species), map);
});

test('bio などを書いた作家は参照が無くても消さない', () => {
  const map = { taro: { name: '岡本太郎', bio: '…' }, born_only: { name: 'b', born: '1900' } };
  assert.deepEqual(pruneUnusedStubs(map, {}), map);
});

test('何も消すものが無ければ同じ内容を返す（元のオブジェクトは変更しない）', () => {
  const map = { a: { name: 'a' } };
  const copy = JSON.parse(JSON.stringify(map));
  pruneUnusedStubs(map, { s: { artist: 'a' } });
  assert.deepEqual(map, copy);
});
