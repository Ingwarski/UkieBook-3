export type SupportedRasterMediaType =
  | "image/gif"
  | "image/jpeg"
  | "image/png";

export interface RasterImageReceipt {
  readonly height: number;
  readonly mediaType: SupportedRasterMediaType;
  readonly width: number;
}

export class InvalidRasterImageError extends Error {
  readonly code = "INVALID_RASTER_IMAGE" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidRasterImageError";
  }
}

const MAX_RASTER_DIMENSION = 20_000;
const MAX_RASTER_PIXELS = 40_000_000;

function requireSafeDimensions(
  mediaType: SupportedRasterMediaType,
  width: number,
  height: number,
): RasterImageReceipt {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_RASTER_DIMENSION ||
    height > MAX_RASTER_DIMENSION ||
    width * height > MAX_RASTER_PIXELS
  ) {
    throw new InvalidRasterImageError(
      `Raster dimensions are invalid or exceed the conversion limit: ${width}x${height}`,
    );
  }
  return { height, mediaType, width };
}

function inspectPng(buffer: Buffer): RasterImageReceipt | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    return null;
  }
  if (
    buffer.readUInt32BE(8) !== 13 ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new InvalidRasterImageError("PNG does not begin with a valid IHDR chunk");
  }
  return requireSafeDimensions(
    "image/png",
    buffer.readUInt32BE(16),
    buffer.readUInt32BE(20),
  );
}

function inspectGif(buffer: Buffer): RasterImageReceipt | null {
  if (buffer.length < 10) {
    return null;
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }
  return requireSafeDimensions(
    "image/gif",
    buffer.readUInt16LE(6),
    buffer.readUInt16LE(8),
  );
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function inspectJpeg(buffer: Buffer): RasterImageReceipt | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let cursor = 2;
  while (cursor + 1 < buffer.length) {
    while (cursor < buffer.length && buffer[cursor] !== 0xff) {
      cursor += 1;
    }
    while (cursor < buffer.length && buffer[cursor] === 0xff) {
      cursor += 1;
    }
    if (cursor >= buffer.length) {
      break;
    }
    const marker = buffer[cursor]!;
    cursor += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (cursor + 2 > buffer.length) {
      break;
    }
    const segmentLength = buffer.readUInt16BE(cursor);
    if (segmentLength < 2 || cursor + segmentLength > buffer.length) {
      throw new InvalidRasterImageError("JPEG contains an invalid segment length");
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) {
        throw new InvalidRasterImageError("JPEG start-of-frame segment is truncated");
      }
      return requireSafeDimensions(
        "image/jpeg",
        buffer.readUInt16BE(cursor + 5),
        buffer.readUInt16BE(cursor + 3),
      );
    }
    cursor += segmentLength;
  }
  throw new InvalidRasterImageError("JPEG has no supported start-of-frame segment");
}

export function inspectRasterImage(input: Uint8Array): RasterImageReceipt {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length === 0) {
    throw new InvalidRasterImageError("Raster image is empty");
  }
  const inspection =
    inspectPng(buffer) ?? inspectGif(buffer) ?? inspectJpeg(buffer);
  if (!inspection) {
    throw new InvalidRasterImageError(
      "Only bounded PNG, JPEG, and GIF images are supported",
    );
  }
  return inspection;
}
