/**
 * High-Performance Pure JavaScript ZIP Archive Builder
 * Uses browser-native CompressionStream('deflate-raw') and CRC32.
 * Zero external dependencies.
 */

class ZipBuilder {
  constructor() {
    this.files = [];
  }

  // CRC32 table
  static crcTable = (() => {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  static calculateCrc32(uint8Array) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < uint8Array.length; i++) {
      crc = (crc >>> 8) ^ ZipBuilder.crcTable[(crc ^ uint8Array[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  // Compress data using browser's native CompressionStream
  static async deflate(uint8Array) {
    if (typeof CompressionStream === 'function') {
      try {
        const stream = new Blob([uint8Array]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const response = new Response(stream);
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (e) {}
    }
    // Fallback: stored without compression
    return uint8Array;
  }

  /**
   * Add file to archive
   * @param {string} filename 
   * @param {Uint8Array|ArrayBuffer|Blob|string} data 
   */
  async addFile(filename, data) {
    let bytes;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (data instanceof Blob) {
      const buf = await data.arrayBuffer();
      bytes = new Uint8Array(buf);
    } else if (typeof data === 'string') {
      // Data URI
      if (data.startsWith('data:')) {
        const base64 = data.split(',')[1];
        const binary = atob(base64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
      } else {
        bytes = new TextEncoder().encode(data);
      }
    } else {
      bytes = new Uint8Array(0);
    }

    const uncompressedSize = bytes.length;
    const crc = ZipBuilder.calculateCrc32(bytes);
    
    // Deflate compress
    let compressedBytes = await ZipBuilder.deflate(bytes);
    let compressionMethod = 8; // Deflate

    // If compression didn't save space or was not supported, use store (method 0)
    if (compressedBytes.length >= uncompressedSize) {
      compressedBytes = bytes;
      compressionMethod = 0; // Stored
    }

    const encFilename = new TextEncoder().encode(filename);

    this.files.push({
      filename: encFilename,
      compressedBytes,
      uncompressedSize,
      compressedSize: compressedBytes.length,
      crc,
      compressionMethod
    });
  }

  /**
   * Build complete ZIP as a Blob
   * @param {Function} onProgress optional callback (percent)
   * @returns {Promise<Blob>}
   */
  async generateAsync(onProgress) {
    const localHeaders = [];
    const centralEntries = [];
    let offset = 0;

    const total = this.files.length;

    for (let idx = 0; idx < total; idx++) {
      const file = this.files[idx];

      // Local File Header (30 bytes + filename)
      const localHeader = new Uint8Array(30 + file.filename.length);
      const lv = new DataView(localHeader.buffer);

      lv.setUint32(0, 0x04034B50, true); // Local file header signature
      lv.setUint16(4, 20, true);         // Version needed (2.0)
      lv.setUint16(6, 0, true);          // General purpose bit flag
      lv.setUint16(8, file.compressionMethod, true); // Compression method
      lv.setUint16(10, 0x546B, true);    // Last mod file time (dummy valid time)
      lv.setUint16(12, 0x546B, true);    // Last mod file date
      lv.setUint32(14, file.crc, true);  // CRC-32
      lv.setUint32(18, file.compressedSize, true);   // Compressed size
      lv.setUint32(22, file.uncompressedSize, true); // Uncompressed size
      lv.setUint16(26, file.filename.length, true);  // Filename length
      lv.setUint16(28, 0, true);         // Extra field length
      localHeader.set(file.filename, 30);

      // Central Directory Entry (46 bytes + filename)
      const centralEntry = new Uint8Array(46 + file.filename.length);
      const cv = new DataView(centralEntry.buffer);

      cv.setUint32(0, 0x02014B50, true); // Central file header signature
      cv.setUint16(4, 20, true);         // Version made by
      cv.setUint16(6, 20, true);         // Version needed
      cv.setUint16(8, 0, true);          // General purpose bit flag
      cv.setUint16(10, file.compressionMethod, true); // Compression method
      cv.setUint16(12, 0x546B, true);    // Last mod time
      cv.setUint16(14, 0x546B, true);    // Last mod date
      cv.setUint32(16, file.crc, true);  // CRC-32
      cv.setUint32(20, file.compressedSize, true);   // Compressed size
      cv.setUint32(24, file.uncompressedSize, true); // Uncompressed size
      cv.setUint16(28, file.filename.length, true);  // Filename length
      cv.setUint16(30, 0, true);         // Extra field length
      cv.setUint16(32, 0, true);         // File comment length
      cv.setUint16(34, 0, true);         // Disk number start
      cv.setUint16(36, 0, true);         // Internal file attributes
      cv.setUint32(38, 0, true);         // External file attributes
      cv.setUint32(42, offset, true);    // Relative offset of local header
      centralEntry.set(file.filename, 46);

      localHeaders.push(localHeader, file.compressedBytes);
      centralEntries.push(centralEntry);

      offset += localHeader.length + file.compressedBytes.length;

      if (onProgress) {
        onProgress(Math.round(((idx + 1) / total) * 100));
      }
    }

    // End of Central Directory Record (22 bytes)
    const centralSize = centralEntries.reduce((sum, e) => sum + e.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);

    ev.setUint32(0, 0x06054B50, true); // End of central dir signature
    ev.setUint16(4, 0, true);          // Number of this disk
    ev.setUint16(6, 0, true);          // Disk where central directory starts
    ev.setUint16(8, total, true);      // Number of central directory records on this disk
    ev.setUint16(10, total, true);     // Total number of central directory records
    ev.setUint32(12, centralSize, true); // Size of central directory
    ev.setUint32(16, offset, true);    // Offset of start of central directory
    ev.setUint16(20, 0, true);         // Comment length

    const allBlobs = [...localHeaders, ...centralEntries, eocd];
    return new Blob(allBlobs, { type: 'application/zip' });
  }
}

if (typeof window !== 'undefined') {
  window.ZipBuilder = ZipBuilder;
}
if (typeof module !== 'undefined') {
  module.exports = ZipBuilder;
}
