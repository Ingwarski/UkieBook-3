import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const artworkRoot = path.join(root, "public", "books", "covers");
const outputRoot = path.join(artworkRoot, "final");

const [golosFont, literataFont] = await Promise.all([
  readFile(
    path.join(
      root,
      "node_modules",
      "@fontsource-variable",
      "golos-text",
      "files",
      "golos-text-cyrillic-wght-normal.woff2",
    ),
  ),
  readFile(
    path.join(
      root,
      "node_modules",
      "@fontsource-variable",
      "literata",
      "files",
      "literata-cyrillic-wght-normal.woff2",
    ),
  ),
]);

const fontCss = `
  @font-face {
    font-family: "Cover Sans";
    src: url(data:font/woff2;base64,${golosFont.toString("base64")}) format("woff2");
    font-weight: 100 900;
  }
  @font-face {
    font-family: "Cover Serif";
    src: url(data:font/woff2;base64,${literataFont.toString("base64")}) format("woff2");
    font-weight: 200 900;
  }
`;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleLines(lines, { anchor = "start", fill, fontFamily, fontSize, x, y }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="760" letter-spacing="-1.8">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(fontSize * 1.02)}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function coverOverlay(spec) {
  const title = titleLines(spec.titleLines, {
    anchor: spec.titleAnchor,
    fill: spec.titleColor,
    fontFamily: spec.titleFamily,
    fontSize: spec.titleSize,
    x: spec.titleX,
    y: spec.titleY,
  });
  const author = escapeXml(spec.author.toUpperCase());
  const genre = escapeXml(spec.genre.toUpperCase());
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
      <style>${fontCss}</style>
      <defs>
        <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${spec.washColor}" stop-opacity="${spec.washTop}"/>
          <stop offset="0.5" stop-color="${spec.washColor}" stop-opacity="${spec.washMiddle}"/>
          <stop offset="1" stop-color="${spec.washColor}" stop-opacity="${spec.washBottom}"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="1536" fill="url(#wash)"/>
      ${spec.accentMarkup}
      <text x="${spec.metaX}" y="${spec.metaY}" text-anchor="${spec.metaAnchor}" fill="${spec.metaColor}" font-family="Cover Sans" font-size="24" font-weight="650" letter-spacing="5">${genre}</text>
      ${title}
      <line x1="${spec.ruleX1}" y1="${spec.ruleY}" x2="${spec.ruleX2}" y2="${spec.ruleY}" stroke="${spec.ruleColor}" stroke-width="3"/>
      <text x="${spec.authorX}" y="${spec.authorY}" text-anchor="${spec.authorAnchor}" fill="${spec.authorColor}" font-family="Cover Sans" font-size="27" font-weight="620" letter-spacing="4">${author}</text>
      <text x="${spec.publisherX}" y="${spec.publisherY}" text-anchor="${spec.publisherAnchor}" fill="${spec.publisherColor}" font-family="Cover Sans" font-size="18" font-weight="700" letter-spacing="3">UKIEBOOK</text>
    </svg>
  `);
}

const covers = [
  {
    accentMarkup:
      '<circle cx="96" cy="115" r="10" fill="#f4d49b"/><line x1="120" y1="115" x2="286" y2="115" stroke="#f4d49b" stroke-width="3"/>',
    author: "Тарас Білик",
    authorAnchor: "start",
    authorColor: "#fff2d6",
    authorX: 76,
    authorY: 1420,
    file: "khroniky-stepu.png",
    genre: "Історичний роман",
    input: path.join(artworkRoot, "khroniky-stepu.png"),
    metaAnchor: "start",
    metaColor: "#f4d49b",
    metaX: 76,
    metaY: 122,
    publisherAnchor: "end",
    publisherColor: "#f4d49b",
    publisherX: 948,
    publisherY: 1420,
    ruleColor: "#f4d49b",
    ruleX1: 76,
    ruleX2: 360,
    ruleY: 1292,
    titleAnchor: "start",
    titleColor: "#fff7e8",
    titleFamily: "Cover Serif",
    titleLines: ["Хроніки", "степу"],
    titleSize: 108,
    titleX: 70,
    titleY: 720,
    washBottom: 0.67,
    washColor: "#061f26",
    washMiddle: 0.2,
    washTop: 0.22,
  },
  {
    accentMarkup:
      '<rect x="68" y="88" width="16" height="262" fill="#301f09"/><rect x="92" y="88" width="5" height="262" fill="#301f09" opacity=".55"/>',
    author: "Андрій Мельник",
    authorAnchor: "start",
    authorColor: "#2d1c08",
    authorX: 72,
    authorY: 1406,
    file: "lysty-z-poltavy.png",
    genre: "Нонфікшн",
    input: path.join(artworkRoot, "lysty-z-poltavy.png"),
    metaAnchor: "start",
    metaColor: "#2d1c08",
    metaX: 120,
    metaY: 120,
    publisherAnchor: "end",
    publisherColor: "#2d1c08",
    publisherX: 946,
    publisherY: 1406,
    ruleColor: "#2d1c08",
    ruleX1: 70,
    ruleX2: 468,
    ruleY: 1222,
    titleAnchor: "start",
    titleColor: "#241706",
    titleFamily: "Cover Sans",
    titleLines: ["Листи", "з Полтави"],
    titleSize: 96,
    titleX: 68,
    titleY: 480,
    washBottom: 0.08,
    washColor: "#f3bf28",
    washMiddle: 0.03,
    washTop: 0.05,
  },
  {
    accentMarkup:
      '<rect x="72" y="114" width="880" height="3" fill="#dbe7ff" opacity=".9"/><rect x="72" y="126" width="460" height="1" fill="#dbe7ff" opacity=".55"/>',
    author: "Олег Данилюк",
    authorAnchor: "end",
    authorColor: "#e7efff",
    authorX: 944,
    authorY: 1405,
    file: "misto-na-vodi.png",
    genre: "Роман",
    input: path.join(artworkRoot, "misto-na-vodi.png"),
    metaAnchor: "start",
    metaColor: "#e7efff",
    metaX: 72,
    metaY: 99,
    publisherAnchor: "start",
    publisherColor: "#e7efff",
    publisherX: 72,
    publisherY: 1405,
    ruleColor: "#e7efff",
    ruleX1: 570,
    ruleX2: 944,
    ruleY: 1304,
    titleAnchor: "middle",
    titleColor: "#ffffff",
    titleFamily: "Cover Serif",
    titleLines: ["Місто", "на воді"],
    titleSize: 102,
    titleX: 512,
    titleY: 700,
    washBottom: 0.55,
    washColor: "#081a52",
    washMiddle: 0.05,
    washTop: 0.04,
  },
  {
    accentMarkup:
      '<rect x="216" y="355" width="592" height="490" fill="#f8e4d5" opacity=".82"/><path d="M246 390h532M246 810h532" stroke="#7b2f2b" stroke-width="3" opacity=".7"/>',
    author: "Ірина Верес",
    authorAnchor: "middle",
    authorColor: "#fff1e7",
    authorX: 512,
    authorY: 1422,
    file: "sad-kamianykh-ptakhiv.png",
    genre: "Роман",
    input: path.join(artworkRoot, "sad-kamianykh-ptakhiv.png"),
    metaAnchor: "middle",
    metaColor: "#fff1e7",
    metaX: 512,
    metaY: 118,
    publisherAnchor: "middle",
    publisherColor: "#7b2f2b",
    publisherX: 512,
    publisherY: 795,
    ruleColor: "#fff1e7",
    ruleX1: 382,
    ruleX2: 642,
    ruleY: 1310,
    titleAnchor: "middle",
    titleColor: "#6e2825",
    titleFamily: "Cover Serif",
    titleLines: ["Сад", "камʼяних", "птахів"],
    titleSize: 82,
    titleX: 512,
    titleY: 500,
    washBottom: 0.28,
    washColor: "#5c1819",
    washMiddle: 0.04,
    washTop: 0.2,
  },
  {
    accentMarkup:
      '<text x="78" y="324" fill="#f7d4a7" font-family="Cover Serif" font-size="180" font-weight="260" opacity=".56">08</text><line x1="80" y1="350" x2="450" y2="350" stroke="#f7d4a7" stroke-width="2"/>',
    author: "Соломія Гнатюк",
    authorAnchor: "start",
    authorColor: "#f8e8f4",
    authorX: 80,
    authorY: 1414,
    file: "piznie-lito.png",
    genre: "Поезія",
    input: path.join(artworkRoot, "piznie-lito.png"),
    metaAnchor: "end",
    metaColor: "#f8e8f4",
    metaX: 944,
    metaY: 112,
    publisherAnchor: "end",
    publisherColor: "#f8e8f4",
    publisherX: 944,
    publisherY: 1414,
    ruleColor: "#f7d4a7",
    ruleX1: 80,
    ruleX2: 320,
    ruleY: 1260,
    titleAnchor: "start",
    titleColor: "#fff7fd",
    titleFamily: "Cover Serif",
    titleLines: ["Пізнє", "літо"],
    titleSize: 122,
    titleX: 72,
    titleY: 720,
    washBottom: 0.58,
    washColor: "#241049",
    washMiddle: 0.08,
    washTop: 0.05,
  },
  {
    accentMarkup:
      '<circle cx="512" cy="770" r="252" fill="none" stroke="#eaf1ff" stroke-width="2" opacity=".62"/><circle cx="512" cy="770" r="222" fill="none" stroke="#eaf1ff" stroke-width="1" opacity=".42"/>',
    author: "Леся Романюк",
    authorAnchor: "middle",
    authorColor: "#eef3ff",
    authorX: 512,
    authorY: 1414,
    file: "kryzhani-maky.png",
    genre: "Фентезі",
    input: path.join(artworkRoot, "kryzhani-maky.png"),
    metaAnchor: "middle",
    metaColor: "#eef3ff",
    metaX: 512,
    metaY: 108,
    publisherAnchor: "middle",
    publisherColor: "#dbe5ff",
    publisherX: 512,
    publisherY: 1310,
    ruleColor: "#dbe5ff",
    ruleX1: 392,
    ruleX2: 632,
    ruleY: 1248,
    titleAnchor: "middle",
    titleColor: "#ffffff",
    titleFamily: "Cover Serif",
    titleLines: ["Крижані", "маки"],
    titleSize: 104,
    titleX: 512,
    titleY: 720,
    washBottom: 0.52,
    washColor: "#071d62",
    washMiddle: 0.12,
    washTop: 0.18,
  },
  {
    accentMarkup:
      '<line x1="76" y1="356" x2="948" y2="356" stroke="#f4d9ac" stroke-width="2" opacity=".78"/><circle cx="512" cy="356" r="7" fill="#f4d9ac"/>',
    author: "Марко Яворський",
    authorAnchor: "end",
    authorColor: "#f5e5c8",
    authorX: 944,
    authorY: 1412,
    file: "tini-nad-lymanom.png",
    genre: "Роман",
    input: path.join(artworkRoot, "tini-nad-lymanom.png"),
    metaAnchor: "start",
    metaColor: "#f5e5c8",
    metaX: 76,
    metaY: 116,
    publisherAnchor: "start",
    publisherColor: "#f5e5c8",
    publisherX: 76,
    publisherY: 1412,
    ruleColor: "#f4d9ac",
    ruleX1: 618,
    ruleX2: 944,
    ruleY: 1300,
    titleAnchor: "middle",
    titleColor: "#fff0d4",
    titleFamily: "Cover Serif",
    titleLines: ["Тіні", "над лиманом"],
    titleSize: 94,
    titleX: 512,
    titleY: 620,
    washBottom: 0.62,
    washColor: "#061923",
    washMiddle: 0.18,
    washTop: 0.16,
  },
];

await mkdir(outputRoot, { recursive: true });

for (const cover of covers) {
  const output = path.join(outputRoot, cover.file);
  await sharp(cover.input)
    .resize(1024, 1536, { fit: "cover" })
    .composite([{ input: coverOverlay(cover), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(path.relative(root, output));
}

async function createTransparentLogoSvg() {
  const input = path.join(root, "UkieBook-logo.jpg");
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < info.width * info.height; index += 1) {
    const red = data[index * info.channels];
    const green = data[index * info.channels + 1];
    const blue = data[index * info.channels + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const alpha = Math.max(0, Math.min(255, Math.round(((244 - luminance) / 219) * 255)));
    rgba[index * 4] = 0;
    rgba[index * 4 + 1] = 0;
    rgba[index * 4 + 2] = 0;
    rgba[index * 4 + 3] = alpha;
  }
  const transparentPng = await sharp(rgba, {
    raw: { channels: 4, height: info.height, width: info.width },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${info.width} ${info.height}" width="${info.width}" height="${info.height}">\n  <title>UkieBook</title>\n  <image width="${info.width}" height="${info.height}" href="data:image/png;base64,${transparentPng.toString("base64")}" xlink:href="data:image/png;base64,${transparentPng.toString("base64")}"/>\n</svg>\n`;
  await Promise.all([
    writeFile(path.join(root, "UkieBook-logo-transparent.svg"), svg, "utf8"),
    writeFile(path.join(root, "public", "brand", "UkieBook-logo-transparent.svg"), svg, "utf8"),
  ]);
  console.log("UkieBook-logo-transparent.svg");
  console.log("public/brand/UkieBook-logo-transparent.svg");
}

await createTransparentLogoSvg();
