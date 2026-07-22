import { inflateRawSync } from "node:zlib";

import { ZipArchiveError } from "./errors";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_535 + 22;

export interface ZipArchiveLimits {
  readonly maxEntries?: number;
  readonly maxEntryBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface ZipEntry {
  readonly bytes: Uint8Array;
  readonly compressionMethod: 0 | 8;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly name: string;
}

export interface ZipArchive {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  readonly orderedEntries: readonly ZipEntry[];
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function calculateCrc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function asBuffer(input: Uint8Array): Buffer {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset + 22 <= buffer.length
    ) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) {
        return offset;
      }
    }
  }
  throw new ZipArchiveError("ZIP end-of-central-directory record is missing");
}

function assertRange(
  buffer: Buffer,
  offset: number,
  length: number,
  description: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new ZipArchiveError(`ZIP ${description} is outside the archive bounds`);
  }
}

function normalizeEntryName(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    segments.some((segment) => segment === ".." || segment.includes("\0"))
  ) {
    throw new ZipArchiveError(`Unsafe ZIP entry name: ${value}`);
  }
  return normalized;
}

export function readZipArchive(
  input: Uint8Array,
  limits: ZipArchiveLimits = {},
): ZipArchive {
  const maxEntries = limits.maxEntries ?? 2_048;
  const maxEntryBytes = limits.maxEntryBytes ?? 32 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 128 * 1024 * 1024;
  const buffer = asBuffer(input);
  const endOffset = findEndOfCentralDirectory(buffer);
  assertRange(buffer, endOffset, 22, "end-of-central-directory record");

  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipArchiveError("Multi-disk ZIP archives are not supported");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipArchiveError("ZIP64 archives are not supported for manuscripts");
  }
  if (entryCount > maxEntries) {
    throw new ZipArchiveError(`ZIP entry limit exceeded (${entryCount} > ${maxEntries})`);
  }
  assertRange(buffer, centralOffset, centralSize, "central directory");
  if (centralOffset + centralSize > endOffset) {
    throw new ZipArchiveError("ZIP central directory overlaps its end record");
  }

  const entries = new Map<string, ZipEntry>();
  const orderedEntries: ZipEntry[] = [];
  let cursor = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(buffer, cursor, 46, "central-directory entry");
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipArchiveError("ZIP central-directory signature is invalid");
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const centralEntryLength = 46 + nameLength + extraLength + commentLength;
    assertRange(buffer, cursor, centralEntryLength, "central-directory entry data");

    if ((flags & 0x1) !== 0) {
      throw new ZipArchiveError("Encrypted ZIP entries are not supported");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipArchiveError(
        `ZIP compression method ${compressionMethod} is not supported`,
      );
    }
    if (uncompressedSize > maxEntryBytes) {
      throw new ZipArchiveError(
        `ZIP entry size limit exceeded (${uncompressedSize} > ${maxEntryBytes})`,
      );
    }
    totalBytes += uncompressedSize;
    if (totalBytes > maxTotalBytes) {
      throw new ZipArchiveError(
        `ZIP expanded-size limit exceeded (${totalBytes} > ${maxTotalBytes})`,
      );
    }

    const rawName = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    const name = normalizeEntryName(rawName);
    if (entries.has(name)) {
      throw new ZipArchiveError(`Duplicate ZIP entry: ${name}`);
    }

    assertRange(buffer, localHeaderOffset, 30, `local header for ${name}`);
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new ZipArchiveError(`ZIP local-header signature is invalid for ${name}`);
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localCrc = buffer.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    assertRange(
      buffer,
      localHeaderOffset + 30,
      localNameLength + localExtraLength,
      `local metadata for ${name}`,
    );
    const localName = normalizeEntryName(
      buffer
        .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)
        .toString("utf8"),
    );
    if (
      localName !== name ||
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod
    ) {
      throw new ZipArchiveError(
        `ZIP local and central metadata do not match for ${name}`,
      );
    }
    if (
      (flags & 0x8) === 0 &&
      (localCrc !== expectedCrc ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize)
    ) {
      throw new ZipArchiveError(
        `ZIP local sizes or CRC-32 do not match for ${name}`,
      );
    }
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    assertRange(buffer, dataOffset, compressedSize, `compressed data for ${name}`);
    if (dataOffset + compressedSize > centralOffset) {
      throw new ZipArchiveError(`ZIP entry data overlaps the central directory: ${name}`);
    }
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

    let expanded: Buffer;
    try {
      expanded =
        compressionMethod === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: maxEntryBytes });
    } catch (error) {
      throw new ZipArchiveError(`Could not expand ZIP entry ${name}`, {
        cause: error,
      });
    }
    if (expanded.length !== uncompressedSize) {
      throw new ZipArchiveError(`ZIP entry size does not match for ${name}`);
    }
    if (calculateCrc32(expanded) !== expectedCrc) {
      throw new ZipArchiveError(`ZIP CRC-32 does not match for ${name}`);
    }

    const entry: ZipEntry = {
      bytes: new Uint8Array(expanded),
      compressionMethod,
      crc32: expectedCrc,
      localHeaderOffset,
      name,
    };
    entries.set(name, entry);
    orderedEntries.push(entry);
    cursor += centralEntryLength;
  }

  if (cursor !== centralOffset + centralSize) {
    throw new ZipArchiveError("ZIP central-directory size does not match its entries");
  }

  return { entries, orderedEntries };
}
