# Pretext × Three.js Demos

A set of WebGL/Three.js experiments I built to explore what happens when text
layout stops being a flat, static thing and becomes a live input to a 3D render
loop. Each demo treats wrapped, measured text as raw material — positions to
turn into physics attractors, a canvas surface to drape over geometry, or a
texture to simulate as cloth.

The through-line is **per-frame text without layout reflow**. Reading
`getBoundingClientRect`/`offsetHeight` mid-animation is one of the most
expensive things you can do in a browser, so I drive these from
[`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext), which
measures and wraps text against the browser's own font engine without touching
the DOM. That makes it cheap enough to recompute layout every frame and feed it
straight into Three.js.

## What's here

Seven demos, each its own self-contained study:

### Text as physics
- **Interactive Card** (`three-interactive-card`) — A 3D UI where every word is
  its own spring cluster. Nav items, headline, and body settle into a measured
  layout as their rest state; hover lifts a cluster, click scatters it, and the
  layout pulls everything back.
- **Three Words** (`three-words`) — Words as interactive 3D particles. Each
  line's measured position becomes a spring attractor in 3D space. Hover to
  lift, click to scatter, watch them reassemble.

### Text on surfaces
- **Three Texture** (`three-texture`) — Text rendered to a live canvas texture
  mapped onto a rotating 3D card. A width slider reflows the wrapped text in
  real time, re-rasterizing the texture as you drag.
- **Cloth Physics** (`three-cloth`) — That same text-on-canvas approach, but the
  surface is an Ammo.js soft-body cloth hanging from a fixed top edge, rippling
  under oscillating wind forces you can dial with sliders.

### 3D / simulation studies
- **GLB T-Shirt Explorer** (`three-glb-tshirt`) — Loads a GLB garment, walks the
  full scene graph, prints per-mesh vertex counts, and assesses physics
  feasibility for each mesh. The groundwork for the cloth demo below.
- **T-Shirt Cloth Physics** (`three-tshirt-physics`) — A Verlet cloth solver
  running on a subsampled proxy mesh, with deformation transferred back to the
  full ~40k-vertex shirt each frame via weighted nearest-proxy interpolation.
- **Pola Mother's Day** (`pola-mothersday`) — A recreation of the Pola "We Care
  More" site: an instanced bouquet with per-instance sine-wave float, a
  scroll-driven camera path, mouse parallax, and `IntersectionObserver`-driven
  text reveals.

## Running locally

Requires [Bun](https://bun.sh) — the demos use import attributes and direct
`.ts`/asset imports that Bun's dev server bundles on the fly.

```sh
bun install
bun start          # serves demos/index.html with live bundling
```

Open the printed local URL and pick a demo from the landing page. To run a
single demo directly:

```sh
bun demos/three-cloth.html
```

## Capturing screenshots

`capture-demos.mjs` is a Playwright script that walks a deployed demo index and
saves screenshots + videos to `demo-captures/` (gitignored):

```sh
bun run capture
```

## Implementation notes

- The text-driven demos (`three-interactive-card`, `three-words`,
  `three-texture`, `three-cloth`) pull `prepareWithSegments` / `layoutWithLines`
  from [`@chenglou/pretext`](https://github.com/chenglou/pretext) and build
  everything else — the spring systems, texture pipeline, and physics — on top.
- `three-cloth` ships a vendored `ammo.wasm.js` / `ammo.wasm.wasm` for
  soft-body physics.
- `three-glb-tshirt` and `three-tshirt-physics` load `t-shirt_vandalisme.glb`.
- The GLB explorer and Pola demos are standalone Three.js with no text-layout
  dependency.
