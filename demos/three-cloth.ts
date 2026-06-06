/**
 * three-cloth — Ammo.js soft body cloth with PreText canvas texture
 *
 * An Ammo.js soft body hangs from its pinned top edge. PreText lays out
 * text onto an offscreen canvas that becomes the cloth's material map.
 * Oscillating wind forces keep the fabric in motion; clicking the cloth
 * fires a localized radial gust at the intersection point.
 */

import * as THREE from 'three'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
// @ts-ignore - ammo.wasm.js has no TS types and uses CJS exports
import AmmoFactory from './ammo.wasm.js'
// @ts-ignore - bun serves .wasm files as URL assets when imported with { type: 'url' }
import ammoWasmUrl from './ammo.wasm.wasm' with { type: 'url' }

// ── Config ────────────────────────────────────────────────────────────────────

const CLOTH_W = 5.0
const CLOTH_H = 3.4
const SEGS_X = 36   // 37 nodes per row
const SEGS_Y = 24   // 25 rows

const GRAVITY = -9.8

// WIND_BASE × windMultiplier = effective force per node per frame.
// With 925 nodes and mass 0.9 kg: node m_im ≈ 1027.
// At multiplier 3.0: effective = 0.003 → accel ≈ 3.1 m/s² (strong breeze).
const WIND_BASE = 0.001

// Click gust: large localized impulse applied radially from the hit point.
// Falls off linearly to zero at GUST_RADIUS world units. Envelope decays
// quadratically over GUST_DURATION seconds.
const GUST_PEAK = 0.07
const GUST_RADIUS = 2.2
const GUST_DURATION = 0.5

const TEX_W = 1024
const TEX_H = 716
const MARGIN = 50
const FONT_SIZE = 21
const LINE_HEIGHT = 36
const FONT = `${FONT_SIZE}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`

const BODY_TEXT = `Typography began as a craft of lead and pressure. Each character cast in metal, locked in a chase, pressed into paper — the entire poem held in physical space before a single reader arrived.

Pretext inherits that precision: measuring every glyph against the browser's own font engine, resolving line breaks the way the browser would, without ever touching the DOM.

Here, those same measurements drive a live texture on a cloth simulated by Ammo.js soft body physics. The solver moves the vertices; the canvas texture carries the type.`

// ── Mutable state ─────────────────────────────────────────────────────────────

let windMultiplier = 3.0
let currentMass = 0.9
let gustTimeLeft = 0
const gustOrigin = new THREE.Vector3()

// ── Three.js ──────────────────────────────────────────────────────────────────

const glCanvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x08080e)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 0.3, 8.5)

scene.add(new THREE.AmbientLight(0xffffff, 0.4))

const keyLight = new THREE.DirectionalLight(0xfff6e0, 2.8)
keyLight.position.set(4, 5, 8)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(1024, 1024)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x8899cc, 0.8)
fillLight.position.set(-5, 1, -4)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xffddaa, 0.5)
rimLight.position.set(0, -4, -6)
scene.add(rimLight)

// ── Canvas Texture ────────────────────────────────────────────────────────────

const offCanvas = document.createElement('canvas')
offCanvas.width = TEX_W
offCanvas.height = TEX_H
const ctx = offCanvas.getContext('2d')!

const clothTexture = new THREE.CanvasTexture(offCanvas)
clothTexture.colorSpace = THREE.SRGBColorSpace
clothTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

;(function drawTexture() {
    // White cloth — warm off-white so it reads as fabric under directional light
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_H)
    grad.addColorStop(0, '#faf8f2')
    grad.addColorStop(1, '#f3f0e8')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    ctx.strokeStyle = 'rgba(80, 60, 30, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN, MARGIN + 24)
    ctx.lineTo(TEX_W - MARGIN, MARGIN + 24)
    ctx.stroke()

    ctx.fillStyle = 'rgba(140, 100, 40, 0.7)'
    ctx.font = '600 11px "Helvetica Neue", Helvetica, sans-serif'
    ctx.letterSpacing = '0.15em'
    ctx.fillText('PRETEXT  ·  THREE.JS', MARGIN, MARGIN + 15)
    ctx.letterSpacing = '0'

    const prepared = prepareWithSegments(BODY_TEXT, FONT)
    const { lines } = layoutWithLines(prepared, TEX_W - MARGIN * 2, LINE_HEIGHT)

    ctx.fillStyle = 'rgba(20, 16, 10, 0.82)'
    ctx.font = FONT

    const textTop = MARGIN + 38
    for (let i = 0; i < lines.length; i++) {
        const y = textTop + i * LINE_HEIGHT + FONT_SIZE
        if (y + LINE_HEIGHT > TEX_H - MARGIN) break
        ctx.fillText(lines[i]!.text, MARGIN, y)
    }

    ctx.strokeStyle = 'rgba(80, 60, 30, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN, TEX_H - MARGIN)
    ctx.lineTo(TEX_W - MARGIN, TEX_H - MARGIN)
    ctx.stroke()

    clothTexture.needsUpdate = true
})()

