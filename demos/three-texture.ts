/**
 * three-texture — PreText layout as a live canvas texture on a 3D surface
 *
 * An offscreen Canvas 2D holds the text rendered by PreText. That canvas
 * becomes a THREE.CanvasTexture mapped onto a rotating card. The width
 * slider triggers a live reflow — PreText recomputes the line breaks and
 * the texture updates in place on the spinning geometry.
 *
 * This demonstrates the key insight: PreText does not require the DOM.
 * It can drive any surface that accepts pixel data — including WebGL textures.
 */

import * as THREE from 'three'
import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from '@chenglou/pretext'

// ── Config ────────────────────────────────────────────────────────────────────

const TEXT = `Typography began as a craft of lead and pressure. Each character cast in metal, locked in a chase, pressed into paper — the entire poem held in physical space before a single reader arrived.

Pretext inherits that precision: measuring every glyph against the browser's own font engine, resolving line breaks the way the browser would, without ever touching the DOM.

Here, those same measurements drive a live texture on a three-dimensional surface. Drag the width slider and watch the lines reflow — the same arithmetic that once lived in a compositor's hands, now running at sixty frames per second on the GPU.`

const FONT_SIZE = 16
const LINE_HEIGHT = 27
const FONT = `${FONT_SIZE}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`
const CANVAS_W = 760
const CANVAS_H = 570
const MARGIN = 44
const CARD_ASPECT = CANVAS_W / CANVAS_H   // 4:3-ish

// ── Three.js setup ────────────────────────────────────────────────────────────

const glCanvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0c0c10)
scene.fog = new THREE.Fog(0x0c0c10, 12, 22)

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0, 0, 7)

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(ambient)

const keyLight = new THREE.DirectionalLight(0xfff5e0, 2.2)
keyLight.position.set(3, 4, 5)
keyLight.castShadow = true
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x8899cc, 0.6)
fillLight.position.set(-4, -1, -3)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xffddaa, 0.4)
rimLight.position.set(0, -3, -4)
scene.add(rimLight)

// ── Offscreen canvas + texture ────────────────────────────────────────────────

const offCanvas = document.createElement('canvas')
offCanvas.width = CANVAS_W
offCanvas.height = CANVAS_H
const ctx = offCanvas.getContext('2d')!

const cardTexture = new THREE.CanvasTexture(offCanvas)
cardTexture.colorSpace = THREE.SRGBColorSpace
cardTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

// ── 3D Card ───────────────────────────────────────────────────────────────────

const CARD_H_WORLD = 3.2
const CARD_W_WORLD = CARD_H_WORLD * CARD_ASPECT

// Main face material
const faceMat = new THREE.MeshStandardMaterial({
  map: cardTexture,
  roughness: 0.28,
  metalness: 0.04,
})

// Edge / back materials
const edgeMat = new THREE.MeshStandardMaterial({
  color: 0x1c1810,
  roughness: 0.85,
  metalness: 0.0,
})
const backMat = new THREE.MeshStandardMaterial({
  color: 0x2a241c,
  roughness: 0.6,
  metalness: 0.02,
})

const cardGeo = new THREE.BoxGeometry(CARD_W_WORLD, CARD_H_WORLD, 0.025)
// BoxGeometry face order: right, left, top, bottom, front, back
const card = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat])
card.castShadow = true
scene.add(card)

// Subtle reflection plane below card
const planeGeo = new THREE.PlaneGeometry(14, 10)
const planeMat = new THREE.MeshStandardMaterial({
  color: 0x0c0c10,
  roughness: 0.95,
  metalness: 0.1,
  transparent: true,
  opacity: 0.7,
})
const plane = new THREE.Mesh(planeGeo, planeMat)
plane.rotation.x = -Math.PI / 2
plane.position.y = -2.8
plane.receiveShadow = true
scene.add(plane)

// ── Text rendering onto offscreen canvas ──────────────────────────────────────

let prepared: PreparedTextWithSegments | null = null

