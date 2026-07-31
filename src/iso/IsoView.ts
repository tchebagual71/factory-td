import Phaser from 'phaser';
import * as THREE from 'three';
import { GAME_H, GRID_H, GRID_W, IS_TOUCH, PLAYFIELD_H, TILE } from '../config';
import { isTower, TOWERS } from '../data/buildings';
import { computePathCells, pathWaypoints, RESERVES } from '../data/map';
import { GameState } from '../state/GameState';
import { isHudObject } from '../scenes/hudObjects';
import { minedResource, GridSystem } from '../systems/GridSystem';
import { overlayCell } from '../systems/LogisticsSystem';
import { Enemy } from '../types';
import {
  BOARD_CX,
  BOARD_CZ,
  CAM_EYE,
  fitCam,
  IsoCam,
  screenToBoard as isoScreenToBoard,
  screenToTile,
  worldToScreen,
} from './isoMath';
import { GROUND_Y, Model, modelFor } from './isoModels';
import {
  createIsoQualityState,
  initialIsoQuality,
  ISO_QUALITY_PRESETS,
  IsoQualityState,
  IsoRenderQuality,
  sampleIsoFrame,
} from './isoQuality';

/**
 * The isometric 3D view.
 *
 * It does not simulate anything. Every frame it walks GameScene's display list
 * and extrudes what it finds into a Three.js scene — so belts, machines,
 * towers, enemies, items and projectiles appear in 3D purely because the 2D
 * game put them on screen. Nothing in `src/systems` knows this exists, which is
 * the point: the isometric build is the same game, not a fork of it.
 *
 * Two things are *not* mirrored, because mirroring them would be worse than
 * rebuilding them:
 *  - **terrain**, which becomes real geometry (grass slabs standing proud of a
 *    sunken road, so the unbuildable path is a canyon you can see);
 *  - **bars and pips**, which are read from the entities themselves. A 2D bar is
 *    positioned by a screen-space offset ("16px above the enemy"), and an
 *    isometric camera turns any such offset into a shove sideways. Given the
 *    entity we can put the bar where it belongs — directly overhead.
 *
 * Text is left to Phaser entirely: it keeps rendering on the transparent canvas
 * above this one, so floating bounties and the HUD are unchanged.
 */

/** How far the camera sits from the board. Orthographic, so this only sets the depth range. */
const CAM_DIST = 2200;

/** Particle sprays are mirrored into this many recycled cubes. */
const PARTICLE_CAP = 512;

/** Bars/pips drawn per frame before we stop allocating new ones. */
const BAR_CAP = 256;

/** Instanced rock capacity for deposits. Prospecting can add patches mid-run. */
const ROCK_CAP = 1400;

/** Magazine bar tint per tower, matching the 2D HUD so the read carries over. */
const AMMO_BAR: Record<string, number> = { cannon: 0xff9f43, lancer: 0x6bd4ff, cryo: 0x9fd8ff };

/** Mk pip tint per specialization path — the same palette GameScene paints. */
const PATH_PIP: Record<string, number> = {
  sniper: 0x6bd4ff,
  gatling: 0xffe066,
  siege: 0xff9f43,
  flak: 0xb18cff,
  railgun: 0x7cf7c4,
  volley: 0xff7ad9,
  cryostasis: 0x9fd8ff,
  blizzard: 0xe0f2ff,
};

const COLORS = {
  sky: 0x11131f,
  grass: [0x2f4f43, 0x2b4a3f],
  oreGround: 0x2a3327,
  crystalGround: 0x1f2c3a,
  road: 0xb08c4a,
  kerb: 0x8a6a34,
  oreRock: 0xd2761f,
  crystalRock: 0x6bd4ff,
  spawn: 0x8a3df0,
  exit: 0xd23a3a,
};

type Sprite2D = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

interface Proxy {
  group: THREE.Group;
  /** texture key currently on the lid — belts swap this as their loop plays */
  key: string;
  model: Model;
  body: THREE.Mesh;
  lid: THREE.Mesh | null;
}

interface ArcProxy {
  group: THREE.Group;
  fill: THREE.Mesh;
  ring: THREE.Mesh;
}

/** Two solids are interchangeable if only the picture on the lid differs. */
function sameSolid(a: Model, b: Model): boolean {
  return a.shape === b.shape && a.w === b.w && a.d === b.d && a.h === b.h && a.lift === b.lift;
}

export class IsoView {
  /** Rebuilt by `setView` on zoom/pan; `tileAt`/`project` read it, so they follow. */
  cam: IsoCam;

  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private quality: IsoRenderQuality;
  private qualityState: IsoQualityState;
  private lastFrameAt: number | null = null;
  private lastDrawAt = -Infinity;
  private fallbackPending = false;
  private destroyed = false;
  private world = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private sun!: THREE.DirectionalLight;

  private proxies = new Map<Phaser.GameObjects.GameObject, Proxy>();
  private arcs = new Map<Phaser.GameObjects.GameObject, ArcProxy>();
  private seen = new Set<Phaser.GameObjects.GameObject>();

  private textures = new Map<string, THREE.Texture>();
  private materials = new Map<string, THREE.Material>();
  private geometries = new Map<string, THREE.BufferGeometry>();

