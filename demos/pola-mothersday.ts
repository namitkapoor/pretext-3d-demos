/**
 * pola-mothersday — Pola "We Care More" recreation
 *
 * One InstancedMesh system, 5 formation states, same N particles throughout.
 * Scroll drives a smooth lerp between formations — no spawning/despawning.
 *
 * States:
 *  0 → Bouquet    (fibonacci sphere, hero view)
 *  1 → Seed       (all collapsed to bottom-center bubble, scroll indicator)
 *  2 → Circular   (clockwise rings, bottom-right — time-animated)
 *  3 → Sine wave  (columns flowing bottom-to-top — time-animated)
 *  4 → Field      (scattered flat plane, camera overhead)
 *  5 → Bouquet    (return — same as 0)
 *
 * Architecture: precompute rest positions per formation, blend in render loop,
 * add per-particle sine-wave jitter on top. Orientations billboard to camera
 * each frame so transitions always look correct.
 */

import * as THREE from 'three'

// ── Palette ───────────────────────────────────────────────────────────────────

const COLORS = [
    0x2545b8, 0x2545b8,  // cobalt blue
    0xc8321e, 0xc8321e, 0xd84422,  // reds
    0xe05528, 0xe06830,  // orange
    0xd4941a,            // amber
    0x0f8070, 0x1a9080,  // teal
    0xf5c0b0, 0xf0a890,  // pink
    0xfafaf5,            // white
]

// ── Petal canvas textures ─────────────────────────────────────────────────────

function makePetal(shapeType: number, color: number): THREE.CanvasTexture {
    const S = 256; const c = document.createElement('canvas')
    c.width = c.height = S
    const g = c.getContext('2d')!
    const cx = S / 2, cy = S / 2, r = S * 0.43
    const hex = `#${color.toString(16).padStart(6, '0')}`
    g.clearRect(0, 0, S, S)
    g.fillStyle = hex

    if (shapeType === 0) {
        // Tulip cup
        g.beginPath()
        g.moveTo(cx - r * .72, cy + r * .55)
        g.bezierCurveTo(cx - r * .95, cy - r * .15, cx - r * .75, cy - r, cx, cy - r * .75)
        g.bezierCurveTo(cx + r * .75, cy - r, cx + r * .95, cy - r * .15, cx + r * .72, cy + r * .55)
        g.bezierCurveTo(cx + r * .35, cy + r * .95, cx - r * .35, cy + r * .95, cx - r * .72, cy + r * .55)
        g.fill()
        g.fillStyle = 'rgba(0,0,0,0.13)'; g.beginPath()
        g.moveTo(cx - r * .38, cy + r * .3)
        g.bezierCurveTo(cx - r * .5, cy - r * .08, cx - r * .3, cy - r * .5, cx, cy - r * .48)
        g.bezierCurveTo(cx + r * .3, cy - r * .5, cx + r * .5, cy - r * .08, cx + r * .38, cy + r * .3)
        g.fill()

    } else if (shapeType === 1) {
        // Round blob + stamen
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
        g.fillStyle = 'rgba(0,0,0,0.15)'; g.beginPath()
        g.arc(cx, cy - r * .08, r * .35, 0, Math.PI * 2); g.fill()
        g.fillStyle = 'rgba(255,215,30,0.92)'; g.beginPath()
        g.arc(cx, cy - r * .06, r * .15, 0, Math.PI * 2); g.fill()

    } else if (shapeType === 2) {
        // 5-petal
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2
            g.beginPath(); g.arc(cx + Math.cos(a) * r * .51, cy + Math.sin(a) * r * .51, r * .41, 0, Math.PI * 2)
            g.fill()
        }
        g.fillStyle = 'rgba(255,215,0,0.95)'; g.beginPath()
        g.arc(cx, cy, r * .19, 0, Math.PI * 2); g.fill()

    } else if (shapeType === 3) {
        // Pom-pom cluster
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2
            g.beginPath(); g.arc(cx + Math.cos(a) * r * .5, cy + Math.sin(a) * r * .5, r * .37, 0, Math.PI * 2)
            g.fill()
        }
        g.beginPath(); g.arc(cx, cy, r * .38, 0, Math.PI * 2); g.fill()

    } else if (shapeType === 4) {
        // Leaf
        g.beginPath()
        g.moveTo(cx, cy - r)
        g.bezierCurveTo(cx + r * .5, cy - r * .18, cx + r * .46, cy + r * .62, cx, cy + r * .92)
        g.bezierCurveTo(cx - r * .46, cy + r * .62, cx - r * .5, cy - r * .18, cx, cy - r)
        g.fill()
        g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 3; g.beginPath()
        g.moveTo(cx, cy - r * .8); g.lineTo(cx, cy + r * .8); g.stroke()
    }

    const t = new THREE.CanvasTexture(c)
    return t
}

