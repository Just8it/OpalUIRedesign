const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let j = 0; j < 8; j++) {
            c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
        }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
    const typeBuf = Buffer.from(type);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length);
    const combined = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(combined));
    return Buffer.concat([lenBuf, combined, crcBuf]);
}

function makePNG(size) {
    const rows = [];
    for (let y = 0; y < size; y++) {
        const row = Buffer.alloc(1 + size * 4, 0);
        row[0] = 0; // filter byte
        for (let x = 0; x < size; x++) {
            const i = 1 + x * 4;
            const cx = x - size / 2;
            const cy = y - size / 2;
            const d = Math.sqrt(cx * cx + cy * cy);
            // Diamond shape
            const dm = Math.abs(cx) + Math.abs(cy);
            if (dm < size * 0.32) {
                // Accent blue center
                row[i] = 108; row[i + 1] = 138; row[i + 2] = 255; row[i + 3] = 255;
            } else if (dm < size * 0.38) {
                // Soft purple edge
                row[i] = 167; row[i + 1] = 139; row[i + 2] = 250; row[i + 3] = 200;
            } else {
                // Dark bg
                row[i] = 11; row[i + 1] = 13; row[i + 2] = 20; row[i + 3] = 255;
            }
        }
        rows.push(row);
    }

    const rawData = Buffer.concat(rows);
    const compressed = zlib.deflateSync(rawData);

    // IHDR chunk data
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const png = Buffer.concat([
        signature,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', compressed),
        makeChunk('IEND', Buffer.alloc(0)),
    ]);

    return png;
}

[16, 48, 128].forEach(size => {
    const path = `icons/icon-${size}.png`;
    fs.writeFileSync(path, makePNG(size));
    console.log(`Created ${path} (${fs.statSync(path).size} bytes)`);
});

console.log('Done!');
