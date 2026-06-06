/**
 * three-words — words as interactive 3D particles
 *
 * PreText computes the exact pixel position of every word in the paragraph.
 * Those positions become attractors in 3D space. Words scatter on load and
 * on click, then spring back to their typographically correct locations.
 * Hovering lifts a word toward the viewer.
 */

import * as THREE from 'three'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

// ── Config ────────────────────────────────────────────────────────────────────

const TEXT = [
  'Typography is the craft of arranging type to make language visible.',
  'Pretext computes where every glyph lives — no DOM, no reflow,',
  'pure arithmetic over cached measurements.',
  'Three.js renders the geometry.',
  'The layout is the attractor.',
].join(' ')

const FONT = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 50
const LAYOUT_WIDTH = 660
const PX_TO_WORLD = 1 / 88
const SPRING_K = 0.06
const DAMPING = 0.74
const SCATTER_RADIUS = 10

// ── Measurement canvas ────────────────────────────────────────────────────────

const mCanvas = document.createElement('canvas')
const mCtx = mCanvas.getContext('2d')!
mCtx.font = FONT

function measure(text: string): number {
  return mCtx.measureText(text).width
}

// ── Three.js ──────────────────────────────────────────────────────────────────

const canvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x050508, 0.028)

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 200)
camera.position.set(0, 0, 10)

// Subtle background particles for depth
const bgGeo = new THREE.BufferGeometry()
const bgPositions = new Float32Array(300 * 3)
for (let i = 0; i < 300; i++) {
  bgPositions[i * 3 + 0] = (Math.random() - 0.5) * 24
  bgPositions[i * 3 + 1] = (Math.random() - 0.5) * 16
  bgPositions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 4
}
bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3))
const bgMat = new THREE.PointsMaterial({ color: 0x334466, size: 0.03, transparent: true, opacity: 0.6 })
scene.add(new THREE.Points(bgGeo, bgMat))

// ── Word layout via PreText ───────────────────────────────────────────────────

type WordDatum = {
  text: string
  cx: number   // center x in PreText pixel space (left-origin)
  cy: number   // center y in PreText pixel space (top-origin)
  pw: number   // pixel width of word
  ph: number   // pixel height (= word height for the canvas texture)
}

const prepared = prepareWithSegments(TEXT, FONT)
const { lines } = layoutWithLines(prepared, LAYOUT_WIDTH, LINE_HEIGHT)

const wordData: WordDatum[] = []
const spaceW = measure(' ')
const wordPixelHeight = LINE_HEIGHT * 0.78
const totalH = lines.length * LINE_HEIGHT

for (let li = 0; li < lines.length; li++) {
  const lineWords = lines[li]!.text.split(' ').filter(w => w.length > 0)
  let xCursor = 0
  for (const word of lineWords) {
    const pw = measure(word)
    wordData.push({
      text: word,
      cx: xCursor + pw / 2,
      cy: li * LINE_HEIGHT + LINE_HEIGHT / 2,
      pw,
      ph: wordPixelHeight,
    })
    xCursor += pw + spaceW
  }
}

// Convert PreText pixel coords → centered Three.js world coords
const halfW = (LAYOUT_WIDTH / 2) * PX_TO_WORLD
const halfH = (totalH / 2) * PX_TO_WORLD

function toWorld(cx: number, cy: number): THREE.Vector3 {
  return new THREE.Vector3(
    cx * PX_TO_WORLD - halfW,
    -(cy * PX_TO_WORLD - halfH),
    0,
  )
}

// ── Build word meshes ─────────────────────────────────────────────────────────

function makeWordTexture(text: string, pw: number, ph: number): THREE.CanvasTexture {
  const pad = 12
  const wc = document.createElement('canvas')
  wc.width = Math.ceil(pw) + pad * 2
  wc.height = Math.ceil(ph) + pad
  const ctx = wc.getContext('2d')!
  ctx.font = FONT
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, pad, ph * 0.84)
  return new THREE.CanvasTexture(wc)
}

type WordMesh = {
  mesh: THREE.Mesh
  rest: THREE.Vector3
  vel: THREE.Vector3
}

const wordMeshes: WordMesh[] = []
const allMeshes: THREE.Mesh[] = []

for (const d of wordData) {
  const pad = 12
  const tcW = (d.pw + pad * 2) * PX_TO_WORLD
  const tcH = (d.ph + pad) * PX_TO_WORLD

  const geo = new THREE.PlaneGeometry(tcW, tcH)
  const mat = new THREE.MeshBasicMaterial({
    map: makeWordTexture(d.text, d.pw, d.ph),
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)

  // Start scattered
  const angle = Math.random() * Math.PI * 2
  const r = SCATTER_RADIUS * (0.5 + Math.random() * 0.5)
  mesh.position.set(
    Math.cos(angle) * r,
    Math.sin(angle) * r,
    (Math.random() - 0.5) * 5,
  )

  scene.add(mesh)
  wordMeshes.push({ mesh, rest: toWorld(d.cx, d.cy), vel: new THREE.Vector3() })
  allMeshes.push(mesh)
}

// ── Interaction ───────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2(-9, -9)

window.addEventListener('mousemove', e => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1
  pointer.y = -(e.clientY / innerHeight) * 2 + 1
})

window.addEventListener('click', () => {
  for (const w of wordMeshes) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.3 + Math.random() * 0.5
    w.vel.set(
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      (Math.random() - 0.5) * 0.4,
    )
  }
})

// ── Render loop ───────────────────────────────────────────────────────────────

const hoverTarget = new THREE.Vector3()

function tick(): void {
  requestAnimationFrame(tick)

  raycaster.setFromCamera(pointer, camera)
  const hitObjects = new Set(raycaster.intersectObjects(allMeshes).map((h: THREE.Intersection) => h.object))

  for (const w of wordMeshes) {
    const isHovered = hitObjects.has(w.mesh)

    // Spring target: lift toward camera on hover, else snap to PreText rest pos
    if (isHovered) {
      hoverTarget.set(w.rest.x, w.rest.y, 2.2)
    } else {
      hoverTarget.copy(w.rest)
    }

    // Verlet-style spring
    w.vel.addScaledVector(hoverTarget.clone().sub(w.mesh.position), SPRING_K)
    w.vel.multiplyScalar(DAMPING)
    w.mesh.position.add(w.vel)

    // Tilt toward viewer on hover
    const targetRotY = isHovered ? 0.18 : 0
    w.mesh.rotation.y += (targetRotY - w.mesh.rotation.y) * 0.12

    // Fade by z distance — words deep in space recede
    const mat = w.mesh.material as THREE.MeshBasicMaterial
    const zDepth = Math.abs(w.mesh.position.z)
    mat.opacity = THREE.MathUtils.clamp(1 - zDepth * 0.09, 0.08, 1)
    // Tint hovered words warm
    mat.color.setHSL(0, 0, isHovered ? 1 : 0.9)
  }

  renderer.render(scene, camera)
}

tick()

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
