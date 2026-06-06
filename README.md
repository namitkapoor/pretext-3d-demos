# Pretext × Three.js Demos

A small collection of WebGL/Three.js experiments that take **DOM-free text
layout** into 3D space. Several of these drive Three.js geometry from
[`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) — a pure
JS/TS library that measures and wraps multiline text using the browser's font
engine as ground truth, without ever touching `getBoundingClientRect` or
triggering layout reflow. That makes per-frame text positioning cheap enough to
feed straight into a render loop.

> Built on top of Pretext by [@chenglou](https://github.com/chenglou). The
> demos here are my own; the underlying layout library is consumed as a
> published npm dependency.

## Demos

| Demo | What it shows |
|-|-|
| **Interactive Card** (`three-interactive-card`) | Word clusters as physics-based UI on a 3D surface. Nav items, headline, and body are independent spring clusters — hover lifts, click scatters, the Pretext layout is the rest attractor. |
| **Three Words** (`three-words`) | Words as interactive 3D particles. Pretext line positions become spring attractors in Three.js space; hover to lift, click to scatter. |
| **Three Texture** (`three-texture`) | Pretext text rendered onto a live canvas texture mapped to a rotating 3D card. Drag the width slider to reflow the wrapped text in real time. |
| **Cloth Physics** (`three-cloth`) | Pretext text as a canvas texture on an Ammo.js soft-body cloth that hangs from a fixed edge and ripples under oscillating wind forces. |
| **GLB T-Shirt Explorer** (`three-glb-tshirt`) | Loads a GLB t-shirt, prints the full scene hierarchy with per-mesh vertex counts, and assesses physics feasibility for each mesh. |
| **Pola Mother's Day** (`pola-mothersday`) | Recreation of the Pola "We Care More" site — instanced bouquet with per-instance sine float, scroll-driven camera, mouse parallax, and `IntersectionObserver` text reveal. |
| **T-Shirt Cloth Physics** (`three-tshirt-physics`) | Verlet cloth on a subsampled proxy mesh; deformation transfers back to the full ~40k-vert shirt each frame via weighted nearest-proxy interpolation. |

## Running locally

Requires [Bun](https://bun.sh) (the demos use import attributes and `.ts`/asset
imports that Bun's dev server bundles directly).

```sh
bun install
bun start          # serves demos/index.html with live bundling
```

Then open the printed local URL and pick a demo from the landing page. You can
also serve a single demo directly, e.g. `bun demos/three-cloth.html`.

## Capturing screenshots

`capture-demos.mjs` is a Playwright script that walks a deployed demo index and
saves screenshots + videos to `demo-captures/` (gitignored).

```sh
bun run capture
```

## Notes

- `three-cloth` ships a vendored `ammo.wasm.js` / `ammo.wasm.wasm` for soft-body
  physics.
- `three-glb-tshirt` and `three-tshirt-physics` load `t-shirt_vandalisme.glb`.
- The four text-driven demos import `prepareWithSegments` / `layoutWithLines`
  from `@chenglou/pretext`; the GLB and Pola demos are standalone Three.js.
