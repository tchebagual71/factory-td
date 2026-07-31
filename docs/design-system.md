# Factory TD design system

## Principles

Factory TD uses a compact industrial command-console language: make the current
factory constraint obvious, keep the next action close to the board, and reserve
the strongest color and contrast for the action that changes the run. The HUD is
an overlay on a shared 2D/3D simulation, so it keeps the same geometry and
interaction language in either renderer. Category color explains *what* a tool
does; a label, outline, or value always explains its state.

## Semantic color tokens

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#081019` | dark foreground on lit controls |
| `surface` | `#101b26` | command panels and cards |
| `surfaceRaised` | `#172635` | slots and hover surfaces |
| `line` / `lineBright` | `#2b4053` / `#45657d` | quiet and emphasized borders |
| `text` / `textMuted` | `#e7eef5` / `#91a4b7` | primary and supporting copy |
| `money` | `#ffd166` | price, funds, and selection rim |
| `logistics` / `production` / `defense` | `#38bdf8` / `#f59e42` / `#fb7185` | build categories |
| `action` | `#52e58c` | send and enabled affirmative actions |
| `warning` / `danger` | `#ffad42` / `#ff5c67` | shortfall and destructive states |
| `research` | `#70e1c1` | research progress and active objective |

## Typography scale

Telemetry and compact control labels use `ui-monospace, SFMono-Regular, Consolas,
monospace`; readable explanation copy uses the system body stack. Desktop primary
and secondary scales are 14px and 12px. Touch primary and secondary scales are
18px and 16px. The compact palette may use 9–13px only inside its fixed command
deck; it drops a name before reducing the icon below 0.7×. Do not add a new
small-text scale for a status message—move it into a roomy card instead.

## Spacing and panel anatomy

The spacing scale is 4, 8, 12, 16, 24, and 32px. Panels use a dark `surface`, a
1–2px semantic outline, and 8px desktop or 12px touch edge clearance. Cards put
the short state/value first, supporting context second, and any progress fill on
the lower edge. The command deck starts 8px below the playfield edge, with 10px
outer padding, 4px compact or 6px roomy gaps, and a deliberate 16px gap between
build-category blocks.

## Control states

`idle` is surface plus a quiet line and primary text. `hover` raises the surface
and brightens its outline. `selected` has a thick gold (`money`) rim and an
explicit `SELECTED` label. `active` uses the action/category fill with ink text.
`disabled` keeps a muted label and quiet line; an unaffordable build slot also
states `NEED $N` in warning color. `danger` uses a danger fill with high-contrast
ink text. State therefore remains visible when hue is unavailable.

## Command rail

The top rail is anchored 8px from the canvas edge. On desktop it is 30px high;
on touch it is 44px high. It groups funds, integrity, and wave telemetry on the
left, then survey and research, while map, view, help, and sound controls are
right-aligned. Touch keeps a 56px labeled 2D/3D view chip and 44px square help
and sound targets. Only interactive chips shield board placement; readouts stay
non-blocking.

## Active contract card

The active objective occupies the upper-left safe zone below the command rail:
280×56px desktop and 320×72px touch. It uses the research outline and lower
progress rail. Keep a single current contract there; completion feedback is
queued as a toast rather than stacked over it.

## Coach strip

The coach strip is centered at the bottom of the playfield, above the command
deck: 420×56px desktop and up to 520×72px touch. A numbered blue badge gives the
onboarding step, then one bold next action and one smaller contextual line. It
advances miner → belt → press → fed defense → wave launch. It is ambient content,
not a modal, and yields whenever higher-priority feedback is present.

## Build command deck

The bottom deck divides `LOGISTICS`, `PRODUCTION`, and `DEFENSE` into contiguous,
color-rimmed shelves. Desktop uses one compact row; roomy and touch layouts use
two rows. Each slot contains an icon, price, and (when its height permits) name;
desktop slots show a hotkey badge, while touch omits keyboard-only copy. Touch
adds Rotate, Sell, and Pause controls beside the palette. Selecting the armed
slot again cancels it.

## Wave command module

The 380px right-side wave cluster shows the next-wave contract above the primary
action. On roomy layouts the preview, send action, and four toggles have separate
rows; compact desktop packs the toggles as a 2×2 block beside Send. The send
action is filled action green during build phase and changes to the outlined
danger `DEFEND!` state during a wave. Preview copy names the enemy type and gives
the relevant counter, with the shorter version in compact layouts.

## Overlay priority and safe zones

Priority is terminal, blocking, report, transient, inspector, then ambient.
Terminal and blocking overlays suppress all lower levels. Reports suppress
ambient/transient content; a toast suppresses ambient content; an inspector may
coexist with ambient content. Objective is upper-left; toast is upper-right;
inspector sits below the toast at upper-right; coach is bottom-center. Desktop
uses an 8px safe-zone pad and touch uses 12px. Never place a new gameplay overlay
outside this policy.

## Responsive behavior

The board stays a 1280×640 logical grid and Phaser fits the canvas to the device.
The HUD grows from 80px desktop to 220–300px for touch/boxy displays, making the
touch deck roomy rather than shrinking it. Device startup derives touch and HUD
height from the viewport, so device emulation must reload after changing size or
orientation. Portrait touch remains a deliberate landscape-only rotation prompt:
the play canvas is hidden until landscape returns.

## Accessibility and reduced-motion direction

The representative Phaser UI is canvas-only: its browser accessibility tree has
the page/root and unnamed canvas, rather than semantic controls. Labels, text,
outlines, icons, and explicit state words provide the current visual baseline,
but are not a substitute for semantic DOM controls. Future accessible work should
add DOM equivalents for critical actions, preserve keyboard parity, offer a
reduced-motion mode for pulses/slides/screenshake, and avoid viewport scaling
locks. Keep high-contrast text on opaque panels and retain the non-color state
cues documented above.

## Screen migration order

1. Apply tokens and control states to title, map, account, and volume controls.
2. Move instructional/help and account flows to the panel anatomy and overlay
   hierarchy.
3. Convert Workshop, achievements, and leaderboard lists to category/card rhythm.
4. Apply the command-card hierarchy to research, wave report, inspector, and
   game-over screens.
5. Verify each migrated screen at desktop, landscape touch, and portrait rotation
   behavior before broadening the visual language further.