  /** Fixed camera ⇒ one billboard orientation for every bar on the board. */
  private billboard = new THREE.Quaternion();
  private bars: THREE.Mesh[] = [];
  private barsUsed = 0;
  /** recycled ground quads for the [L] overlay */
  private decals: THREE.Mesh[] = [];

  private particles!: THREE.InstancedMesh;
  private grassMesh!: THREE.InstancedMesh;
  private grassCells: { x: number; y: number }[] = [];
  private rocks: Record<'ore' | 'crystal', THREE.InstancedMesh> = {} as never;

  private survey: THREE.Mesh;
  private layoutTick = 0;
  /** the Phaser camera whose flat world we are standing in for */
  private masked: Phaser.Cameras.Scene2D.Camera | null = null;

  private enemiesOf: () => Enemy[] = () => [];

  constructor(
    private game: Phaser.Game,
    private grid: GridSystem,
  ) {
    const parent = game.canvas.parentElement!;
    parent.style.position = 'relative';
    // The Phaser canvas is transparent in isometric mode and stacks above this
    // one, so its text and HUD land on top of the 3D world.
    game.canvas.style.position = 'relative';
    game.canvas.style.zIndex = '1';

    this.quality = initialIsoQuality({ isTouch: IS_TOUCH, devicePixelRatio: window.devicePixelRatio || 1 });
    this.qualityState = createIsoQualityState(this.quality);
    this.canvas = this.makeCanvas();
    parent.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer = this.makeRenderer(ISO_QUALITY_PRESETS[this.quality].antialias);
    this.configureRenderer(this.quality);

    this.cam = fitCam(0, 0, GRID_W * TILE, PLAYFIELD_H);
    this.camera = new THREE.OrthographicCamera(
      this.cam.left,
      this.cam.right,
      this.cam.top,
      this.cam.bottom,
      CAM_DIST - 1400,
      CAM_DIST + 1400,
    );
    this.camera.position.set(
      BOARD_CX + CAM_EYE.x * CAM_DIST,
      CAM_EYE.y * CAM_DIST,
      BOARD_CZ + CAM_EYE.z * CAM_DIST,
    );
    this.camera.lookAt(BOARD_CX, 0, BOARD_CZ);
    this.camera.updateMatrixWorld();
    this.billboard.copy(this.camera.quaternion);

    this.buildLights();
    this.buildTerrain();
    this.buildParticles();

    this.survey = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x5ef078, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.survey.rotation.x = -Math.PI / 2;
    this.survey.visible = false;
    this.survey.renderOrder = 6;
    this.world.add(this.survey);

    this.layout();
  }