// ── Three.js ──────────────────────────────────────────────────────────────────

const glCanvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.setClearColor(0xe8e6e1)
renderer.sortObjects = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xe8e6e1)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0, 0.4, 6.5)

// ── Particle specs ────────────────────────────────────────────────────────────

const SPECS = [
    { shape: 0, colorIdx: 0,  scaleMin: 1.0, scaleMax: 1.5, count: 28 },  // cobalt tulip
    { shape: 1, colorIdx: 2,  scaleMin: 0.7, scaleMax: 1.1, count: 42 },  // red round
    { shape: 2, colorIdx: 5,  scaleMin: 0.6, scaleMax: 0.9, count: 30 },  // orange 5-petal
    { shape: 3, colorIdx: 7,  scaleMin: 0.5, scaleMax: 0.75, count: 30 }, // amber pom
    { shape: 4, colorIdx: 8,  scaleMin: 0.55, scaleMax: 0.85, count: 18 },// teal leaf
    { shape: 1, colorIdx: 10, scaleMin: 0.45, scaleMax: 0.7, count: 22 }, // pink round
    { shape: 1, colorIdx: 12, scaleMin: 0.45, scaleMax: 0.65, count: 14 },// white round
]

const N = SPECS.reduce((s, sp) => s + sp.count, 0)  // total particles

// Per-particle data
const scales      = new Float32Array(N)
const wavePhase   = new Float32Array(N)
const waveAmp     = new Float32Array(N)
const waveFreq    = new Float32Array(N)
const particleTilt = new Float32Array(N)  // random Z-rotation offset

// Map global idx → { meshIdx, localIdx }
const particleMesh  = new Uint8Array(N)
const particleLocal = new Uint16Array(N)

// Build meshes
const meshes: THREE.InstancedMesh[] = []
let gIdx = 0
for (let si = 0; si < SPECS.length; si++) {
    const sp = SPECS[si]!
    const tex = makePetal(sp.shape, COLORS[sp.colorIdx]!)
    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.04,
        side: THREE.DoubleSide, depthWrite: false,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, sp.count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)
    meshes.push(mesh)

    for (let li = 0; li < sp.count; li++, gIdx++) {
        particleMesh[gIdx]  = si
        particleLocal[gIdx] = li
        scales[gIdx]     = sp.scaleMin + Math.random() * (sp.scaleMax - sp.scaleMin)
        wavePhase[gIdx]  = Math.random() * Math.PI * 2
        waveAmp[gIdx]    = 0.025 + Math.random() * 0.05
        waveFreq[gIdx]   = 0.4 + Math.random() * 0.9
        particleTilt[gIdx] = (Math.random() - 0.5) * 0.6
    }
}

// ── Formation position buffers ────────────────────────────────────────────────

// Each buffer: Float32Array of length N*3
function makeBuf(): Float32Array { return new Float32Array(N * 3) }

const fBouquet  = makeBuf()  // fibonacci sphere
const fSeed     = makeBuf()  // all collapsed to bottom-center
const fField    = makeBuf()  // scattered flat plane (computed once)

