import Phaser from 'phaser';
import { BELT_FRAMES } from './beltFrames';

// Re-exported so every existing importer keeps its one-stop `BootScene` import,
// while the definitions themselves stay in a Phaser-free module.
export { BELT_FRAMES, BELT_FRAME_KEYS } from './beltFrames';

/** Generates every texture procedurally — zero asset files. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const g = this.add.graphics();

    // Belt: dark base + chevrons pointing East (rotation 0 = East everywhere).
    // Four frames with the chevrons marched 8px along the belt; played back in
    // order they read as a running conveyor, which is the single strongest cue
    // that the factory is alive. Frame 0 doubles as the static palette icon.
    for (let f = 0; f < BELT_FRAMES; f++) {
      const shift = f * (16 / BELT_FRAMES);
      g.fillStyle(0x262b38);
      g.fillRect(0, 0, 32, 32);
      g.fillStyle(0x323949);
      g.fillRect(0, 2, 32, 2);
      g.fillRect(0, 28, 32, 2);
      // three chevrons spaced 16px apart, drawn across a 48px span and clipped
      // by the texture bounds, so the cycle is seamless
      for (let c = -1; c <= 2; c++) {
        const x = c * 16 + shift;
        g.fillStyle(0x6b7689);
        g.fillTriangle(x + 2, 8, x + 11, 16, x + 2, 24);
        g.fillStyle(0x9aa7bd);
        g.fillTriangle(x + 8, 9, x + 16, 16, x + 8, 23);
      }
      g.generateTexture(f === 0 ? 'belt' : `belt${f}`, 32, 32);
      g.clear();
    }

    // Splitter: belt base + three-way chevrons (straight/left/right relative to East)
    g.fillStyle(0x262b38);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x3a4157);
    g.fillRect(2, 2, 28, 28);
    g.fillStyle(0xffd75e);
    g.fillTriangle(20, 12, 26, 16, 20, 20); // straight (E)
    g.fillTriangle(12, 12, 16, 6, 20, 12); // up (left of E)
    g.fillTriangle(12, 20, 16, 26, 20, 20); // down (right of E)
    g.fillStyle(0x9aa7bd);
    g.fillRect(6, 13, 6, 6);
    g.generateTexture('splitter', 32, 32);
    g.clear();

    // Sorter: the same three exits, but a funnel/diamond at the decision point
    // makes the filtering role legible before any tint says what it is filtering.
    g.fillStyle(0x262b38);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x465268);
    g.fillRect(2, 2, 28, 28);
    g.fillStyle(0xdce7f5);
    g.fillTriangle(20, 12, 27, 16, 20, 20); // straight (E)
    g.fillTriangle(12, 12, 16, 5, 20, 12); // up (left of E)
    g.fillTriangle(12, 20, 16, 27, 20, 20); // down (right of E)
    g.fillStyle(0x161b26);
    g.fillTriangle(5, 9, 15, 16, 5, 23);
    g.fillStyle(0xdce7f5);
    g.fillTriangle(11, 12, 17, 16, 11, 20);
    g.generateTexture('sorter', 32, 32);
    g.clear();

    // Tunnel: belt stub diving into a dark portal on the East side
    g.fillStyle(0x262b38);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x323949);
    g.fillRect(0, 2, 32, 2);
    g.fillRect(0, 28, 32, 2);
    g.fillStyle(0x6b7689);
    g.fillTriangle(4, 10, 11, 16, 4, 22);
    g.fillStyle(0x11141c);
    g.fillRoundedRect(14, 5, 18, 22, 6);
    g.fillStyle(0x000000);
    g.fillRoundedRect(17, 8, 15, 16, 5);
    g.fillStyle(0xffd75e);
    g.fillRect(14, 5, 2, 22);
    g.generateTexture('tunnel', 32, 32);
    g.clear();

    // Miner: bronze block with drill + output notch on the East side
    g.fillStyle(0x8a5a2b);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0xc97b3a);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0x5c3a1a);
    g.fillCircle(16, 16, 8);
    g.fillStyle(0xffd75e);
    g.fillCircle(16, 16, 3);
    g.fillRect(26, 12, 6, 8);
    g.generateTexture('miner', 32, 32);
    g.clear();

    // Ammo press: steel block with amber band + output notch East
    g.fillStyle(0x3d4654);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0x5c6b7a);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0xffd75e);
    g.fillRect(7, 12, 14, 8);
    g.fillStyle(0x2b313d);
    g.fillRect(9, 14, 10, 4);
    g.fillStyle(0xffd75e);
    g.fillRect(26, 12, 6, 8);
    g.generateTexture('press', 32, 32);
    g.clear();

    // Shell forge: dark red block with shell icon + output notch East
    g.fillStyle(0x4a2430);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0x7a3b47);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0xff9f43);
    g.fillRoundedRect(10, 12, 12, 8, 4);
    g.fillStyle(0x2b313d);
    g.fillRect(13, 14, 6, 4);
    g.fillStyle(0xff9f43);
    g.fillRect(26, 12, 6, 8);
    g.generateTexture('forge', 32, 32);
    g.clear();

    // Assembler: steel block with a cyan crystal window + output notch East
    g.fillStyle(0x2a3a4a);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0x3f5468);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0x11141c);
    g.fillRect(8, 10, 16, 12);
    g.fillStyle(0x2f7f9e);
    g.fillTriangle(10, 21, 14, 11, 18, 21);
    g.fillStyle(0x6bd4ff);
    g.fillTriangle(12, 20, 14, 13, 16, 20);
    g.fillStyle(0xffd75e);
    g.fillRect(18, 12, 4, 8);
    g.fillRect(26, 12, 6, 8);
    g.generateTexture('assembler', 32, 32);
    g.clear();

    // Chiller: pale block with cooling fins + output notch East
    g.fillStyle(0x2b3d46);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0x486a75);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0xc9f0ff);
    for (let i = 0; i < 4; i++) g.fillRect(7 + i * 4, 9, 2, 14);
    g.fillStyle(0x9fd8ff);
    g.fillRect(26, 12, 6, 8);
    g.generateTexture('chiller', 32, 32);
    g.clear();

    // Lab: pale dome over a lit flask. No output notch — nothing ever leaves it.
    g.fillStyle(0x2c2a44);
    g.fillRoundedRect(2, 2, 28, 28, 5);
    g.fillStyle(0x474170);
    g.fillRoundedRect(4, 4, 24, 24, 4);
    g.fillStyle(0x1a1830);
    g.fillCircle(16, 15, 9);
    g.fillStyle(0x7cf7c4);
    g.fillTriangle(13, 21, 16, 8, 19, 21);
    g.fillStyle(0xd8fff0);
    g.fillCircle(16, 18, 2.5);
    g.fillStyle(0xb18cff);
    g.fillRect(6, 24, 20, 3);
    g.generateTexture('lab', 32, 32);
    g.clear();

    // Tower base (barrel is a separate rotating sprite)
    g.fillStyle(0x232936);
    g.fillCircle(16, 16, 14);
    g.fillStyle(0x3f4a5e);
    g.fillCircle(16, 16, 11);
    g.fillStyle(0x59677f);
    g.fillCircle(16, 16, 7);
    g.generateTexture('tower', 32, 32);
    g.clear();

    g.fillStyle(0x1b1f29);
    g.fillRect(0, 1, 20, 6);
    g.fillStyle(0xffd75e);
    g.fillRect(15, 1, 5, 6);
    g.generateTexture('barrel', 20, 8);
    g.clear();

    // Cannon base + wide barrel
    g.fillStyle(0x2d2330);
    g.fillCircle(16, 16, 14);
    g.fillStyle(0x4d3a52);
    g.fillCircle(16, 16, 11);
    g.fillStyle(0x6e5375);
    g.fillCircle(16, 16, 7);
    g.generateTexture('cannon', 32, 32);
    g.clear();

    g.fillStyle(0x1b1520);
    g.fillRect(0, 0, 22, 10);
    g.fillStyle(0xff9f43);
    g.fillRect(17, 0, 5, 10);
    g.generateTexture('barrel-cannon', 22, 10);
    g.clear();

    // Lancer base + long thin rail barrel
    g.fillStyle(0x1d2f38);
    g.fillCircle(16, 16, 14);
    g.fillStyle(0x2f5a6b);
    g.fillCircle(16, 16, 11);
    g.fillStyle(0x4b8ea3);
    g.fillCircle(16, 16, 7);
    g.fillStyle(0x6bd4ff);
    g.fillCircle(16, 16, 3);
    g.generateTexture('lancer', 32, 32);
    g.clear();

    g.fillStyle(0x14212a);
    g.fillRect(0, 2, 26, 5);
    g.fillStyle(0x6bd4ff);
    g.fillRect(20, 1, 6, 7);
    g.generateTexture('barrel-lancer', 26, 9);
    g.clear();

    // Cryo emitter: no barrel — a frost ring that pulses outward
    g.fillStyle(0x1b2f3a);
    g.fillCircle(16, 16, 14);
    g.fillStyle(0x3d6b7d);
    g.fillCircle(16, 16, 11);
    g.fillStyle(0x9fd8ff);
    g.fillCircle(16, 16, 6);
    g.fillStyle(0xffffff);
    g.fillRect(15, 4, 2, 8);
    g.fillRect(15, 20, 2, 8);
    g.fillRect(4, 15, 8, 2);
    g.fillRect(20, 15, 8, 2);
    g.fillStyle(0xe0f2ff);
    g.fillCircle(16, 16, 3);
    g.generateTexture('cryo', 32, 32);
    g.clear();

    // Enemies. Each carries a bright nose on its East side: the sprites are
    // rotated to their heading as they walk, so a column visibly points the way
    // it is going instead of reading as a drifting bead of circles.
    g.fillStyle(0x8f1f1f);
    g.fillCircle(11, 11, 10);
    g.fillStyle(0xff5555);
    g.fillCircle(11, 11, 8);
    g.fillStyle(0xffb3b3);
    g.fillTriangle(15, 7, 22, 11, 15, 15); // nose (East)
    g.fillCircle(9, 8, 2);
    g.generateTexture('enemy', 22, 22);
    g.clear();

    // Armored: red core inside a steel ring, with a plated snout
    g.fillStyle(0x59677f);
    g.fillCircle(11, 11, 10);
    g.fillStyle(0x2b313d);
    g.fillCircle(11, 11, 7.5);
    g.fillStyle(0xff5555);
    g.fillCircle(11, 11, 5);
    g.fillStyle(0xcdd6e4);
    g.fillTriangle(14, 7, 22, 11, 14, 15);
    g.fillRect(9, 1, 4, 4);
    g.fillRect(9, 17, 4, 4);
    g.fillRect(1, 9, 4, 4);
    g.generateTexture('armored', 22, 22);
    g.clear();

    // Swift: deliberately teal rather than sky-blue. A chilled enemy is tinted
    // pale frost-white, and a saturated cyan swift was easy to mistake for one.
    g.fillStyle(0x0f7a70);
    g.fillCircle(9, 9, 8);
    g.fillStyle(0x2fe3d0);
    g.fillCircle(9, 9, 6);
    g.fillStyle(0xd7fff8);
    g.fillTriangle(11, 5, 18, 9, 11, 13);
    g.generateTexture('swift', 18, 18);
    g.clear();

    g.fillStyle(0x5e1f8f);
    g.fillCircle(15, 15, 14);
    g.fillStyle(0xb455ff);
    g.fillCircle(15, 15, 11);
    g.fillStyle(0xe6c3ff);
    g.fillTriangle(20, 9, 30, 15, 20, 21);
    g.fillCircle(12, 11, 3);
    g.generateTexture('boss', 30, 30);
    g.clear();

    // Muzzle flash — a short bright wedge reused from a pool, never allocated per shot
    g.fillStyle(0xfff3a0);
    g.fillTriangle(0, 3, 14, 0, 14, 12);
    g.fillStyle(0xffffff);
    g.fillTriangle(2, 5, 10, 3, 10, 9);
    g.generateTexture('muzzle', 14, 12);
    g.clear();

    // Items
    g.fillStyle(0xb35c1e);
    g.fillCircle(6, 6, 5);
    g.fillStyle(0xff9f43);
    g.fillCircle(6, 6, 3.5);
    g.fillStyle(0xffd2a0);
    g.fillCircle(4.5, 4.5, 1.5);
    g.generateTexture('item-ore', 12, 12);
    g.clear();

    g.fillStyle(0xb8962e);
    g.fillRoundedRect(0, 1, 12, 8, 3);
    g.fillStyle(0xffe066);
    g.fillRoundedRect(1, 2, 10, 6, 2);
    g.generateTexture('item-ammo', 12, 10);
    g.clear();

    g.fillStyle(0xa85a1e);
    g.fillRoundedRect(0, 2, 13, 8, 4);
    g.fillStyle(0xff9f43);
    g.fillRoundedRect(1, 3, 11, 6, 3);
    g.fillStyle(0xffd2a0);
    g.fillRect(8, 4, 3, 4);
    g.generateTexture('item-shell', 13, 12);
    g.clear();

    // Raw crystal: a cut blue shard
    g.fillStyle(0x2f7f9e);
    g.fillTriangle(0, 12, 6, 0, 12, 12);
    g.fillStyle(0x6bd4ff);
    g.fillTriangle(3, 11, 6, 2, 9, 11);
    g.fillStyle(0xc9f0ff);
    g.fillTriangle(5, 9, 6, 4, 7, 9);
    g.generateTexture('item-crystal', 12, 12);
    g.clear();

    // Piercing round: crystal-tipped dart
    g.fillStyle(0x1f4a5c);
    g.fillRoundedRect(0, 2, 14, 6, 2);
    g.fillStyle(0x4b8ea3);
    g.fillRoundedRect(1, 3, 12, 4, 2);
    g.fillStyle(0xc9f0ff);
    g.fillTriangle(10, 1, 15, 5, 10, 9);
    g.generateTexture('item-piercing', 15, 10);
    g.clear();

    // Coolant: a frosted canister
    g.fillStyle(0x3d6b7d);
    g.fillRoundedRect(0, 0, 12, 10, 3);
    g.fillStyle(0xc9f0ff);
    g.fillRoundedRect(1, 1, 10, 8, 2);
    g.fillStyle(0x9fd8ff);
    g.fillRect(3, 3, 6, 2);
    g.generateTexture('item-coolant', 12, 10);
    g.clear();

    // Bullet, cannonball, particle
    g.fillStyle(0xfff3a0);
    g.fillRoundedRect(0, 0, 9, 4, 2);
    g.generateTexture('bullet', 9, 4);
    g.clear();

    g.fillStyle(0x1b1520);
    g.fillCircle(5, 5, 4.5);
    g.fillStyle(0xff9f43);
    g.fillCircle(3.5, 3.5, 1.5);
    g.generateTexture('cannonball', 10, 10);
    g.clear();

    // Lance: a long bright bolt — reads as a beam skewering a column
    g.fillStyle(0x2f7f9e);
    g.fillRect(0, 0, 26, 6);
    g.fillStyle(0x6bd4ff);
    g.fillRect(1, 1, 24, 4);
    g.fillStyle(0xffffff);
    g.fillRect(16, 2, 9, 2);
    g.generateTexture('lance', 26, 6);
    g.clear();

    g.fillStyle(0xffffff);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture('px', 4, 4);
    g.destroy();

    this.scene.start('menu');
  }
}
