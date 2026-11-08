const assert = require('assert');
const { parseRough, normalizeColor } = require('../ai');

assert.strictEqual(normalizeColor('#ABC'), '#aabbcc');
assert.strictEqual(normalizeColor('ff0000'), '#ff0000');
assert.strictEqual(normalizeColor('transparent'), null);
assert.strictEqual(normalizeColor('red'), null);

// 正常系
let r = parseRough(JSON.stringify({ palette: { '.': 'transparent', a: '#000', b: '#ff0000' }, rows: ['ab..', '.ab.', '..ab', 'b..a'] }), 4);
assert.strictEqual(r.pixels.length, 16);
assert.strictEqual(r.pixels[0], '#000000');
assert.strictEqual(r.pixels[1], '#ff0000');
assert.strictEqual(r.pixels[2], null);
assert.deepStrictEqual(r.palette.sort(), ['#000000', '#ff0000']);

// コードフェンス + 行数不足 + 長すぎる行 + 未知文字
r = parseRough('```json\n{"palette":{"a":"#112233"},"rows":["aaaaaaa","azq"]}\n```', 4);
assert.deepStrictEqual(r.pixels.slice(0, 4), ['#112233', '#112233', '#112233', '#112233']);
assert.deepStrictEqual(r.pixels.slice(4, 8), ['#112233', null, null, null]);
assert.ok(r.pixels.slice(8).every((p) => p === null));

// 壊れたJSON / 空
assert.throws(() => parseRough('not json', 4));
assert.throws(() => parseRough('{"palette":{},"rows":["...."]}', 4));

console.log('all parse tests passed');
