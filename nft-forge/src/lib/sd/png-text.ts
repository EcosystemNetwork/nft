/** PNG text chunks. Automatic1111 stores generation parameters under the keyword `parameters`. */

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function isLatin1(text: string): boolean {
  for (const ch of text) if (ch.charCodeAt(0) > 255) return false;
  return true;
}

export function embedPngText(png: Buffer, keyword: string, text: string): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIG)) throw new Error("not a png");
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword)) throw new Error("bad png keyword");
  const data = isLatin1(text)
    ? Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")])
    : Buffer.concat([
        Buffer.from(`${keyword}\0`, "latin1"),
        Buffer.from([0, 0]),
        Buffer.from("\0\0", "latin1"),
        Buffer.from(text, "utf8"),
      ]);
  const piece = chunk(isLatin1(text) ? "tEXt" : "iTXt", data);
  let o = 8;
  while (o + 12 <= png.length) {
    const n = png.readUInt32BE(o);
    const t = png.toString("ascii", o + 4, o + 8);
    if (t === "IEND") return Buffer.concat([png.subarray(0, o), piece, png.subarray(o)]);
    o += 12 + n;
  }
  throw new Error("png has no IEND");
}

function readKeyword(data: Buffer): { keyword: string; text: string } | null {
  const nul = data.indexOf(0);
  if (nul <= 0) return null;
  return { keyword: data.toString("latin1", 0, nul), text: data.toString("latin1", nul + 1) };
}

export function readPngText(png: Buffer, keyword: string): string | null {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIG)) return null;
  let o = 8;
  while (o + 12 <= png.length) {
    const n = png.readUInt32BE(o);
    if (o + 12 + n > png.length) return null;
    const t = png.toString("ascii", o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + n);
    const expect = png.readUInt32BE(o + 8 + n);
    const got = crc32(Buffer.concat([png.subarray(o + 4, o + 8), data]));
    if (expect !== got) return null;
    if (t === "tEXt") {
      const hit = readKeyword(data);
      if (hit?.keyword === keyword) return hit.text;
    } else if (t === "iTXt") {
      const nul = data.indexOf(0);
      if (nul > 0 && data.toString("latin1", 0, nul) === keyword) {
        // keyword \0 flag method \0 lang \0 translated \0 text
        let p = nul + 1;
        p += 2; // compression flag + method
        const langEnd = data.indexOf(0, p);
        if (langEnd < 0) return null;
        const trEnd = data.indexOf(0, langEnd + 1);
        if (trEnd < 0) return null;
        return data.toString("utf8", trEnd + 1);
      }
    }
    if (t === "IEND") return null;
    o += 12 + n;
  }
  return null;
}
