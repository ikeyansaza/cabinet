// 編集パネルの「登録済みの種から選ぶ」候補を作る純粋ロジック（node --test でテスト）。

/**
 * species.json（ID → エントリ）から datalist 用の候補を作る。
 * 表示名は name_ja → name_en → ID の順で選び、表示名の昇順に並べる。
 */
export function speciesOptions(speciesMap) {
  return Object.entries(speciesMap || {})
    .map(([id, sp]) => {
      const name = sp && (sp.name_ja || sp.name_en);
      return { id, label: name || id, named: Boolean(name) };
    })
    // 名前のある種を先に、名前が無く ID で代用しているものは後ろにまとめる
    .sort((a, b) => (b.named - a.named) || a.label.localeCompare(b.label, 'ja'))
    .map(({ id, label }) => ({ id, label }));
}