// ── Cloth Mesh ────────────────────────────────────────────────────────────────

// PlaneGeometry vertex 0 = top-left (iy=0, ix=0) → Ammo node 0 = corner00.
// The full (SEGS_X+1)×(SEGS_Y+1) grid maps 1:1 between geometry vertices and
// soft-body nodes, so physics positions can be written into the buffer directly.
const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, SEGS_X, SEGS_Y)
const clothMat = new THREE.MeshStandardMaterial({
    map: clothTexture,
    side: THREE.DoubleSide,
    roughness: 0.76,
    metalness: 0.0,
})
const clothMesh = new THREE.Mesh(clothGeo, clothMat)
clothMesh.castShadow = true
clothMesh.receiveShadow = true
scene.add(clothMesh)

// ── Raycaster (click interaction) ─────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const mouseNDC = new THREE.Vector2()

// ── Physics ────────────────────────────────────────────────────────────────────

let physicsWorld: any
let softBody: any
let windVec: any    // reused each frame — avoids Emscripten heap churn
let perNodeVec: any // reused per-node inside applyGust

function initPhysics(ammo: any): void {
    const config = new ammo.btSoftBodyRigidBodyCollisionConfiguration()
    const dispatcher = new ammo.btCollisionDispatcher(config)
    const broadphase = new ammo.btDbvtBroadphase()
    const solver = new ammo.btSequentialImpulseConstraintSolver()
    const softSolver = new ammo.btDefaultSoftBodySolver()

    physicsWorld = new ammo.btSoftRigidDynamicsWorld(dispatcher, broadphase, solver, config, softSolver)
    physicsWorld.setGravity(new ammo.btVector3(0, GRAVITY, 0))
    physicsWorld.getWorldInfo().set_m_gravity(new ammo.btVector3(0, GRAVITY, 0))

    const helpers = new ammo.btSoftBodyHelpers()
    const hW = CLOTH_W / 2
    const hH = CLOTH_H / 2

    // Corners must match PlaneGeometry vertex order: top-left first, row-major
    const c00 = new ammo.btVector3(-hW,  hH, 0)   // top-left  → node 0
    const c01 = new ammo.btVector3( hW,  hH, 0)   // top-right → node SEGS_X
    const c10 = new ammo.btVector3(-hW, -hH, 0)   // bottom-left
    const c11 = new ammo.btVector3( hW, -hH, 0)   // bottom-right

    softBody = helpers.CreatePatch(
        physicsWorld.getWorldInfo(),
        c00, c01, c10, c11,
        SEGS_X + 1, SEGS_Y + 1,
        0, true,
    )

    const cfg = softBody.get_m_cfg()
    cfg.set_viterations(15)
    cfg.set_piterations(15)

    softBody.setTotalMass(currentMass, false)
    ammo.castObject(softBody, ammo.btCollisionObject).getCollisionShape().setMargin(0.05 * 3)
    physicsWorld.addSoftBody(softBody, 1, -1)
    softBody.setActivationState(4)

    // Pin the entire top row so the cloth hangs from a fixed rail
    for (let ix = 0; ix <= SEGS_X; ix++) softBody.setMass(ix, 0)

    windVec = new ammo.btVector3(0, 0, 0)
    perNodeVec = new ammo.btVector3(0, 0, 0)
}

