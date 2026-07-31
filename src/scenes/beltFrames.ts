/**
 * The belt's scrolling-chevron loop, named. Pure and free of Phaser so both the
 * texture generator (BootScene) and anything that has to reason about belt art
 * without a running game — the 3D view's model table, the tests — can share one
 * definition instead of two that drift.
 */

/** Frames in the scrolling belt loop. */
export const BELT_FRAMES = 4;

/** Texture keys of the belt loop, in play order: `belt`, `belt1`…`belt3`. */
export const BELT_FRAME_KEYS = Array.from({ length: BELT_FRAMES }, (_, i) => (i === 0 ? 'belt' : `belt${i}`));
