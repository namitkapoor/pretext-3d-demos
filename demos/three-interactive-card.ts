/**
 * three-interactive-card — word clusters as physics-based UI on a 3D surface
 *
 * PreText computes exact word positions on a virtual layout canvas.
 * Each word becomes its own 3D mesh, parented to a rotating card group.
 * Spring physics runs in card-local space so words snap back to their
 * typographic rest positions no matter how the card is oriented.
 *
 * Nav items are independent button clusters. Headline and body are
 * separate clusters. Hover lifts a cluster off the surface. Click scatters it.
 * This is the pattern: text clusters as interactive UI elements on a
 * skeuomorphic 3D surface — buttons, labels, paragraphs alike.
 */

import * as THREE from 'three'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

// ── Layout constants (virtual pixel canvas) ───────────────────────────────────

const PX_W = 760
const PX_H = 570
const MARGIN = 44

const CARD_H_WORLD = 3.2
const CARD_W_WORLD = CARD_H_WORLD * (PX_W / PX_H)
const CARD_DEPTH = 0.025
const FACE_Z = CARD_DEPTH / 2 + 0.001   // just above card front face

// pixel (x,y) → card-local 3D position
function px(x: number, y: number, zOff = 0): THREE.Vector3 {
  return new THREE.Vector3(
    (x / PX_W) * CARD_W_WORLD - CARD_W_WORLD / 2,
    -((y / PX_H) * CARD_H_WORLD - CARD_H_WORLD / 2),
    FACE_Z + zOff,
  )
}

// ── Measurement canvas ────────────────────────────────────────────────────────

const mCanvas = document.createElement('canvas')
const mCtx = mCanvas.getContext('2d')!
function measure(text: string, font: string): number {
  mCtx.font = font
  return mCtx.measureText(text).width
}

// ── Three.js scene ────────────────────────────────────────────────────────────

const glCanvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a0d)
scene.fog = new THREE.Fog(0x0a0a0d, 12, 22)

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0, 0, 7)

scene.add(new THREE.AmbientLight(0xffffff, 0.35))
const keyLight = new THREE.DirectionalLight(0xfff5e0, 2.4)
keyLight.position.set(3, 4, 5)
scene.add(keyLight)
const fillLight = new THREE.DirectionalLight(0x8899dd, 0.5)
fillLight.position.set(-4, -1, -3)
scene.add(fillLight)
const rimLight = new THREE.DirectionalLight(0xffddaa, 0.3)
rimLight.position.set(0, -3, -5)
scene.add(rimLight)

// Reflection plane
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 10),
  new THREE.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 0.95, metalness: 0.08, transparent: true, opacity: 0.65 }),
)
plane.rotation.x = -Math.PI / 2
plane.position.y = -2.8
scene.add(plane)

// ── Card group ────────────────────────────────────────────────────────────────

const cardGroup = new THREE.Group()
scene.add(cardGroup)

const cardGeo = new THREE.BoxGeometry(CARD_W_WORLD, CARD_H_WORLD, CARD_DEPTH)
const faceMat = new THREE.MeshStandardMaterial({ color: 0x100e0b, roughness: 0.75, metalness: 0.0 })
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1c1810, roughness: 0.9, metalness: 0.0 })
const backMat = new THREE.MeshStandardMaterial({ color: 0x1a1510, roughness: 0.6, metalness: 0.03 })
// BoxGeometry face order: +x, -x, +y, -y, +z (front), -z (back)
cardGroup.add(new THREE.Mesh(cardGeo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]))

// Subtle top-rule line on card face
const ruleGeo = new THREE.PlaneGeometry(CARD_W_WORLD - (MARGIN / PX_W) * CARD_W_WORLD * 2, 0.003)
const ruleMat = new THREE.MeshBasicMaterial({ color: 0x3a3020, transparent: true, opacity: 0.9 })
const ruleMesh = new THREE.Mesh(ruleGeo, ruleMat)
ruleMesh.position.set(0, CARD_H_WORLD / 2 - (80 / PX_H) * CARD_H_WORLD, FACE_Z)
cardGroup.add(ruleMesh)