function drawText(layoutWidth: number): void {
  // ── Background
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H)
  grad.addColorStop(0, '#faf4e8')
  grad.addColorStop(1, '#f3ead8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // ── Top rule + label
  ctx.strokeStyle = '#c8b498'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, MARGIN + 20)
  ctx.lineTo(CANVAS_W - MARGIN, MARGIN + 20)
  ctx.stroke()

  ctx.fillStyle = '#a08060'
  ctx.font = '600 10px "Helvetica Neue", Helvetica, sans-serif'
  ctx.letterSpacing = '0.12em'
  ctx.fillText('PRETEXT  ·  THREE.JS', MARGIN, MARGIN + 14)
  ctx.letterSpacing = '0'

  // ── Body text via PreText
  if (prepared === null) {
    prepared = prepareWithSegments(TEXT, FONT)
  }
  const { lines } = layoutWithLines(prepared, layoutWidth, LINE_HEIGHT)

  ctx.fillStyle = '#1e1810'
  ctx.font = FONT

  const paragraphBreaks = new Set<number>()
  let lineAccum = 0
  for (const _para of TEXT.split('\n\n')) {
    const paraLines = layoutWithLines(prepared, layoutWidth, LINE_HEIGHT).lines
    // Detect paragraph seams by scanning raw text breaks
    lineAccum += paraLines.length
    paragraphBreaks.add(lineAccum)
  }

  const textTop = MARGIN + 38
  for (let i = 0; i < lines.length; i++) {
    const y = textTop + i * LINE_HEIGHT + FONT_SIZE
    if (y + LINE_HEIGHT > CANVAS_H - MARGIN) break
    ctx.fillText(lines[i]!.text, MARGIN, y)
  }

  // ── Bottom rule
  const textBottom = textTop + lines.length * LINE_HEIGHT
  const ruleY = Math.min(textBottom + 10, CANVAS_H - MARGIN)
  if (ruleY < CANVAS_H - 8) {
    ctx.strokeStyle = '#c8b498'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN, ruleY)
    ctx.lineTo(CANVAS_W - MARGIN, ruleY)
    ctx.stroke()
  }

  // ── Subtle inner vignette
  const vig = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.2,
    CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75,
  )
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.06)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  cardTexture.needsUpdate = true
}

// ── Controls ──────────────────────────────────────────────────────────────────

const slider = document.getElementById('width-slider') as HTMLInputElement
const label = document.getElementById('width-label') as HTMLSpanElement

let currentW = Number.parseInt(slider.value, 10)
drawText(currentW)

slider.addEventListener('input', () => {
  currentW = Number.parseInt(slider.value, 10)
  label.textContent = `${currentW}px`
  drawText(currentW)
})

// ── Pointer drag to rotate ────────────────────────────────────────────────────

let isDragging = false
let prevX = 0
let prevY = 0
let rotVX = 0
let rotVY = 0

glCanvas.addEventListener('pointerdown', e => {
  isDragging = true
  prevX = e.clientX
  prevY = e.clientY
  rotVX = 0
  rotVY = 0
})
window.addEventListener('pointerup', () => { isDragging = false })
window.addEventListener('pointermove', e => {
  if (!isDragging) return
  rotVY = (e.clientX - prevX) * 0.012
  rotVX = (e.clientY - prevY) * 0.012
  prevX = e.clientX
  prevY = e.clientY
})

// ── Render loop ───────────────────────────────────────────────────────────────

function tick(): void {
  requestAnimationFrame(tick)

  if (!isDragging) {
    card.rotation.y += 0.0045
  } else {
    card.rotation.y += rotVY
    card.rotation.x = THREE.MathUtils.clamp(card.rotation.x + rotVX, -Math.PI / 3, Math.PI / 3)
  }

  // Dampen drag velocity
  rotVX *= 0.88
  rotVY *= 0.88

  // Subtle vertical float
  card.position.y = Math.sin(performance.now() * 0.0006) * 0.08

  renderer.render(scene, camera)
}

tick()

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
