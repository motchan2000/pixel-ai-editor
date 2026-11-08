// 16x16 のドット絵からアプリアイコン (build/icon.png 256px) と Web 用画像を作る
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const P = {
  '.': null, k: [0x1e, 0x1f, 0x26], o: [0x1a, 0x1c, 0x2c], g: [0x38, 0xb7, 0x64],
  l: [0xa7, 0xf0, 0x70], d: [0x25, 0x71, 0x79], w: [0xff, 0xff, 0xff], p: [0xff, 0x5c, 0x8a],
};
const ART = [
  '.kkkkkkkkkkkkkk.',
  'kkkkkkkkkkkkkpkk',
  'kkkkkkkkkkkkpppk',
  'kkkkkkkkkkkkkpkk',
  'kkkkkkooookkkkkk',
  'kkkkoollggookkkk',
  'kkkollllgggokkkk',
  'kkolwwlggwwgokkk',
  'kkolwolggwogokkk',
  'kolllgggggggdokk',
  'kollggggggggdokk',
  'koggggggggggddok',
  'kogggggggggddokk',
  'kkoddddddddookkk',
  'kkkoooooooookkkk',
  '.kkkkkkkkkkkkkk.',
];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(scale) {
  const n = ART.length, W = n * scale;
  const raw = Buffer.alloc((W * 4 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const c = P[ART[(y / scale) | 0][(x / scale) | 0]];
      const i = y * (W * 4 + 1) + 1 + x * 4;
      if (c) { raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = 255; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(16));
fs.writeFileSync(path.join(root, 'docs', 'icon.png'), png(8));
fs.writeFileSync(path.join(root, 'docs', 'favicon.png'), png(2));
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'renderer', 'icon.png'));
console.log('icons written');
