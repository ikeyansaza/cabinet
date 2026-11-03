// 使い方: node scripts/migrate_notion.mjs <animals.md> <arts.md> <next.md> <out.json>
// 出力先が既にあれば何も書かず異常終了する（既存の visits.json を上書きしない）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { convert } from './notion-convert.mjs';

const [animalsPath, artsPath, nextPath, outPath] = process.argv.slice(2);
if (!animalsPath || !artsPath || !nextPath || !outPath) {
  console.error('usage: migrate_notion.mjs <animals.md> <arts.md> <next.md> <out.json>');
  process.exit(2);
}
if (existsSync(outPath)) {
  console.error(`refusing to overwrite existing file: ${outPath}`);
  process.exit(1);
}
const result = convert({
  animals: readFileSync(animalsPath, 'utf8'),
  arts: readFileSync(artsPath, 'utf8'),
  next: readFileSync(nextPath, 'utf8'),
});
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(`wrote ${result.visits.length} visits, ${result.wishlist.length} wishlist -> ${outPath}`);