// Radial gust: push cloth toward camera (+Z) with per-node falloff.
// Only runs while gustTimeLeft > 0; envelope decays quadratically.
function applyGust(dt: number): void {
    if (gustTimeLeft <= 0) return
    gustTimeLeft = Math.max(0, gustTimeLeft - dt)

    const progress = gustTimeLeft / GUST_DURATION     // 1 → 0
    const envelope = progress * progress               // quadratic decay
    const baseForce = GUST_PEAK * envelope

    const nodes = softBody.get_m_nodes()
    const count = nodes.size()
    const topRowCount = SEGS_X + 1

    for (let i = topRowCount; i < count; i++) {
        const pos = nodes.at(i).get_m_x()
        const dx = pos.x() - gustOrigin.x
        const dy = pos.y() - gustOrigin.y
        const dz = pos.z() - gustOrigin.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const falloff = Math.max(0, 1 - dist / GUST_RADIUS)
        if (falloff <= 0) continue
        perNodeVec.setValue(0, 0, baseForce * falloff)
        softBody.addForce(perNodeVec, i)
    }
}

function updatePhysics(dt: number, time: number): void {
    const ew = WIND_BASE * windMultiplier
    const wx = (Math.sin(time * 0.55) * 0.7 + Math.sin(time * 1.15) * 0.3) * ew
    const wz = Math.cos(time * 0.38) * ew * 0.25
    windVec.setValue(wx, 0, wz)
    softBody.addForce(windVec)

    applyGust(dt)

    physicsWorld.stepSimulation(dt, 10)

    const posAttr = clothMesh.geometry.attributes['position'] as THREE.BufferAttribute
    const positions = posAttr.array as Float32Array
    const nodes = softBody.get_m_nodes()

    for (let i = 0, n = positions.length / 3; i < n; i++) {
        const pos = nodes.at(i).get_m_x()
        positions[i * 3]     = pos.x()
        positions[i * 3 + 1] = pos.y()
        positions[i * 3 + 2] = pos.z()
    }

    clothMesh.geometry.computeVertexNormals()
    clothMesh.geometry.computeBoundingSphere()   // keep raycasting accurate vs deformed mesh
    posAttr.needsUpdate = true
    ;(clothMesh.geometry.attributes['normal'] as THREE.BufferAttribute).needsUpdate = true
}

// ── Click → gust ──────────────────────────────────────────────────────────────

glCanvas.addEventListener('click', e => {
    if (!softBody) return
    mouseNDC.set(
        (e.clientX / innerWidth) * 2 - 1,
        -(e.clientY / innerHeight) * 2 + 1,
    )
    raycaster.setFromCamera(mouseNDC, camera)
    const hits = raycaster.intersectObject(clothMesh)
    gustOrigin.copy(hits.length > 0 ? hits[0]!.point : new THREE.Vector3(0, 0, 0))
    gustTimeLeft = GUST_DURATION
})

// ── Controls ──────────────────────────────────────────────────────────────────

const windSlider  = document.getElementById('wind-slider')  as HTMLInputElement
const windVal     = document.getElementById('wind-val')     as HTMLSpanElement
const weightSlider = document.getElementById('weight-slider') as HTMLInputElement
const weightVal   = document.getElementById('weight-val')   as HTMLSpanElement

windSlider.addEventListener('input', () => {
    windMultiplier = parseFloat(windSlider.value)
    windVal.textContent = `${windMultiplier.toFixed(1)}×`
})

weightSlider.addEventListener('input', () => {
    currentMass = parseFloat(weightSlider.value)
    weightVal.textContent = `${currentMass.toFixed(2)} kg`
    if (!softBody) return
    softBody.setTotalMass(currentMass, false)
    // Re-pin top row: setTotalMass skips nodes with m_im=0 already,
    // but guard anyway so the cloth never accidentally falls away.
    for (let ix = 0; ix <= SEGS_X; ix++) softBody.setMass(ix, 0)
})

// ── Render Loop ────────────────────────────────────────────────────────────────

const clock = new THREE.Clock()

function tick(): void {
    requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.05)
    const time = clock.getElapsedTime()
    if (physicsWorld) updatePhysics(dt, time)
    renderer.render(scene, camera)
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

AmmoFactory({ locateFile: (filename: string) => filename.endsWith('.wasm') ? ammoWasmUrl : filename })
    .then((ammoLib: any) => {
        initPhysics(ammoLib)
        clock.start()
        tick()
    })

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
})
