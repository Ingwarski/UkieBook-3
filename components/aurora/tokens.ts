export const AURORA_BASELINE_ID = "AVB-UKIEBOOK-AURORA-7B-V3";

export const AURORA_TARGET_BUNDLE_HASH =
  "e50c9f82c241195d7f5d8876d9dcdcd7fd45b71cdaf6d2eedfe2e327a7182724";

export const auroraTokens = {
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
    formulaPlatform: "#F6E4D2",
    formulaPlatformText: "#9A6438",
  },
  typography: {
    ui: "Golos Text, system-ui, sans-serif",
    reading: "Literata, Georgia, serif",
  },
  radius: {
    cover: "0px",
    thumbnail: "0px",
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
} as const;

export const auroraSemanticTokens = {
  // Source-permitted AA corrections for normal-size production text and controls.
  textSubtle: "#705F55",
  accentAction: "#903CB3",
  accentActionHover: "#8431A7",
  formulaPlatformText: "#8C572C",
  controlBorder: "#9A887D",
  focusRing: "#7A359D",
  fontUiActive: '"Golos Text Variable", "Golos Text", system-ui, sans-serif',
  fontReadingActive: '"Literata Variable", Literata, Georgia, serif',
  success: "#216E4E",
  warning: "#7A4D10",
  danger: "#A3312D",
  info: "#385998",
} as const;

export const auroraCssVariables = {
  "--color-bg": auroraTokens.color.background,
  "--color-page-outer": auroraTokens.color.pageOuter,
  "--color-text": auroraTokens.color.text,
  "--color-text-muted": auroraTokens.color.textMuted,
  "--color-accent": auroraTokens.color.accent,
  "--gradient-brand": `linear-gradient(90deg, ${auroraTokens.color.gradientStart}, ${auroraTokens.color.gradientMiddle} 55%, ${auroraTokens.color.gradientEnd})`,
  "--color-glass": auroraTokens.color.glass,
  "--color-glass-strong": auroraTokens.color.glassStrong,
  "--color-hairline": auroraTokens.color.hairline,
  "--color-formula-platform": auroraTokens.color.formulaPlatform,
  "--color-formula-platform-text": auroraTokens.color.formulaPlatformText,
  "--mesh-aurora": auroraTokens.mesh.join(", "),
  "--font-ui": auroraTokens.typography.ui,
  "--font-reading": auroraTokens.typography.reading,
  "--radius-cover": auroraTokens.radius.cover,
  "--radius-thumbnail": auroraTokens.radius.thumbnail,
  "--radius-tile": auroraTokens.radius.tile,
  "--radius-formula": auroraTokens.radius.formula,
  "--radius-page": auroraTokens.radius.page,
  "--radius-pill": auroraTokens.radius.pill,
  "--shadow-cover": auroraTokens.shadow.cover,
  "--shadow-surface": auroraTokens.shadow.surface,
  "--motion-fast": auroraTokens.motion.fast,
  "--color-text-subtle": auroraSemanticTokens.textSubtle,
  "--color-accent-action": auroraSemanticTokens.accentAction,
  "--color-accent-action-hover": auroraSemanticTokens.accentActionHover,
  "--color-formula-platform-text-active": auroraSemanticTokens.formulaPlatformText,
  "--color-border-control": auroraSemanticTokens.controlBorder,
  "--color-focus-ring": auroraSemanticTokens.focusRing,
  "--font-ui-active": auroraSemanticTokens.fontUiActive,
  "--font-reading-active": auroraSemanticTokens.fontReadingActive,
  "--color-status-success": auroraSemanticTokens.success,
  "--color-status-warning": auroraSemanticTokens.warning,
  "--color-status-danger": auroraSemanticTokens.danger,
  "--color-status-info": auroraSemanticTokens.info,
} as const satisfies Record<`--${string}`, string>;