// Fibonacci sphere helper
function fibSpherePoint(idx: number, total: number, radius: number): [number, number, number] {
    const golden = Math.PI * (3 - Math.sqrt(5))
    const y = 1 - (idx / (total - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * idx
    return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]
}

// Precompute bouquet — more dense in front hemisphere
for (let i = 0; i < N; i++) {
    const [x, y, z] = fibSpherePoint(i, N, 1.8 + Math.random() * 0.5)
    fBouquet[i*3]   = x
    fBouquet[i*3+1] = y * 0.85  // slightly flatten vertically
    fBouquet[i*3+2] = z + 0.3   // push forward
}

// Seed — all flowers converge to one point at bottom, with tiny jitter
for (let i = 0; i < N; i++) {
    fSeed[i*3]   = (Math.random() - 0.5) * 0.12
    fSeed[i*3+1] = -2.8
    fSeed[i*3+2] = (Math.random() - 0.5) * 0.12
}

// Field — golden ratio scatter on a tilted plane, wide
for (let i = 0; i < N; i++) {
    const phi = 1.6180339887
    fField[i*3]   = ((i * phi)       % 1 - 0.5) * 11
    fField[i*3+1] = 0
    fField[i*3+2] = ((i * phi * phi) % 1 - 0.5) * 11
}

// ── Time-animated formation getters (computed per-frame) ──────────────────────

// Circular: particles arranged in rings, spinning clockwise over time
// Center drifted to right so the first ring appears bottom-right of viewport
function getCircularPos(i: number, time: number, out: THREE.Vector3): void {
    // Three concentric rings
    const rings = [
        { from: 0,   to: 55,  radius: 1.6 },
        { from: 55,  to: 120, radius: 2.5 },
        { from: 120, to: N,   radius: 3.2 },
    ]
    let ring = rings[2]!
    for (const rng of rings) { if (i >= rng.from && i < rng.to) { ring = rng; break } }

    const localI   = i - ring.from
    const ringCount = ring.to - ring.from
    const baseAngle = (localI / ringCount) * Math.PI * 2 + (i % 3) * 0.4  // stagger rings
    const angle = baseAngle - time * 0.65  // clockwise

    const cx = 1.0, cy = -1.0  // center: right + lower
    out.set(
        cx + Math.cos(angle) * ring.radius,
        cy + Math.sin(angle) * ring.radius * 0.5,  // elliptical
        Math.sin(angle * 0.7) * 0.4,
    )
}

// Sine wave: columns flowing bottom-to-top
function getSinePos(i: number, time: number, out: THREE.Vector3): void {
    const cols = 6
    const col  = i % cols
    const rowI = Math.floor(i / cols)
    const totalRows = Math.ceil(N / cols)

    const x = (col / (cols - 1) - 0.5) * 5.5  // -2.75 to +2.75

    // Each column offset in time so they're not all in phase
    const colOffset = (col / cols) * (8 / 1.3)
    // Y scrolls upward, wraps smoothly — each particle at a different base row
    const baseY  = (rowI / totalRows) * 8 - 4
    const flowY  = ((baseY + time * 1.3 + colOffset) % 8 + 8) % 8 - 4

    // Sine displacement in Z gives depth
    const z = Math.sin(x * 1.2 + flowY * 0.9) * 0.5

    out.set(x, flowY, z)
}

// ── Scroll progress → formation blend ────────────────────────────────────────

//  Stage 0: 0.00–0.08  → bouquet (hero)
//  Stage 1: 0.08–0.18  → bouquet → seed  (scroll indicator)
//  Stage 2: 0.18–0.40  → seed → circular
//  Stage 3: 0.40–0.58  → circular
//  Stage 4: 0.58–0.72  → circular → sine
//  Stage 5: 0.72–0.85  → sine wave
//  Stage 6: 0.85–0.95  → sine → field
//  Stage 7: 0.95–1.00  → field → bouquet (return)

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

// Camera keyframes: [x, y, z, lookX, lookY, lookZ]
const CAM_STATES = [
    [0, 0.4, 6.5,  0, 0.2, 0],   // 0: bouquet front
    [0, 0.4, 6.5,  0, 0.2, 0],   // 1: bouquet (same during seed collapse)
    [1.2, -0.3, 7, 0.8, -0.8, 0], // 2: circular right
    [1.2, -0.3, 7, 0.8, -0.8, 0], // 3: circular (hold)
    [0, 0, 7.5,    0, 0, 0],      // 4: sine wave center
    [0, 0, 7.5,    0, 0, 0],      // 5: sine (hold)
    [0, 6, 2,      0, 0, 0],      // 6: field overhead
    [0, 0.4, 6.5,  0, 0.2, 0],   // 7: return to bouquet
]

// ── Dummy object for matrix composition ──────────────────────────────────────

const dummy = new THREE.Object3D()
const posA = new THREE.Vector3()
const posB = new THREE.Vector3()
const posC = new THREE.Vector3()

// ── Main update ───────────────────────────────────────────────────────────────

function updateParticles(scrollProg: number, time: number): void {
    const sp = scrollProg

    // Determine which formations to blend and at what weight
    // Returns: [formationA, formationB, t] where formationA/B are enum codes
    // 0=bouquet, 1=seed, 2=circular, 3=sine, 4=field
    let fA = 0, fB = 0, t = 0
    let camIdx = 0

    if (sp < 0.08) {
        fA = 0; fB = 0; t = 0; camIdx = 0
    } else if (sp < 0.18) {
        fA = 0; fB = 1; t = smoothstep(0.08, 0.18, sp); camIdx = 1
    } else if (sp < 0.40) {
        fA = 1; fB = 2; t = smoothstep(0.18, 0.40, sp); camIdx = 2
    } else if (sp < 0.58) {
        fA = 2; fB = 2; t = 0; camIdx = 3
    } else if (sp < 0.72) {
        fA = 2; fB = 3; t = smoothstep(0.58, 0.72, sp); camIdx = 4
    } else if (sp < 0.85) {
        fA = 3; fB = 3; t = 0; camIdx = 5
    } else if (sp < 0.95) {
        fA = 3; fB = 4; t = smoothstep(0.85, 0.95, sp); camIdx = 6
    } else {
        fA = 4; fB = 0; t = smoothstep(0.95, 1.0, sp); camIdx = 7
    }

    // Camera lerp between two adjacent keyframes
    const camA = CAM_STATES[Math.min(camIdx, 7)]!
    const camB = CAM_STATES[Math.min(camIdx + 1, 7)]!
    const camT = (camIdx === 7) ? smoothstep(0.95, 1.0, sp) : smoothstep(camIdx / 7, (camIdx + 1) / 7, sp)

    targetCamPos.set(
        camA[0]! + (camB[0]! - camA[0]!) * camT,
        camA[1]! + (camB[1]! - camA[1]!) * camT,
        camA[2]! + (camB[2]! - camA[2]!) * camT,
    )
    targetLookAt.set(
        camA[3]! + (camB[3]! - camA[3]!) * camT,
        camA[4]! + (camB[4]! - camA[4]!) * camT,
        camA[5]! + (camB[5]! - camA[5]!) * camT,
    )

    for (let i = 0; i < N; i++) {
        // Get positions from each formation
        getFormationPos(fA, i, time, posA)
        getFormationPos(fB, i, time, posB)

        // Blend
        posC.lerpVectors(posA, posB, t)

        // Per-particle sine wave jitter on top
        posC.y += Math.sin(time * waveFreq[i]! + wavePhase[i]!) * waveAmp[i]!

        // Orient: face camera, add tilt
        dummy.position.copy(posC)
        dummy.lookAt(camera.position)
        dummy.rotateZ(particleTilt[i]!)
        dummy.scale.setScalar(scales[i]!)
        dummy.updateMatrix()

        meshes[particleMesh[i]!]!.setMatrixAt(particleLocal[i]!, dummy.matrix)
    }

    for (const m of meshes) m.instanceMatrix.needsUpdate = true
}

function getFormationPos(fIdx: number, i: number, time: number, out: THREE.Vector3): void {
    if (fIdx === 0 || fIdx === 5) {
        out.set(fBouquet[i*3]!, fBouquet[i*3+1]!, fBouquet[i*3+2]!)
    } else if (fIdx === 1) {
        out.set(fSeed[i*3]!, fSeed[i*3+1]!, fSeed[i*3+2]!)
    } else if (fIdx === 2) {
        getCircularPos(i, time, out)
    } else if (fIdx === 3) {
        getSinePos(i, time, out)
    } else {
        // Field — Y gets wave animation
        const wave = Math.sin(fField[i*3]! * 0.4 + time * 0.5) * 0.18
                   + Math.sin(fField[i*3+2]! * 0.3 + time * 0.7) * 0.12
        out.set(fField[i*3]!, wave, fField[i*3+2]!)
    }
}

// ── Bouquet glow circle ───────────────────────────────────────────────────────

const glowTex = (() => {
    const s = 512; const cv = document.createElement('canvas'); cv.width = cv.height = s
    const gx = cv.getContext('2d')!
    const grd = gx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2)
    grd.addColorStop(0,   'rgba(255,205,190,0.55)')
    grd.addColorStop(0.5, 'rgba(255,205,190,0.20)')
    grd.addColorStop(1,   'rgba(255,205,190,0)')
    gx.fillStyle = grd; gx.fillRect(0, 0, s, s)
    return new THREE.CanvasTexture(cv)
})()

const glowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false }),
)
glowMesh.position.z = -1
scene.add(glowMesh)

// ── Scroll ────────────────────────────────────────────────────────────────────

let scrollProg = 0
let targetScrollProg = 0
window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight
    targetScrollProg = max > 0 ? Math.min(1, window.scrollY / max) : 0
}, { passive: true })

// ── Mouse parallax ────────────────────────────────────────────────────────────

const mouse     = new THREE.Vector2()
const targetMouse = new THREE.Vector2()
window.addEventListener('mousemove', e => {
    targetMouse.set((e.clientX / innerWidth - 0.5) * 2, -(e.clientY / innerHeight - 0.5) * 2)
}, { passive: true })

const targetCamPos  = new THREE.Vector3(0, 0.4, 6.5)
const targetLookAt  = new THREE.Vector3(0, 0.2, 0)
const currentCamPos = new THREE.Vector3(0, 0.4, 6.5)
const currentLookAt = new THREE.Vector3(0, 0.2, 0)

// ── Text reveal via IntersectionObserver ─────────────────────────────────────

document.getElementById('hero-title')!.classList.add('visible')

const lineObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        const siblings = Array.from(el.parentElement!.querySelectorAll('.copy-line'))
        el.style.transitionDelay = `${siblings.indexOf(el) * 80}ms`
        el.classList.add('visible')
        lineObs.unobserve(el)
    })
}, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' })
document.querySelectorAll<HTMLElement>('.copy-line').forEach(l => lineObs.observe(l))