// ── Types ─────────────────────────────────────────────────────────────────────

type WordEntry = {
  mesh: THREE.Mesh
  rest: THREE.Vector3
  vel: THREE.Vector3
  liftZ: number
}

type Cluster = {
  id: string
  words: WordEntry[]
  isButton: boolean
  isHovered: boolean
  onActivate?: () => void
}

// ── Word mesh factory ─────────────────────────────────────────────────────────

const PX_SCALE = CARD_H_WORLD / PX_H

function buildWordMesh(
  text: string,
  font: string,
  fontSize: number,
  pw: number,
  style: 'nav' | 'headline' | 'body',
): THREE.Mesh {
  const padX = style === 'nav' ? 16 : style === 'headline' ? 4 : 3
  const padY = style === 'nav' ? 8 : 3
  const lineH = fontSize * 1.35
  const cw = Math.ceil(pw) + padX * 2
  const ch = Math.ceil(lineH) + padY * 2

  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  const ctx = c.getContext('2d')!

  if (style === 'nav') {
    const r = ch / 2
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(0.5, 0.5, cw - 1, ch - 1, r)
    ctx.stroke()
  }

  ctx.font = font
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, padX, padY + fontSize * 0.88)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace

  const geo = new THREE.PlaneGeometry(cw * PX_SCALE, ch * PX_SCALE)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  return new THREE.Mesh(geo, mat)
}

// ── Build clusters ────────────────────────────────────────────────────────────

const clusters: Cluster[] = []
const allWordMeshes: THREE.Mesh[] = []

function addWord(cluster: Cluster, mesh: THREE.Mesh, rest: THREE.Vector3, liftZ: number): void {
  mesh.position.copy(rest)
  cardGroup.add(mesh)
  cluster.words.push({ mesh, rest: rest.clone(), vel: new THREE.Vector3(), liftZ })
  allWordMeshes.push(mesh)
}

// — Eyebrow label —
const EYEBROW_FONT = '500 9px "Helvetica Neue", Helvetica, sans-serif'
const eyebrowWords = ['PRETEXT', '·', 'THREE.JS']
let eyebrowX = MARGIN
for (const word of eyebrowWords) {
  const pw = measure(word, EYEBROW_FONT)
  const mesh = buildWordMesh(word, EYEBROW_FONT, 9, pw, 'body')
  const rest = px(eyebrowX + pw / 2, 52)
  const cluster: Cluster = { id: `eyebrow-${word}`, words: [], isButton: false, isHovered: false }
  addWord(cluster, mesh, rest, 0.012)
  clusters.push(cluster)
  eyebrowX += pw + 6
}

// — Nav items (independent button clusters) —
const NAV_FONT = '600 10px "Helvetica Neue", Helvetica, sans-serif'
const NAV_LABELS = ['WORK', 'ABOUT', 'JOURNAL', 'CONTACT']
const NAV_PAD = 16
const NAV_GAP = 14
const NAV_Y = 66

{
  // right-align nav items
  let totalW = 0
  const widths = NAV_LABELS.map(t => measure(t, NAV_FONT))
  for (let i = 0; i < widths.length; i++) {
    totalW += widths[i]! + NAV_PAD * 2 + (i < widths.length - 1 ? NAV_GAP : 0)
  }
  let navX = PX_W - MARGIN - totalW

  for (let i = 0; i < NAV_LABELS.length; i++) {
    const label = NAV_LABELS[i]!
    const pw = widths[i]!
    const mesh = buildWordMesh(label, NAV_FONT, 10, pw, 'nav')
    const rest = px(navX + NAV_PAD + pw / 2, NAV_Y)
    const cluster: Cluster = {
      id: `nav-${label}`,
      words: [],
      isButton: true,
      isHovered: false,
      onActivate: () => updateHint(`→ ${label}`),
    }
    addWord(cluster, mesh, rest, 0.018)
    clusters.push(cluster)
    navX += pw + NAV_PAD * 2 + NAV_GAP
  }
}

