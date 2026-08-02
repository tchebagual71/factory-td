export interface MenuLayoutOptions {
  gameW: number;
  gameH: number;
  touch: boolean;
  hasSave: boolean;
}

export interface MenuLayout {
  compact: boolean;
  cameraZoom: number;
  designW: number;
  designH: number;
  title: { y: number; size: number };
  subtitle: { y: number; size: number };
  view: { labelSize: number };
  account: { labelSize: number; buttonSize: number };
  main: {
    continueY: number | null;
    newRunY: number;
    actionsY: number;
    secondaryY: number;
    buttonH: number;
    fullLabelSize: number;
    halfLabelSize: number;
  };
  map: { y: number; headingSize: number; labelSize: number; blurbSize: number };
  settings: { y: number; labelSize: number };
  best: { y: number; size: number };
  footer: { y: number; size: number; short: boolean };
}

const FALLBACK_W = 1280;
const FALLBACK_H = 720;

/** Physical CSS-pixel type size after the scene camera and Phaser FIT scaling. */
export function renderedFontSize(logicalSize: number, cameraZoom: number, fitScale: number): number {
  if (![logicalSize, cameraZoom, fitScale].every(Number.isFinite)) return 0;
  return Math.max(0, logicalSize * cameraZoom * fitScale);
}

/**
 * Main-menu geometry and typography.
 *
 * The roomy branch is the established 720px composition. The compact branch
 * lays out directly in the phone canvas instead of shrinking that composition
 * through a second camera transform, which is what turned 11px copy into 6px.
 */
export function menuLayout({ gameW, gameH, touch, hasSave }: MenuLayoutOptions): MenuLayout {
  const valid = [gameW, gameH].every(Number.isFinite) && gameW > 0 && gameH > 0;
  const designW = valid ? gameW : FALLBACK_W;
  const designH = valid ? gameH : FALLBACK_H;
  const compact = valid && touch && designH < FALLBACK_H;

  if (!compact) {
    const top = Math.round((designH - FALLBACK_H) / 2);
    const first = top + 265;
    const continueY = hasSave ? first : null;
    const newRunY = hasSave ? first + 62 : first;
    const actionsY = newRunY + 62;
    const secondaryY = actionsY + 62;
    const mapY = secondaryY + 74;
    return {
      compact: false,
      cameraZoom: 1,
      designW,
      designH,
      title: { y: top + 130, size: 64 },
      subtitle: { y: top + 185, size: 15 },
      view: { labelSize: 12 },
      account: { labelSize: 13, buttonSize: 12 },
      main: {
        continueY,
        newRunY,
        actionsY,
        secondaryY,
        buttonH: 50,
        fullLabelSize: 16,
        halfLabelSize: 14,
      },
      map: { y: mapY, headingSize: 11, labelSize: 13, blurbSize: 11 },
      settings: { y: mapY + 88, labelSize: 12 },
      best: { y: mapY + 128, size: 14 },
      footer: { y: designH - 26, size: 11, short: false },
    };
  }

  const veryShort = designH < 560;
  const first = Math.max(120, Math.min(150, designH - 440));
  const continueY = hasSave ? first : null;
  const newRunY = hasSave ? first + 52 : first;
  const actionsY = newRunY + 52;
  const secondaryY = actionsY + 52;

  return {
    compact: true,
    cameraZoom: 1,
    designW,
    designH,
    title: { y: veryShort ? 50 : 68, size: veryShort ? 40 : 48 },
    subtitle: { y: veryShort ? 82 : 108, size: veryShort ? 16 : 18 },
    view: { labelSize: 18 },
    account: { labelSize: 18, buttonSize: 18 },
    main: {
      continueY,
      newRunY,
      actionsY,
      secondaryY,
      buttonH: 46,
      fullLabelSize: 18,
      halfLabelSize: 18,
    },
    map: { y: designH - 165, headingSize: 14, labelSize: 18, blurbSize: 14 },
    settings: { y: designH - 82, labelSize: 14 },
    best: { y: designH - 48, size: 18 },
    footer: { y: designH - 18, size: 14, short: true },
  };
}
