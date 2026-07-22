import type {
  DocxManuscriptSource,
  GoogleDocsExportSource,
  ManuscriptMetadata,
  TxtManuscriptSource,
} from "../../../modules/publishing/conversion/types";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function calculateCrc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface FixtureZipEntry {
  readonly bytes: Uint8Array;
  readonly name: string;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function createStoredZip(entries: readonly FixtureZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const crc = calculateCrc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(bytes.length, 18);
    localHeader.writeUInt32LE(bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, bytes);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(bytes.length, 20);
    centralHeader.writeUInt32LE(bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, end]));
}

export const ukrainianMetadata: ManuscriptMetadata = {
  authorName: "Олена Вітрова",
  language: "uk",
  title: "Ніч над Дніпром",
};

export const inlineIllustrationPng = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsWQAAAAASUVORK5CYII=",
    "base64",
  ),
);

export function txtManuscriptFixture(): TxtManuscriptSource {
  return {
    artifactVersion: 1,
    bytes: utf8(
      '\uFEFF# Розділ 1\r\n\r\n\r\n  "Київська ніч"  -  тиха.\r\nДругий рядок.\r\n\r\nФінал.  ',
    ),
    fileName: "nich-nad-dniprom.txt",
    kind: "txt",
    mediaType: "text/plain",
  };
}

export function docxBytesFixture(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="png" ContentType="image/png" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml" />
</Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/illustration.png" />
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1" /></w:pPr><w:r><w:t>Розділ 1</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">  "Київська ніч"  -  тиха. </w:t></w:r>
      <w:r><w:drawing><wp:inline><wp:docPr id="1" name="Калина" descr="Гілка калини над Дніпром" /><a:graphic><a:graphicData><a:blip r:embed="rIdImage1" /></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
      <w:r><w:t>Після ілюстрації.</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Фінальний абзац рукопису.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
  return createStoredZip([
    { bytes: utf8(contentTypes), name: "[Content_Types].xml" },
    { bytes: utf8(rootRelationships), name: "_rels/.rels" },
    { bytes: utf8(document), name: "word/document.xml" },
    {
      bytes: utf8(documentRelationships),
      name: "word/_rels/document.xml.rels",
    },
    { bytes: inlineIllustrationPng, name: "word/media/illustration.png" },
  ]);
}

export function docxManuscriptFixture(): DocxManuscriptSource {
  return {
    artifactVersion: 1,
    bytes: docxBytesFixture(),
    fileName: "nich-nad-dniprom.docx",
    kind: "docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export function googleDocsExportFixture(): GoogleDocsExportSource {
  return {
    artifactVersion: 1,
    bytes: docxBytesFixture(),
    documentId: "google-docs-ukiebook-fixture",
    exportFormat: "docx",
    fileName: "nich-nad-dniprom-google-docs.docx",
    kind: "google-docs-export",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    revisionId: "revision-7",
  };
}

export function validEpubFixture(): Uint8Array {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`;
  const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">fixture</dc:identifier><dc:title>Ніч над Дніпром</dc:title><dc:language>uk</dc:language></metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="image" href="images/illustration.png" media-type="image/png" />
  </manifest>
  <spine><itemref idref="chapter" /></spine>
</package>`;
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="uk"><head><title>Розділ 1</title></head><body><h1>Розділ 1</h1><p>Київська ніч — тиха.</p><img src="images/illustration.png" alt="Гілка калини" /></body></html>`;
  return createStoredZip([
    { bytes: utf8("application/epub+zip"), name: "mimetype" },
    { bytes: utf8(container), name: "META-INF/container.xml" },
    { bytes: utf8(packageDocument), name: "OEBPS/content.opf" },
    { bytes: utf8(chapter), name: "OEBPS/chapter.xhtml" },
    { bytes: inlineIllustrationPng, name: "OEBPS/images/illustration.png" },
  ]);
}

export function validLegacyMobiFixture(): Uint8Array {
  const recordCount = 1;
  const firstRecordOffset = 78 + recordCount * 8 + 2;
  const buffer = Buffer.alloc(firstRecordOffset + 128);
  buffer.write("UkieBook conversion fixture", 0, "ascii");
  buffer.write("BOOKMOBI", 60, "ascii");
  buffer.writeUInt16BE(recordCount, 76);
  buffer.writeUInt32BE(firstRecordOffset, 78);
  buffer.write("MOBI", firstRecordOffset + 16, "ascii");
  return new Uint8Array(buffer);
}