// — Headline (one cluster, all words spring together) —
const HEADLINE_TEXT = 'Typography\nas Interface'
const HEADLINE_FONT = '700 40px Georgia, "Times New Roman", serif'
const HEADLINE_FONT_SIZE = 40
const HEADLINE_LINE_HEIGHT = 54
const HEADLINE_Y = 138

const headlineCluster: Cluster = { id: 'headline', words: [], isButton: false, isHovered: false }
{
  const hLines = HEADLINE_TEXT.split('\n')
  for (let li = 0; li < hLines.length; li++) {
    const lineWords = hLines[li]!.split(' ').filter(Boolean)
    let xCursor = MARGIN
    for (const word of lineWords) {
      const pw = measure(word, HEADLINE_FONT)
      const cx = xCursor + pw / 2
      const cy = HEADLINE_Y + li * HEADLINE_LINE_HEIGHT + HEADLINE_FONT_SIZE * 0.9
      addWord(headlineCluster, buildWordMesh(word, HEADLINE_FONT, HEADLINE_FONT_SIZE, pw, 'headline'), px(cx, cy), 0.045)
      xCursor += pw + measure(' ', HEADLINE_FONT)
    }
  }
}
clusters.push(headlineCluster)

// — Subhead (small, single cluster) —
const SUBHEAD_FONT = '400 italic 13px "Iowan Old Style", Georgia, serif'
const SUBHEAD_Y = HEADLINE_Y + HEADLINE_LINE_HEIGHT * 2 + 10
const subheadText = 'every word a node, every cluster a surface'
const subheadCluster: Cluster = { id: 'subhead', words: [], isButton: false, isHovered: false }
{
  let sx = MARGIN
  for (const word of subheadText.split(' ')) {
    const pw = measure(word, SUBHEAD_FONT)
    addWord(subheadCluster, buildWordMesh(word, SUBHEAD_FONT, 13, pw, 'body'), px(sx + pw / 2, SUBHEAD_Y + 11), 0.016)
    sx += pw + measure(' ', SUBHEAD_FONT)
  }
}
clusters.push(subheadCluster)

// — Horizontal divider —
const divider = new THREE.Mesh(
  new THREE.PlaneGeometry(CARD_W_WORLD - (MARGIN * 2 / PX_W) * CARD_W_WORLD, 0.002),
  new THREE.MeshBasicMaterial({ color: 0x2a2218, transparent: true, opacity: 0.85 }),
)
divider.position.set(0, px(0, SUBHEAD_Y + 28).y, FACE_Z)
cardGroup.add(divider)

// — Body paragraph (one cluster via PreText) —
const BODY_TEXT = `Text is not static. Every word carries weight and position. Hover a cluster and it rises from the surface. Click and it scatters, then springs back — the layout is the attractor.`
const BODY_FONT = `14px "Iowan Old Style", "Palatino Linotype", Georgia, serif`
const BODY_FONT_SIZE = 14
const BODY_LINE_HEIGHT = 22
const BODY_Y = SUBHEAD_Y + 44
const BODY_W = PX_W - MARGIN * 2

const bodyPrepared = prepareWithSegments(BODY_TEXT, BODY_FONT)
const { lines: bodyLines } = layoutWithLines(bodyPrepared, BODY_W, BODY_LINE_HEIGHT)
const bodySpaceW = measure(' ', BODY_FONT)
const bodyCluster: Cluster = { id: 'body', words: [], isButton: false, isHovered: false }
{
  for (let li = 0; li < bodyLines.length; li++) {
    const lineWords = bodyLines[li]!.text.split(' ').filter(Boolean)
    let xCursor = MARGIN
    for (const word of lineWords) {
      const pw = measure(word, BODY_FONT)
      const cx = xCursor + pw / 2
      const cy = BODY_Y + li * BODY_LINE_HEIGHT + BODY_FONT_SIZE
      addWord(bodyCluster, buildWordMesh(word, BODY_FONT, BODY_FONT_SIZE, pw, 'body'), px(cx, cy), 0.016)
      xCursor += pw + bodySpaceW
    }
  }
}
clusters.push(bodyCluster)

