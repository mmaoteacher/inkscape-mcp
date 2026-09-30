import { openSync, readSync, closeSync } from "fs";

export interface RasterSize {
  width: number;
  height: number;
}

/**
 * Read intrinsic pixel dimensions straight from the raster header.
 * Only the header is read, so this stays cheap for large images.
 * Returns null for formats we cannot parse (SVG, PDF, ...).
 */
export function readRasterSize(filePath: string): RasterSize | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const head = Buffer.alloc(64 * 1024);
    const read = readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, read);

    // PNG: 8-byte signature, then an IHDR chunk whose payload starts at byte 16.
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // GIF: "GIF87a"/"GIF89a", dimensions are little-endian uint16 at 6 and 8.
    if (buf.length > 10 && buf.subarray(0, 3).toString("latin1") === "GIF") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }

    // BMP: "BM", DIB header at 14; width/height are int32 at 18 and 22.
    if (buf.length > 26 && buf.subarray(0, 2).toString("latin1") === "BM") {
      return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
    }

    // JPEG: walk the marker segments until a SOFn frame header is found.
    if (buf.length > 4 && buf.readUInt16BE(0) === 0xffd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0-SOF15, excluding DHT(c4), JPGA(c8) and DAC(cc).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}