  /** Build the DOM layer once, and again only if antialiasing must change. */
  private makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    // The 3D image is smooth, not chunky — the global `image-rendering: pixelated`
    // would alias every edge of it.
    canvas.style.imageRendering = 'auto';
    return canvas;
  }

  private makeRenderer(antialias: boolean): THREE.WebGLRenderer {
    return new THREE.WebGLRenderer({ canvas: this.canvas, antialias, alpha: false });
  }

  private configureRenderer(level: IsoRenderQuality): void {
    const preset = ISO_QUALITY_PRESETS[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.dprCap));
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = preset.shadows;
    // PCFSoftShadowMap is deprecated and silently downgrades to this anyway,
    // with a console warning on every boot — so ask for what we actually get.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Where the bars come from. Called by GameScene once the systems exist. */
  setSources(enemies: () => Enemy[]): void {
    this.enemiesOf = enemies;
  }

  // ---------- masking the 2D world off Phaser's camera ----------

  /**
   * Stop Phaser drawing the flat world, without touching a single `visible`
   * flag. `Camera.ignore` is a per-object bitmask, so we can set it as objects
   * appear and clear it again when the player switches back — code elsewhere
   * stays free to show and hide these objects for its own reasons and we never
   * fight it.
   *
   * Text and Containers are deliberately left alone: floating bounties, the
   * wave banner and the upgrade panel are UI, and they belong *over* the 3D
   * world on the transparent canvas above it.
   */
  attach(scene: Phaser.Scene): void {
    this.masked = scene.cameras.main;
    for (const obj of scene.children.list) this.mask(obj);
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded);
  }

  detach(scene: Phaser.Scene): void {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded);
    const cam = this.masked;
    if (cam) for (const obj of scene.children.list) obj.cameraFilter &= ~cam.id;
    this.masked = null;
  }

  private onAdded = (obj: Phaser.GameObjects.GameObject): void => this.mask(obj);

  private mask(obj: Phaser.GameObjects.GameObject): void {
    const cam = this.masked;
    if (!cam) return;
    // Shared with the flat view's zoom camera — see `hudObjects.ts`.
    if (isHudObject(obj)) return;
    obj.cameraFilter |= cam.id;
  }

  /**
   * Re-frame for a new zoom/pan. Rebuilding the whole `IsoCam` (rather than
   * nudging the Three camera) is what keeps picking exact: `tileAt` and
   * `project` both read `this.cam`, so they follow automatically.
   */
  setView(zoom: number, panX: number, panY: number): void {
    this.cam = fitCam(0, 0, GRID_W * TILE, PLAYFIELD_H, { zoom, panX, panY });
    this.camera.left = this.cam.left;
    this.camera.right = this.cam.right;
    this.camera.top = this.cam.top;
    this.camera.bottom = this.cam.bottom;
    this.camera.updateProjectionMatrix();
  }

  /** Board px under a pointer at these *design* pixel coordinates. */
  boardAt(sx: number, sy: number): { x: number; y: number } {
    return isoScreenToBoard(this.cam, sx, sy);
  }

  /** The tile under a pointer at these *design* pixel coordinates. */
  tileAt(sx: number, sy: number): { tx: number; ty: number } {
    return screenToTile(this.cam, sx, sy);
  }

  /**
   * A board position → where it lands on the canvas, so Phaser Text anchored to
   * the board (floating bounties, logistics readouts) can follow the 3D world.
   * Lifted slightly off the ground so a label clears the thing it describes.
   */
  project(x: number, y: number, h = GROUND_Y): { x: number; y: number } {
    return worldToScreen(this.cam, x, h, y);
  }

  // ---------- scene construction ----------

  private buildLights(): void {
    this.world.add(new THREE.HemisphereLight(0x9dc4ff, 0x1b2a1e, 1.15));
    this.world.add(new THREE.AmbientLight(0xffffff, 0.35));

    const sun = new THREE.DirectionalLight(0xfff2d5, 2.0);
    this.sun = sun;
    sun.position.set(BOARD_CX - 700, 1150, BOARD_CZ - 520);
    sun.target.position.set(BOARD_CX, 0, BOARD_CZ);
    const preset = ISO_QUALITY_PRESETS[this.quality];
    sun.castShadow = preset.shadows;
    // Tight ortho shadow frustum around the board: any slack here is resolution
    // thrown away, and belt-height detail is exactly what the shadows sell.
    const s = sun.shadow.camera;
    s.left = -820;
    s.right = 820;
    s.top = 620;
    s.bottom = -620;
    s.near = 200;
    s.far = 2400;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 1.2;
    this.world.add(sun);
    this.world.add(sun.target);

    // A cool bounce from the opposite side so the shadowed faces aren't dead flat.
    const fill = new THREE.DirectionalLight(0x6f8fd0, 0.5);
    fill.position.set(BOARD_CX + 600, 400, BOARD_CZ + 700);
    this.world.add(fill);
  }

  private buildTerrain(): void {
    const W = GRID_W * TILE;
    const D = GRID_H * TILE;
    const path = computePathCells();

    // The road: one plane at y=0. Every buildable cell gets a grass slab on top
    // of it, so what remains exposed is exactly the enemy path — sunken, kerbed,
    // and unmistakably not somewhere you can build.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshLambertMaterial({ color: COLORS.road }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(W / 2, 0, D / 2);
    road.receiveShadow = true;
    this.world.add(road);

    // A dark apron under everything so the board reads as a slab in space
    // rather than a rectangle floating on the clear colour.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(W + 80, 40, D + 80),
      new THREE.MeshLambertMaterial({ color: 0x161a26 }),
    );
    apron.position.set(W / 2, -20 - 1, D / 2);
    apron.receiveShadow = true;
    this.world.add(apron);

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!path.has(`${x},${y}`)) this.grassCells.push({ x, y });
      }
    }

    this.grassMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, GROUND_Y, TILE),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      this.grassCells.length,
    );
    this.grassMesh.castShadow = true;
    this.grassMesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    this.grassCells.forEach((c, i) => {
      m.makeTranslation(c.x * TILE + TILE / 2, GROUND_Y / 2, c.y * TILE + TILE / 2);
      this.grassMesh.setMatrixAt(i, m);
    });
    this.grassMesh.instanceMatrix.needsUpdate = true;
    this.world.add(this.grassMesh);

    // Deposits: instanced rock/shard clusters, rebuilt whenever a tile thins out,
    // runs dry or a survey reveals a new patch.
    for (const kind of ['ore', 'crystal'] as const) {
      const geo =
        kind === 'ore'
          ? new THREE.DodecahedronGeometry(4.2, 0)
          : new THREE.ConeGeometry(3.4, 13, 5);
      const mesh = new THREE.InstancedMesh(
        geo,
        new THREE.MeshLambertMaterial({
          color: COLORS[kind === 'ore' ? 'oreRock' : 'crystalRock'],
          // Crystal lights itself a little; ore is just rock catching the sun.
          emissive: kind === 'ore' ? 0x000000 : 0x1d5a78,
        }),
        ROCK_CAP,
      );
      mesh.castShadow = true;
      mesh.count = 0;
      this.rocks[kind] = mesh;
      this.world.add(mesh);
    }

    this.buildPathMarkers();
    this.syncTerrain();
  }

  /** Direction chevrons down the road, plus the spawn and exit mouths. */
  private buildPathMarkers(): void {
    const route = pathWaypoints();
    const mats = new THREE.MeshBasicMaterial({ color: 0xe4c286, transparent: true, opacity: 0.5 });
    const geo = new THREE.ConeGeometry(7, 15, 3);
    const spots: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < route.length - 1; i++) {
      const ax = route[i].x * TILE + TILE / 2;
      const az = route[i].y * TILE + TILE / 2;
      const bx = route[i + 1].x * TILE + TILE / 2;
      const bz = route[i + 1].y * TILE + TILE / 2;
      const len = Math.hypot(bx - ax, bz - az);
      if (len === 0) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const heading = Math.atan2(-uz, ux); // board heading → rotation about world Y
      for (let t = 22; t < len; t += 46) {
        const x = ax + ux * t;
        const z = az + uz * t;
        if (x < 0 || x > GRID_W * TILE || z < 0 || z > GRID_H * TILE) continue;
        // Cones point +Y by default: tip them onto their side, then swing to heading.
        euler.set(0, heading, -Math.PI / 2, 'YZX');
        q.setFromEuler(euler);
        spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.2, z), q, one));
      }
    }

    const arrows = new THREE.InstancedMesh(geo, mats, Math.max(1, spots.length));
    spots.forEach((mat, i) => arrows.setMatrixAt(i, mat));
    arrows.count = spots.length;
    arrows.instanceMatrix.needsUpdate = true;
    this.world.add(arrows);

    // Spawn and exit mouths, straddling the board edge exactly where the 2D
    // view paints its two coloured stubs.
    const mouth = (centerX: number, cellY: number, color: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(TILE * 0.5, GROUND_Y + 10, TILE),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55 }),
      );
      mesh.position.set(centerX, (GROUND_Y + 10) / 2, cellY * TILE + TILE / 2);
      this.world.add(mesh);
    };
    mouth(TILE / 4, route[0].y, COLORS.spawn);
    mouth(GRID_W * TILE - TILE / 4, route[route.length - 1].y, COLORS.exit);
  }

  private buildParticles(): void {
    this.particles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.4, 3.4, 3.4),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
      PARTICLE_CAP,
    );
    // Allocate the colour buffer up front. `vertexColors` makes the shader read
    // a colour attribute, and until the first `setColorAt` there isn't one —
    // every particle in the first burst would come out black.
    this.particles.setColorAt(0, new THREE.Color(0xffffff));
    this.particles.count = 0;
    this.particles.frustumCulled = false;
    this.world.add(this.particles);
  }

  /**
   * Repaint the ground and its deposits. Cheap enough to call on the 1s cadence
   * GameScene already repaints its 2D ore layer on, plus immediately when a tile
   * dies or a survey lands.
   */
  syncTerrain(): void {
    const c = new THREE.Color();
    this.grassCells.forEach((cell, i) => {
      const kind = this.grid.cellAt(cell.x, cell.y)?.kind ?? 'grass';
      if (kind === 'ore') c.setHex(COLORS.oreGround);
      else if (kind === 'crystal') c.setHex(COLORS.crystalGround);
      else c.setHex(COLORS.grass[(cell.x + cell.y) % 2]);
      // Deterministic per-tile jitter so the ground reads as terrain rather than
      // a chessboard — the same trick the 2D speckle plays.
      const n = (((cell.x * 73856093) ^ (cell.y * 19349663)) >>> 5) % 7;
      c.offsetHSL(0, 0, (n - 3) * 0.006);
      this.grassMesh.setColorAt(i, c);
    });
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;

    const counts = { ore: 0, crystal: 0 };
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.grid.forEachCell((cell, x, y) => {
      const res = minedResource(cell.kind);
      if (!res) return;
      const rich = Math.max(0.15, Math.min(1, cell.reserves / RESERVES[res]));
      // A thinning patch visibly loses rocks before it dies.
      const n = rich > 0.66 ? 3 : rich > 0.33 ? 2 : 1;
      const mesh = this.rocks[res];
      for (let k = 0; k < n; k++) {
        if (counts[res] >= ROCK_CAP) break;
        const h = ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0;
        const ox = 7 + ((h >>> 3) % 19);
        const oz = 7 + ((h >>> 11) % 19);
        const s = 0.55 + rich * 0.65;
        pos.set(x * TILE + ox, GROUND_Y + (res === 'crystal' ? 5 : 2), y * TILE + oz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((h >>> 17) % 360) * (Math.PI / 180));
        scale.set(s, s * (res === 'crystal' ? 0.5 + rich * 0.7 : 1), s);
        mesh.setMatrixAt(counts[res], m.compose(pos, q, scale));
        counts[res] += 1;
      }
    });
    for (const kind of ['ore', 'crystal'] as const) {
      this.rocks[kind].count = counts[kind];
      this.rocks[kind].instanceMatrix.needsUpdate = true;
    }
  }

  /** Show/hide the prospecting footprint. `null` clears it. */
  setSurvey(rect: { x: number; y: number; w: number; h: number } | null, ok = true): void {
    if (!rect) {
      this.survey.visible = false;
      return;
    }
    this.survey.visible = true;
    this.survey.scale.set(rect.w * TILE, rect.h * TILE, 1);
    this.survey.position.set(
      rect.x * TILE + (rect.w * TILE) / 2,
      GROUND_Y + 1.2,
      rect.y * TILE + (rect.h * TILE) / 2,
    );
    (this.survey.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x5ef078 : 0xff5555);
  }

  // ---------- adaptive rendering quality ----------

  /**
   * Apply a pure-policy transition to Three.js. Antialiasing is a WebGL context
   * attribute, so reaching low replaces only the rendering canvas/context; the
   * mirrored scene remains intact and lazily uploads into the cheaper context.
   */
  private applyQuality(level: IsoRenderQuality): void {
    const before = ISO_QUALITY_PRESETS[this.quality];
    const after = ISO_QUALITY_PRESETS[level];

    if (before.antialias !== after.antialias) {
      const oldCanvas = this.canvas;
      const oldRenderer = this.renderer;
      const parent = oldCanvas.parentElement;
      const nextCanvas = this.makeCanvas();
      if (parent) parent.insertBefore(nextCanvas, oldCanvas);
      oldCanvas.removeEventListener('webglcontextlost', this.onContextLost);
      oldRenderer.dispose();
      oldCanvas.remove();
      this.canvas = nextCanvas;
      this.canvas.addEventListener('webglcontextlost', this.onContextLost);
      this.renderer = this.makeRenderer(after.antialias);
    }

    this.quality = level;
    this.configureRenderer(level);
    this.sun.castShadow = after.shadows;
    if (this.sun.shadow.mapSize.width !== after.shadowMapSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(after.shadowMapSize, after.shadowMapSize);
    }
    this.layout();
    this.lastDrawAt = -Infinity;
  }

  /**
   * Runtime failures take the same route as the HUD chip. GameScene owns that
   * path: it detaches and destroys this mirror, persists `2d`, and broadcasts
   * the `view` event which corrects the chip. The microtask avoids destroying
   * the renderer from inside its current render/context callback.
   */
  private requestFlatFallback(): void {
    if (this.fallbackPending || this.destroyed) return;
    this.fallbackPending = true;
    queueMicrotask(() => {
      if (!this.destroyed) GameState.events.emit('ui:view');
    });
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.qualityState = { level: 'flat', samples: [], badAverages: 0 };
    this.requestFlatFallback();
  };

  // ---------- per-frame mirror ----------

  render(scene: Phaser.Scene): void {
    // Measure the real main-loop cadence before applying the mirror-only cap.
    // Returning here skips no Phaser update and changes no simulation clock;
    // it merely lets the 3D reflection reuse its previous frame.
    const frameAt = performance.now();
    if (this.lastFrameAt !== null) {
      const next = sampleIsoFrame(this.qualityState, frameAt - this.lastFrameAt);
      if (next.level !== this.qualityState.level) {
        this.qualityState = next;
        if (next.level === 'flat') {
          this.requestFlatFallback();
          return;
        }
        this.applyQuality(next.level);
      } else {
        this.qualityState = next;
      }
    }
    this.lastFrameAt = frameAt;

    const interval = ISO_QUALITY_PRESETS[this.quality].minRenderIntervalMs;
    if (frameAt - this.lastDrawAt < interval) return;
    this.lastDrawAt = frameAt;

    this.seen.clear();
    this.barsUsed = 0;
    let particleCount = 0;
    const pMat = new THREE.Matrix4();
    const pColor = new THREE.Color();

    for (const obj of scene.children.list) {
      if (obj instanceof Phaser.GameObjects.Image || obj instanceof Phaser.GameObjects.Sprite) {
        this.syncSprite(obj as Sprite2D);
      } else if (obj instanceof Phaser.GameObjects.Arc) {
        this.syncArc(obj);
      } else if (obj instanceof Phaser.GameObjects.Rectangle) {
        // Only outlines: the filled rectangles are ammo/HP bars, and those are
        // rebuilt from their entities in `syncBars` so they float overhead
        // rather than being smeared sideways by the projection.
        if (obj.isStroked && !obj.isFilled) this.syncOutline(obj);
      } else if (obj instanceof Phaser.GameObjects.Particles.ParticleEmitter && obj.visible) {
        obj.forEachAlive((p: Phaser.GameObjects.Particles.Particle) => {
          if (particleCount >= PARTICLE_CAP) return;
          const s = Math.max(0.05, p.scaleX) * (p.alpha ?? 1);
          pMat.makeScale(s, s, s);
          pMat.setPosition(p.x, GROUND_Y + 9, p.y);
          this.particles.setMatrixAt(particleCount, pMat);
          pColor.setHex(typeof p.tint === 'number' && p.tint > 0 ? p.tint : 0xffffff);
          this.particles.setColorAt(particleCount, pColor);
          particleCount += 1;
        }, this);
      }
    }

    this.particles.count = particleCount;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;

    this.syncOverlay(scene.time.now);
    this.syncBars();
    this.reap();

    if ((this.layoutTick = (this.layoutTick + 1) % 20) === 0) this.layout();
    this.draw();
  }

  private syncSprite(obj: Sprite2D): void {
    const key = obj.texture.key;
    const model = modelFor(key);
    if (!model) return;

    let p = this.proxies.get(obj);
    // A different texture on the same solid is just a new picture for the lid —
    // a belt advancing its chevron loop. A different *solid* has to be rebuilt.
    if (p && p.key !== key && !sameSolid(p.model, model)) {
      this.disposeProxy(p);
      this.proxies.delete(obj);
      p = undefined;
    }
    if (!p) {
      p = this.makeProxy(key, model, obj);
      this.proxies.set(obj, p);
    } else if (p.key !== key) {
      p.key = key;
      p.model = model;
    }
    // "Seen" means still on the display list, not necessarily drawn. Hiding
    // rather than reaping is what keeps Phaser's pooled objects — muzzle
    // flashes, the build ghost — from churning a proxy every time they blink.
    this.seen.add(obj);
    const shown = obj.visible && obj.alpha > 0.02;
    p.group.visible = shown;
    if (!shown) return;

    const g = p.group;
    g.position.set(obj.x, model.lift, obj.y);
    // Board y runs *into* the screen as world z, so a clockwise 2D turn is an
    // anticlockwise turn about world Y.
    g.rotation.y = -obj.rotation;
    const s = obj.scaleX || 1;
    g.scale.set(s, s, s);

    const tint = obj.isTinted ? obj.tintTopLeft : 0xffffff;
    const wantBody = this.bodyMaterial(model, tint, obj.alpha);
    if (p.body.material !== wantBody) p.body.material = wantBody;
    if (p.lid) {
      const wantLid = this.lidMaterial(key, obj);
      if (p.lid.material !== wantLid) p.lid.material = wantLid;
    }
  }

  private makeProxy(key: string, model: Model, obj: Sprite2D): Proxy {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeometry(model), this.bodyMaterial(model, 0xffffff, 1));
    body.castShadow = model.shape !== 'slab';
    body.receiveShadow = model.shape !== 'bolt';
    body.position.y = model.h / 2;
    group.add(body);

    let lid: THREE.Mesh | null = null;
    if (model.shape !== 'bolt') {
      lid = new THREE.Mesh(this.geometry(`lid:${model.w}x${model.d}`, () => new THREE.PlaneGeometry(model.w, model.d)), this.lidMaterial(key, obj));
      // A plane's +v maps to world −z once it is laid flat, and Three flips
      // texture v by default — so the top row of the sprite lands at the top of
      // the board, exactly as it does in 2D.
      lid.rotation.x = -Math.PI / 2;
      lid.position.y = model.h + 0.12;
      group.add(lid);
    }

    // Phaser art can pivot anywhere; a barrel swings about a point 15% along its
    // length. Shift the solid inside the group so the group's origin is the pivot.
    const ox = (0.5 - obj.originX) * model.w;
    const oz = (0.5 - obj.originY) * model.d;
    body.position.x = ox;
    body.position.z = oz;
    if (lid) {
      lid.position.x = ox;
      lid.position.z = oz;
    }

    this.world.add(group);
    return { group, key, model, body, lid };
  }

  private bodyGeometry(model: Model): THREE.BufferGeometry {
    const id = `body:${model.shape}:${model.w}x${model.d}x${model.h}`;
    return this.geometry(id, () => {
      switch (model.shape) {
        case 'turret':
          return new THREE.CylinderGeometry(model.w / 2, model.w / 2 + 1.5, model.h, 20);
        case 'unit':
          return new THREE.CylinderGeometry(model.w / 2 - 1, model.w / 2, model.h, 14);
        case 'bolt':
          return model.w === model.d
            ? new THREE.SphereGeometry(model.w / 2, 12, 8)
            : new THREE.BoxGeometry(model.w, model.h, model.d);
        default:
          return new THREE.BoxGeometry(model.w, model.h, model.d);
      }
    });
  }

  private geometry(id: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(id);
    if (!g) {
      g = make();
      this.geometries.set(id, g);
    }
    return g;
  }

  // ---------- materials & textures ----------

  /** Alpha is bucketed so a fading tween can't mint a material per frame. */
  private bucket(alpha: number): number {
    return Math.round(Math.min(1, Math.max(0, alpha)) * 16);
  }

  private bodyMaterial(model: Model, tint: number, alpha: number): THREE.Material {
    const a = this.bucket(alpha);
    const id = `body|${model.side}|${model.glow}|${tint}|${a}`;
    let mat = this.materials.get(id);
    if (!mat) {
      const color = new THREE.Color(model.side).multiply(new THREE.Color(tint));
      mat = new THREE.MeshLambertMaterial({
        color,
        emissive: model.glow > 0 ? color.clone() : new THREE.Color(0x000000),
        emissiveIntensity: model.glow,
        transparent: a < 16,
        opacity: a / 16,
        depthWrite: a >= 16,
      });
      this.materials.set(id, mat);
    }
    return mat;
  }

  private lidMaterial(key: string, obj: Sprite2D): THREE.Material {
    const tint = obj.isTinted ? obj.tintTopLeft : 0xffffff;
    const a = this.bucket(obj.alpha);
    const id = `lid|${key}|${tint}|${a}`;
    let mat = this.materials.get(id);
    if (!mat) {
      const opaque = a >= 16;
      mat = new THREE.MeshLambertMaterial({
        map: this.texture(key),
        color: new THREE.Color(tint),
        // At full alpha this stays in the *opaque* pass and cuts its silhouette
        // with alphaTest. Marking it transparent instead would hand every lid on
        // the board to the depth-sorted pass, where a tower lid and the barrel
        // above it have no reliable order. Only genuinely faded things (the
        // build ghost, an item in transit down a tunnel) blend.
        transparent: !opaque,
        opacity: a / 16,
        alphaTest: opaque ? 0.5 : 0.02,
        depthWrite: opaque,
      });
      this.materials.set(id, mat);
    }
    return mat;
  }

  private texture(key: string): THREE.Texture {
    let t = this.textures.get(key);
    if (!t) {
      const src = this.game.textures.get(key).getSourceImage() as HTMLCanvasElement;
      t = new THREE.Texture(src);
      t.magFilter = THREE.NearestFilter; // keep the chunky procedural art crisp
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.textures.set(key, t);
    }
    return t;
  }

  // ---------- circles: tower range, cryo pulses ----------

  private syncArc(obj: Phaser.GameObjects.Arc): void {
    let a = this.arcs.get(obj);
    if (!a) {
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2;
      const fill = new THREE.Mesh(
        this.geometry('arc:fill', () => new THREE.CircleGeometry(1, 48)),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      const ring = new THREE.Mesh(
        this.geometry('arc:ring', () => new THREE.RingGeometry(0.965, 1, 48)),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      fill.renderOrder = 4;
      ring.renderOrder = 5;
      group.add(fill, ring);
      this.world.add(group);
      a = { group, fill, ring };
      this.arcs.set(obj, a);
    }
    this.seen.add(obj);
    a.group.visible = obj.visible;
    if (!obj.visible) return;

    const r = Math.max(1, obj.radius * (obj.scaleX || 1));
    a.group.position.set(obj.x, GROUND_Y + 0.8, obj.y);
    a.group.scale.set(r, r, 1);
    const fm = a.fill.material as THREE.MeshBasicMaterial;
    fm.color.setHex(obj.fillColor ?? 0xffffff);
    fm.opacity = (obj.fillAlpha ?? 0) * obj.alpha;
    a.fill.visible = fm.opacity > 0.005;
    const rm = a.ring.material as THREE.MeshBasicMaterial;
    rm.color.setHex(obj.isStroked ? obj.strokeColor : (obj.fillColor ?? 0xffffff));
    rm.opacity = (obj.isStroked ? obj.strokeAlpha : 0.5) * obj.alpha;
    a.ring.visible = rm.opacity > 0.005;
  }

  /**
   * An unfilled, stroked rectangle is a selection ring: painted flat on the
   * ground it wraps the tile the way a decal would, which reads far better in
   * isometric than a billboard would.
   */
  private syncOutline(obj: Phaser.GameObjects.Rectangle): void {
    let a = this.arcs.get(obj);
    if (!a) {
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2;
      // A unit square frame, four thin bars, so one geometry scales to any size.
      const frame = new THREE.Group();
      const barGeo = this.geometry('frame:bar', () => new THREE.PlaneGeometry(1, 1));
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const T = 0.055;
      const edges: [number, number, number, number][] = [
        [0, 0.5 - T / 2, 1, T],
        [0, -0.5 + T / 2, 1, T],
        [-0.5 + T / 2, 0, T, 1],
        [0.5 - T / 2, 0, T, 1],
      ];
      for (const [x, y, w, h] of edges) {
        const bar = new THREE.Mesh(barGeo, mat);
        bar.position.set(x, y, 0);
        bar.scale.set(w, h, 1);
        frame.add(bar);
      }
      frame.renderOrder = 7;
      group.add(frame);
      this.world.add(group);
      // Reuses the arc bookkeeping: same lifecycle, same reaping.
      a = { group, fill: frame.children[0] as THREE.Mesh, ring: frame.children[0] as THREE.Mesh };
      this.arcs.set(obj, a);
    }
    this.seen.add(obj);
    a.group.visible = obj.visible;
    if (!obj.visible) return;
    a.group.position.set(obj.x, GROUND_Y + 1.6, obj.y);
    a.group.scale.set(obj.width * obj.scaleX, obj.height * obj.scaleY, 1);
    const mat = a.fill.material as THREE.MeshBasicMaterial;
    mat.color.setHex(obj.strokeColor);
    mat.opacity = obj.strokeAlpha * obj.alpha;
  }

  // ---------- the [L] logistics overlay, laid on the ground ----------

  /**
   * The overlay's tile washes and outlines, as decals on the ground plane. The
   * colours come from `overlayCell`, the same pure function the flat view
   * paints with — an isometric player and a flat one are looking at exactly the
   * same diagnosis. (The uptime *labels* are Phaser Text, projected by
   * LogisticsSystem itself.)
   */
  private syncOverlay(now: number): void {
    if (!GameState.overlay) {
      for (const mesh of this.decals) mesh.visible = false;
      return;
    }
    const pulse = Math.sin(now / 140);
    let used = 0;
    const put = (x: number, y: number, w: number, d: number, color: number, alpha: number) => {
      let mesh = this.decals[used];
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.geometry('decal', () => new THREE.PlaneGeometry(1, 1)),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 8;
        this.decals.push(mesh);
        this.world.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(x, GROUND_Y + 2.2, y);
      mesh.scale.set(w, d, 1);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = alpha;
      used += 1;
    };

    for (const b of this.grid.buildings) {
      const px = b.x * TILE;
      const py = b.y * TILE;
      const cell = overlayCell(b, pulse);
      if (cell.fill) put(px + TILE / 2, py + TILE / 2, TILE - 4, TILE - 4, cell.fill.color, cell.fill.alpha);
      if (cell.stroke) {
        // Four edges rather than a wash, so an outlined machine still shows the
        // ground (and its own shadow) underneath.
        const t = 2.5;
        const c = cell.stroke.color;
        const a = cell.stroke.alpha;
        put(px + TILE / 2, py + t / 2, TILE, t, c, a);
        put(px + TILE / 2, py + TILE - t / 2, TILE, t, c, a);
        put(px + t / 2, py + TILE / 2, t, TILE, c, a);
        put(px + TILE - t / 2, py + TILE / 2, t, TILE, c, a);
      }
      if (cell.mag !== undefined && cell.mag > 0) {
        const w = (TILE - 6) * cell.mag;
        put(px + 3 + w / 2, py + TILE - 5, w, 3, 0x6bd4ff, 0.6);
      }
    }
    for (let i = used; i < this.decals.length; i++) this.decals[i].visible = false;
  }

  // ---------- bars & pips, read from the entities ----------

  private bar(x: number, y: number, h: number, w: number, tall: number, color: number, alpha = 1): void {
    if (this.barsUsed >= BAR_CAP) return;
    let mesh = this.bars[this.barsUsed];
    if (!mesh) {
      mesh = new THREE.Mesh(
        this.geometry('bar', () => new THREE.PlaneGeometry(1, 1)),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }),
      );
      // Never buried by the geometry it hovers over: a magazine you can't read
      // is a magazine you don't act on.
      mesh.renderOrder = 20;
      this.bars.push(mesh);
      this.world.add(mesh);
    }
    mesh.visible = true;
    mesh.quaternion.copy(this.billboard);
    mesh.position.set(x, h, y);
    mesh.scale.set(w, tall, 1);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = alpha;
    this.barsUsed += 1;
  }

  /**
   * Bars sit directly above their entity in *world* space. The 2D game offsets
   * them by screen pixels, which an isometric camera would smear sideways —
   * this is why they are rebuilt from the entities rather than mirrored.
   */
  private syncBars(): void {
    const RIGHT = 0.7071; // screen-right, on the ground: (cos45, 0, −sin45)

    for (const b of this.grid.buildings) {
      if (!isTower(b.type)) continue;
      const cap = TOWERS[b.type].ammoCap;
      const model = modelFor(b.type);
      const top = (model?.lift ?? GROUND_Y) + (model?.h ?? 12) + 20;
      const cx = b.x * TILE + TILE / 2;
      const cy = b.y * TILE + TILE / 2;
      const frac = Math.max(0, Math.min(1, b.ammo / cap));
      this.bar(cx, cy, top, 26, 4.5, 0x0b0e16, 0.75);
      if (frac > 0) {
        const w = 24 * frac;
        // Grow from the left edge, like the 2D bar's origin-0 scaleX. Screen-left
        // is a diagonal on the board, hence the RIGHT term on both axes.
        this.bar(cx - (12 - w / 2) * RIGHT, cy + (12 - w / 2) * RIGHT, top, w, 3, AMMO_BAR[b.type] ?? 0xffe066, 1);
      }
      const pip = b.path ? PATH_PIP[b.path] : 0xffe066;
      for (let i = 0; i < b.mk - 1; i++) {
        const off = -10 + i * 7;
        this.bar(cx + off * RIGHT, cy - off * RIGHT, top + 7, 5, 5, pip, 1);
      }
    }

    for (const e of this.enemiesOf()) {
      if (e.dead) continue;
      const model = modelFor(e.kind === 'normal' ? 'enemy' : e.kind);
      const top = (model?.h ?? 12) + 13;
      const frac = Math.max(0, e.hp / e.maxHp);
      if (frac >= 1) continue; // an untouched enemy needs no bar
      const full = e.hpBarW;
      this.bar(e.x, e.y, top, full + 2, 4.5, 0x0b0e16, 0.7);
      const w = full * frac;
      const color = frac > 0.5 ? 0x5ef078 : frac > 0.25 ? 0xffd75e : 0xff5555;
      this.bar(e.x - (full / 2 - w / 2) * RIGHT, e.y + (full / 2 - w / 2) * RIGHT, top, w, 3, color, 1);
    }

    for (let i = this.barsUsed; i < this.bars.length; i++) this.bars[i].visible = false;
  }

  // ---------- lifecycle ----------

  /** Drop proxies whose Phaser object was destroyed or hidden this frame. */
  private reap(): void {
    for (const [obj, p] of this.proxies) {
      if (this.seen.has(obj)) continue;
      this.disposeProxy(p);
      this.proxies.delete(obj);
    }
    for (const [obj, a] of this.arcs) {
      if (this.seen.has(obj)) continue;
      this.world.remove(a.group);
      this.arcs.delete(obj);
    }
  }

  private disposeProxy(p: Proxy): void {
    // Geometry and materials are shared out of the caches — only the nodes go.
    this.world.remove(p.group);
  }

  /** Keep the 3D canvas exactly under the Phaser one, whatever Scale.FIT did. */
  private layout(): void {
    const c = this.game.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.style.left !== `${c.offsetLeft}px`) this.canvas.style.left = `${c.offsetLeft}px`;
    if (this.canvas.style.top !== `${c.offsetTop}px`) this.canvas.style.top = `${c.offsetTop}px`;
    if (this.canvas.clientWidth !== w || this.canvas.clientHeight !== h) {
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.renderer.setSize(w, h, false);
    }
  }

  private draw(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    // The playfield occupies the top slice of the canvas; the HUD bar under it
    // stays flat colour, with Phaser's own HUD painted over the top.
    const playH = Math.round((h * PLAYFIELD_H) / GAME_H);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(COLORS.sky, 1);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(0, h - playH, w, playH);
    this.renderer.setScissor(0, h - playH, w, playH);
    this.renderer.render(this.world, this.camera);
    this.renderer.setScissorTest(false);
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    for (const t of this.textures.values()) t.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const g of this.geometries.values()) g.dispose();
    this.textures.clear();
    this.materials.clear();
    this.geometries.clear();
    this.proxies.clear();
    this.arcs.clear();
    this.renderer.dispose();
    this.canvas.remove();
    this.game.canvas.style.zIndex = '';
    this.game.canvas.style.position = '';
  }
}