new IntersectionObserver(([e]) => {
    if (e!.isIntersecting) document.getElementById('footer')!.classList.add('visible')
}, { threshold: 0.4 }).observe(document.getElementById('footer')!)

// ── Scroll indicator pulse (CSS element in hero) ──────────────────────────────

const scrollIndicator = document.getElementById('scroll-indicator')
window.addEventListener('scroll', () => {
    if (scrollIndicator && window.scrollY > 80) scrollIndicator.style.opacity = '0'
}, { passive: true })

// ── Render loop ───────────────────────────────────────────────────────────────

const clock = new THREE.Clock()

function tick(): void {
    requestAnimationFrame(tick)
    const dt   = Math.min(clock.getDelta(), 0.05)
    const time = clock.getElapsedTime()

    // Smooth scroll
    scrollProg += (targetScrollProg - scrollProg) * 0.07

    // Smooth mouse
    mouse.lerp(targetMouse, 0.06)

    // Update particle positions for this scroll position
    updateParticles(scrollProg, time)

    // Smooth camera toward target (set by updateParticles) + mouse parallax
    currentCamPos.lerp(targetCamPos, 0.06)
    currentLookAt.lerp(targetLookAt, 0.06)

    camera.position.set(
        currentCamPos.x + mouse.x * 0.18,
        currentCamPos.y + mouse.y * 0.10,
        currentCamPos.z,
    )
    camera.lookAt(currentLookAt)

    // Glow circle fades as scroll moves away from bouquet
    const bouquetStrength = 1 - Math.min(1, scrollProg * 8)
    const returnStrength  = Math.max(0, (scrollProg - 0.9) * 10)
    glowMesh.material.opacity = bouquetStrength + returnStrength * 0.7
    glowMesh.position.copy(currentLookAt)
    glowMesh.position.z -= 1

    renderer.render(scene, camera)
}

clock.start()
tick()

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
})
