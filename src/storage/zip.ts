/** Pure minimal ZIP writer (stored, no compression) so "export all" can share one file without a dependency. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function zipStore(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u32 = (dv: DataView, o: number, v: number) => dv.setUint32(o, v, true);
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    u32(h, 0, 0x04034b50); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    u32(h, 14, crc); u32(h, 18, data.length); u32(h, 22, data.length); h.setUint16(26, name.length, true);
    head.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const c = new DataView(cd.buffer);
    u32(c, 0, 0x02014b50); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    u32(c, 16, crc); u32(c, 20, data.length); u32(c, 24, data.length); c.setUint16(28, name.length, true); u32(c, 42, offset);
    cd.set(name, 46);
    central.push(cd);
    parts.push(head, data);
    offset += head.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); u32(e, 12, cdSize); u32(e, 16, offset);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
