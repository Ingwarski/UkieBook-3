import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AURORA_BASELINE_ID,
  AURORA_TARGET_BUNDLE_HASH,
  auroraCssVariables,
  auroraSemanticTokens,
  auroraTokens,
} from "../../components/aurora/tokens";

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Aurora V2 token contract", () => {
  it("pins the approved baseline identity", () => {
    expect(AURORA_BASELINE_ID).toBe("AVB-UKIEBOOK-AURORA-7B-V2");
    expect(AURORA_TARGET_BUNDLE_HASH).toBe(
      "c66b23c55e68649e67e029d47c8e69d3bef3791f8c4c6677aa0a6cef2259c51d",
    );
  });

  it("matches the immutable source values from the Design Spine", () => {
    expect(auroraTokens).toEqual({
      color: {
        background: "#FFF7F3",
        pageOuter: "#ECE7E2",
        text: "#2E2621",
        textMuted: "#857468",
        accent: "#B26BD6",
        gradientStart: "#E08AB0",
        gradientMiddle: "#B26BD6",
        gradientEnd: "#E8A04B",
        glass: "rgba(255,255,255,.70)",
        glassStrong: "rgba(255,255,255,.80)",
        hairline: "rgba(46,38,33,.06)",
        formulaTax: "#F7E7DE",
        formulaPlatform: "#F6E4D2",
        formulaPlatformText: "#9A6438",
      },
      typography: {
        ui: "Golos Text, system-ui, sans-serif",
        reading: "Literata, Georgia, serif",
      },
      radius: {
        cover: "16px",
        thumbnail: "12px",
        tile: "22px",
        formula: "26px",
        page: "14px",
        pill: "999px",
      },
      shadow: {
        cover: "0 24px 44px rgba(178,107,214,.24)",
        surface: "0 8px 22px rgba(178,107,214,.10)",
      },
      motion: {
        fast: "180ms ease-out",
      },
      mesh: [
        "radial-gradient(560px 360px at 15% 0%, rgba(255,190,160,.60), transparent 68%)",
        "radial-gradient(600px 380px at 85% 4%, rgba(197,178,255,.50), transparent 68%)",
        "radial-gradient(520px 340px at 52% 42%, rgba(255,214,170,.50), transparent 68%)",
      ],
    });
  });

  it("keeps CSS custom properties synchronized with the TypeScript export", () => {
    const tokenCss = readFileSync(
      new URL("../../components/aurora/tokens.css", import.meta.url),
      "utf8",
    );

    for (const [name, value] of Object.entries(auroraCssVariables)) {
      if (name === "--mesh-aurora") {
        for (const gradient of auroraTokens.mesh) expect(tokenCss).toContain(gradient);
        continue;
      }
      expect(tokenCss).toContain(`${name}: ${value};`);
    }
  });

  it("uses AA semantic aliases where source colors are too light for normal text", () => {
    expect(contrastRatio("#FFFFFF", auroraSemanticTokens.accentAction)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(auroraSemanticTokens.textSubtle, auroraTokens.color.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(auroraSemanticTokens.controlBorder, auroraTokens.color.background)).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      contrastRatio(
        auroraSemanticTokens.formulaPlatformText,
        auroraTokens.color.formulaPlatform,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