// ── Hint label (DOM) ──────────────────────────────────────────────────────────

const hintEl = document.getElementById('hint') as HTMLElement
let hintTimer: ReturnType<typeof setTimeout> | null = null
function updateHint(text: string): void {
  hintEl.textContent = text
  hintEl.style.opacity = '1'
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hintEl.style.opacity = '0' }, 1800)
}

// ── Interaction ───────────────────────────────────────────────────────────────

const meshToCluster = new Map<THREE.Mesh, Cluster>()
for (const c of clusters) for (const w of c.words) meshToCluster.set(w.mesh, c)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2(-9, -9)

window.addEventListener('mousemove', e => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1
  pointer.y = -(e.clientY / innerHeight) * 2 + 1
})

window.addEventListener('click', () => {
  for (const c of clusters) {
    if (!c.isHovered) continue
    if (c.isButton) c.onActivate?.()
    for (const w of c.words) {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.12 + Math.random() * 0.22
      w.vel.set(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        (Math.random() * 0.06),
      )
    }
  }
})

// ── Card drag ─────────────────────────────────────────────────────────────────

let isDragging = false
let prevX = 0, prevY = 0
let rotVX = 0, rotVY = 0

glCanvas.addEventListener('pointerdown', e => {
  isDragging = true
  prevX = e.clientX; prevY = e.clientY
  rotVX = rotVY = 0
})
window.addEventListener('pointerup', () => { isDragging = false })
window.addEventListener('pointermove', e => {
  if (!isDragging) return
  rotVY = (e.clientX - prevX) * 0.012
  rotVX = (e.clientY - prevY) * 0.012
  prevX = e.clientX; prevY = e.clientY
})

// ── Colours ───────────────────────────────────────────────────────────────────

const C_WHITE = new THREE.Color(0xffffff)
const C_NAV_HOVER = new THREE.Color(0xffd080)
const C_CLUSTER_HOVER = new THREE.Color(0xffe8a0)

// ── Render loop ───────────────────────────────────────────────────────────────

const SPRING_K = 0.09
const DAMPING = 0.70

function tick(): void {
  requestAnimationFrame(tick)

  // Card rotation
  if (!isDragging) {
    cardGroup.rotation.y += 0.004
  } else {
    cardGroup.rotation.y += rotVY
    cardGroup.rotation.x = THREE.MathUtils.clamp(cardGroup.rotation.x + rotVX, -Math.PI / 3, Math.PI / 3)
  }
  rotVX *= 0.88; rotVY *= 0.88
  cardGroup.position.y = Math.sin(performance.now() * 0.0006) * 0.08

  // Update world matrices so raycasting sees correct transforms
  cardGroup.updateMatrixWorld(true)

  // Hover detection
  raycaster.setFromCamera(pointer, camera)
  const hits = new Set(
    raycaster.intersectObjects(allWordMeshes).map((h: THREE.Intersection) => h.object as THREE.Mesh),
  )
  for (const c of clusters) {
    c.isHovered = c.words.some(w => hits.has(w.mesh))
  }

  // Physics + colour
  for (const c of clusters) {
    const targetColor = c.isHovered ? (c.isButton ? C_NAV_HOVER : C_CLUSTER_HOVER) : C_WHITE
    for (const w of c.words) {
      // Spring toward rest in card-local space
      const targetZ = c.isHovered ? w.rest.z + w.liftZ : w.rest.z
      const dx = w.rest.x - w.mesh.position.x
      const dy = w.rest.y - w.mesh.position.y
      const dz = targetZ - w.mesh.position.z
      w.vel.x += dx * SPRING_K; w.vel.y += dy * SPRING_K; w.vel.z += dz * SPRING_K * 1.4
      w.vel.multiplyScalar(DAMPING)
      w.mesh.position.add(w.vel)

      ;(w.mesh.material as THREE.MeshBasicMaterial).color.lerp(targetColor, 0.14)
    }
  }

  renderer.render(scene, camera)
}

tick()

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
