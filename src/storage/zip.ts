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

const u32 = (dv: DataView, o: number, v: number) => dv.setUint32(o, v, true);

/**
 * Writes the archive piece by piece through `write`. Entries may come from a generator, so only one
 * entry's text is in memory at a time; the central directory (small) is kept until the end.
 */
export async function zipWrite(
  entries: AsyncIterable<{ name: string; text: string }> | Iterable<{ name: string; text: string }>,
  write: (bytes: Uint8Array) => void,
): Promise<void> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  for await (const f of entries) {
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
    write(head);
    write(data);
    offset += head.length + data.length;
  }
  for (const cd of central) write(cd);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  u32(e, 12, central.reduce((a, b) => a + b.length, 0)); u32(e, 16, offset);
  write(end);
}
