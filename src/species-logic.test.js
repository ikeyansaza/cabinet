import test from 'node:test';
import assert from 'node:assert/strict';
import { speciesOptions } from './species-logic.js';

test('登録済みの種を ID と表示名の組で返し、表示名順に並べる', () => {
  const map = {
    sparrow: { name_ja: 'スズメ' },
    kingfisher: { name_ja: 'カワセミ' },
  };
  assert.deepEqual(speciesOptions(map), [
    { id: 'kingfisher', label: 'カワセミ' },
    { id: 'sparrow', label: 'スズメ' },
  ]);
});

test('name_ja が無ければ name_en、それも無ければ ID を表示名にする', () => {
  const map = { a: { name_en: 'Owl' }, b: {} };
  assert.deepEqual(speciesOptions(map), [
    { id: 'a', label: 'Owl' },
    { id: 'b', label: 'b' },
  ]);
});

test('null や空のマップでも落ちない', () => {
  assert.deepEqual(speciesOptions(null), []);
  assert.deepEqual(speciesOptions({}), []);
  assert.deepEqual(speciesOptions({ x: null }), [{ id: 'x', label: 'x' }]);
});
