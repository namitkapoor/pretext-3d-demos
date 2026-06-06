/**
 * three-tshirt-physics — Verlet cloth on a subsampled proxy mesh
 *
 * Subsamples the hi-res shirt geometry to ~600 proxy verts, runs
 * Verlet integration with spring constraints, then transfers the
 * displacement back to the full 40k-vert mesh via weighted
 * nearest-proxy interpolation each frame.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
// @ts-ignore
import tshirtUrl from './t-shirt_vandalisme.glb' with { type: 'url' }

// ── Config ────────────────────────────────────────────────────────────────────

const TARGET_PROXY  = 600     // target proxy vertex count
const INTERP_K      = 4       // nearest proxy verts per hi-res vert
const DAMPING       = 0.992   // higher damping = less oscillation
const GRAVITY       = -1.0    // reduced — shirt is ~0.3 world units, so -2.8 was 10× too strong
const PIN_FRACTION  = 0.07    // top 7% by Y → pinned (collar/shoulders)
const FLOOR_BOUNCE  = 0.08    // velocity restitution on floor hit
const MAX_VEL       = 0.06    // per-frame velocity clamp to prevent explosion

// ── Three.js ──────────────────────────────────────────────────────────────────

const glCanvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0d0d14)

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0, 0.5, 3.5)

scene.add(new THREE.AmbientLight(0xffffff, 0.5))

const keyLight = new THREE.DirectionalLight(0xfff8f0, 2.5)
keyLight.position.set(2, 4, 5)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x8899cc, 0.7)
fillLight.position.set(-4, 1, -3)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xffddaa, 0.4)
rimLight.position.set(0, -3, -4)
scene.add(rimLight)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.target.set(0, 0.2, 0)
controls.update()

// ── Physics buffers ───────────────────────────────────────────────────────────

let proxyCount  = 0
let proxyPos    = new Float32Array(0)   // world-space current  (x,y,z per vert)
let proxyPrev   = new Float32Array(0)   // world-space previous
let proxyRest   = new Float32Array(0)   // world-space rest
let pinned      = new Uint8Array(0)
let springs     = new Int32Array(0)     // [a, b, a, b, ...]
let springRest  = new Float32Array(0)
let springCount = 0

// Flat KNN tables for hi-res ↔ proxy mapping
let wIdx = new Int32Array(0)    // [hiResCount × INTERP_K] proxy indices
let wVal = new Float32Array(0)  // [hiResCount × INTERP_K] weights
let restWorld = new Float32Array(0)   // hi-res rest positions in world space
let hiResCount = 0
let shirtGeo!: THREE.BufferGeometry
let matInvE: Float32Array = new Float32Array(16)  // cached matWorldInverse elements

// Mannequin collision spheres (world space) — populated after model load
const mannequinSpheres: {cx: number, cy: number, cz: number, r: number}[] = []

// ── Mutable params ────────────────────────────────────────────────────────────

let windMult   = 3.0
let stiffIters = 8
let simReady   = false
let floorY     = -Infinity    // set from model bounding box after load
const clock    = new THREE.Clock()

// ── UI ────────────────────────────────────────────────────────────────────────

const statusEl   = document.getElementById('status')!
const windSlider = document.getElementById('wind-slider') as HTMLInputElement
const windValEl  = document.getElementById('wind-val')   as HTMLSpanElement
const stiffSlider = document.getElementById('stiff-slider') as HTMLInputElement
const stiffValEl  = document.getElementById('stiff-val')   as HTMLSpanElement

windSlider.addEventListener('input', () => {
    windMult = parseFloat(windSlider.value)
    windValEl.textContent = `${windMult.toFixed(1)}×`
})
stiffSlider.addEventListener('input', () => {
    stiffIters = parseInt(stiffSlider.value)
    stiffValEl.textContent = String(stiffIters)
})

// ── GLB load ──────────────────────────────────────────────────────────────────

new GLTFLoader().load(
    tshirtUrl,
    gltf => {
        const model = gltf.scene

        const bbox   = new THREE.Box3().setFromObject(model)
        const size   = bbox.getSize(new THREE.Vector3())
        const scale  = 2.0 / Math.max(size.x, size.y, size.z)
        const center = bbox.getCenter(new THREE.Vector3())
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        // Find shirt mesh (largest by vertex count)
        let shirtMesh: THREE.Mesh | null = null
        let maxVerts = 0
        model.traverse(obj => {
            if (!(obj instanceof THREE.Mesh)) return
            obj.castShadow = true
            obj.receiveShadow = true
            const n = (obj.geometry as THREE.BufferGeometry).attributes['position']?.count ?? 0
            if (n > maxVerts) { maxVerts = n; shirtMesh = obj }
        })

        scene.add(model)
        controls.target.set(0, 0.1, 0)
        controls.update()

        if (!shirtMesh) { statusEl.textContent = 'No mesh found'; return }

        // Ensure world matrices are up to date
        scene.updateMatrixWorld(true)

        // Floor sits just below the model's world-space bottom
        const worldBbox = new THREE.Box3().setFromObject(model)
        floorY = worldBbox.min.y - 0.05

        // Visible shadow-catching floor
        const floorMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(6, 6),
            new THREE.ShadowMaterial({ opacity: 0.15 }),
        )
        floorMesh.rotation.x = -Math.PI / 2
        floorMesh.position.y = floorY
        floorMesh.receiveShadow = true
        scene.add(floorMesh)

        buildMannequin(worldBbox)
        buildPhysics(shirtMesh as THREE.Mesh)
    },
    undefined,
    err => { console.error(err); statusEl.textContent = 'Failed to load GLB' },
)

// ── Mannequin ─────────────────────────────────────────────────────────────────

function buildMannequin(worldBbox: THREE.Box3): void {
    const sz = worldBbox.getSize(new THREE.Vector3())
    const c  = worldBbox.getCenter(new THREE.Vector3())

    // Torso radius = ~27% of shirt width; capsule height = ~75% of shirt height
    const r  = sz.x * 0.27
    const h  = sz.y * 0.75
    const cz = c.z - sz.z * 0.05   // slightly behind shirt midplane so cloth drapes forward

    const mat = new THREE.MeshStandardMaterial({ color: 0xc8bdb0, roughness: 0.88 })

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 6, 12), mat)
    torso.position.set(c.x, c.y - sz.y * 0.05, cz)
    torso.castShadow = true
    scene.add(torso)

    const headR = r * 0.68
    const head  = new THREE.Mesh(new THREE.SphereGeometry(headR, 12, 10), mat)
    head.position.set(c.x, torso.position.y + h * 0.5 + headR, cz)
    head.castShadow = true
    scene.add(head)

    // Three collision spheres along the torso for Verlet push-out
    const ty = torso.position.y
    mannequinSpheres.push({ cx: c.x, cy: ty + h * 0.25, cz, r: r * 1.05 })
    mannequinSpheres.push({ cx: c.x, cy: ty,             cz, r: r * 1.0  })
    mannequinSpheres.push({ cx: c.x, cy: ty - h * 0.25,  cz, r: r * 0.93 })
}

// ── Build proxy + springs ─────────────────────────────────────────────────────

function buildPhysics(mesh: THREE.Mesh): void {
    shirtGeo = mesh.geometry as THREE.BufferGeometry

    // Cache matWorldInverse for local↔world conversions
    const matWorld = mesh.matrixWorld.clone()
    const matWorldInv = matWorld.clone().invert()
    matInvE = new Float32Array(matWorldInv.elements)

    const posAttr = shirtGeo.attributes['position'] as THREE.BufferAttribute
    hiResCount = posAttr.count

    // Extract hi-res rest positions in world space + track full-mesh bbox
    restWorld = new Float32Array(hiResCount * 3)
    const mw = matWorld.elements
    let allXMin=Infinity, allXMax=-Infinity
    let allYMin=Infinity, allYMax=-Infinity
    let allZMin=Infinity, allZMax=-Infinity
    for (let v = 0; v < hiResCount; v++) {
        const lx = posAttr.getX(v), ly = posAttr.getY(v), lz = posAttr.getZ(v)
        const wx = mw[0]*lx + mw[4]*ly + mw[8]*lz  + mw[12]
        const wy = mw[1]*lx + mw[5]*ly + mw[9]*lz  + mw[13]
        const wz = mw[2]*lx + mw[6]*ly + mw[10]*lz + mw[14]
        restWorld[v*3]   = wx
        restWorld[v*3+1] = wy
        restWorld[v*3+2] = wz
        if (wx < allXMin) allXMin = wx; if (wx > allXMax) allXMax = wx
        if (wy < allYMin) allYMin = wy; if (wy > allYMax) allYMax = wy
        if (wz < allZMin) allZMin = wz; if (wz > allZMax) allZMax = wz
    }
    const allDiagLen = Math.sqrt((allXMax-allXMin)**2 + (allYMax-allYMin)**2 + (allZMax-allZMin)**2)

    // Spatially-sorted proxy sampling: sort vert indices by (Y, X) so stride-sampling
    // gives spatial coverage instead of UV-island buffer clustering.
    // Stride-by-buffer-index groups verts by UV island → all proxy verts land in one patch.
    const sortedIdx = Array.from({length: hiResCount}, (_, i) => i)
    sortedIdx.sort((a, b) => {
        const dy = restWorld[a*3+1] - restWorld[b*3+1]
        if (Math.abs(dy) > 1e-5) return dy
        return restWorld[a*3] - restWorld[b*3]
    })
    const stride = Math.max(1, Math.floor(hiResCount / TARGET_PROXY))
    const proxyOrigIdx: number[] = []
    for (let i = 0; i < hiResCount; i += stride) proxyOrigIdx.push(sortedIdx[i]!)
    proxyCount = proxyOrigIdx.length

    proxyPos  = new Float32Array(proxyCount * 3)
    proxyPrev = new Float32Array(proxyCount * 3)
    proxyRest = new Float32Array(proxyCount * 3)
    pinned    = new Uint8Array(proxyCount)

    let yMin = Infinity, yMax = -Infinity
    for (let pi = 0; pi < proxyCount; pi++) {
        const vi = proxyOrigIdx[pi]!
        const x = restWorld[vi*3], y = restWorld[vi*3+1], z = restWorld[vi*3+2]
        proxyPos[pi*3] = proxyPrev[pi*3] = proxyRest[pi*3] = x
        proxyPos[pi*3+1] = proxyPrev[pi*3+1] = proxyRest[pi*3+1] = y
        proxyPos[pi*3+2] = proxyPrev[pi*3+2] = proxyRest[pi*3+2] = z
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
    }

    const pinY = yMax - (yMax - yMin) * PIN_FRACTION
    for (let pi = 0; pi < proxyCount; pi++) {
        pinned[pi] = proxyPos[pi*3+1] >= pinY ? 1 : 0
    }

    // Spring threshold: use full hi-res mesh bbox diagonal (computed above during
    // restWorld extraction). Multiplier 1.5 gives ~7 springs/vert — enough for
    // cloth structure. The old 0.55 was only 0.54× the avg spacing, so most
    // structural neighbors were never connected.
    // Also skip micro-springs (d < 1e-3): UV-seam duplicate verts sit at near-zero
    // distance and waste solver iterations without contributing any constraint.
    const threshold = (allDiagLen / Math.sqrt(proxyCount)) * 1.5
    const MIN_SPRING = allDiagLen * 0.003   // ~0.3% of mesh extent — skips UV-seam dupes

    // Build springs — all pairs within threshold, excluding near-zero micro-springs
    const sa: number[] = [], sb: number[] = [], sr: number[] = []
    for (let a = 0; a < proxyCount; a++) {
        for (let b = a + 1; b < proxyCount; b++) {
            const dx = proxyPos[b*3] - proxyPos[a*3]
            const dy = proxyPos[b*3+1] - proxyPos[a*3+1]
            const dz = proxyPos[b*3+2] - proxyPos[a*3+2]
            const d  = Math.sqrt(dx*dx + dy*dy + dz*dz)
            if (d >= MIN_SPRING && d < threshold) { sa.push(a); sb.push(b); sr.push(d) }
        }
    }
    springCount = sr.length
    springs    = new Int32Array(springCount * 2)
    springRest = new Float32Array(springCount)
    for (let i = 0; i < springCount; i++) {
        springs[i*2] = sa[i]!; springs[i*2+1] = sb[i]!; springRest[i] = sr[i]!
    }

    const pinnedCount = Array.from(pinned).filter(v => v).length
    const avgSprings  = (springCount * 2 / proxyCount).toFixed(1)
    console.log(`[Cloth] ${proxyCount} proxy · ${pinnedCount} pinned · ${springCount} springs (${avgSprings}/vert) · threshold=${threshold.toFixed(4)} · meshDiag=${allDiagLen.toFixed(3)} · floorY=${floorY.toFixed(3)}`)
    statusEl.textContent = `Building deformation map… 0%`

    precomputeWeights()
}

// ── Precompute per-vertex weights (async chunked) ─────────────────────────────

async function precomputeWeights(): Promise<void> {
    wIdx = new Int32Array(hiResCount * INTERP_K)
    wVal = new Float32Array(hiResCount * INTERP_K)

    const CHUNK = 2000
    // Reusable heap: [dist², proxyIdx] for K nearest
    const heapD = new Float64Array(INTERP_K)
    const heapI = new Int32Array(INTERP_K)

    for (let base = 0; base < hiResCount; base += CHUNK) {
        const end = Math.min(base + CHUNK, hiResCount)

        for (let v = base; v < end; v++) {
            const vx = restWorld[v*3], vy = restWorld[v*3+1], vz = restWorld[v*3+2]

            // Partial sort: maintain worst-of-K heap
            let heapSize = 0
            let worstD = Infinity

            for (let pi = 0; pi < proxyCount; pi++) {
                const dx = proxyPos[pi*3] - vx
                const dy = proxyPos[pi*3+1] - vy
                const dz = proxyPos[pi*3+2] - vz
                const dsq = dx*dx + dy*dy + dz*dz

                if (heapSize < INTERP_K) {
                    heapD[heapSize] = dsq
                    heapI[heapSize] = pi
                    heapSize++
                    if (heapSize === INTERP_K) {
                        worstD = 0
                        for (let k = 0; k < INTERP_K; k++) if (heapD[k]! > worstD) worstD = heapD[k]!
                    }
                } else if (dsq < worstD) {
                    let wi = 0
                    for (let k = 1; k < INTERP_K; k++) if (heapD[k]! > heapD[wi]!) wi = k
                    heapD[wi] = dsq
                    heapI[wi] = pi
                    worstD = 0
                    for (let k = 0; k < INTERP_K; k++) if (heapD[k]! > worstD) worstD = heapD[k]!
                }
            }

            // Normalize inverse-distance weights
            let totalInv = 0
            for (let k = 0; k < INTERP_K; k++) {
                const invD = heapD[k]! > 0 ? 1 / Math.sqrt(heapD[k]!) : 1e6
                heapD[k] = invD   // reuse as invD temporarily
                totalInv += invD
            }
            const base4 = v * INTERP_K
            for (let k = 0; k < INTERP_K; k++) {
                wIdx[base4 + k] = heapI[k]!
                wVal[base4 + k] = heapD[k]! / totalInv
            }
        }

        const pct = Math.round(end / hiResCount * 100)
        statusEl.textContent = `Building deformation map… ${pct}%`
        await new Promise<void>(r => setTimeout(r, 0))
    }

    statusEl.textContent = ''
    simReady = true
}

// ── Verlet step ───────────────────────────────────────────────────────────────

function stepVerlet(dt: number, time: number): void {
    const dtSq = dt * dt
    const wx = (Math.sin(time * 0.55) * 0.7 + Math.sin(time * 1.15) * 0.3) * 0.08 * windMult * dtSq
    const wz = Math.cos(time * 0.38) * 0.04 * windMult * dtSq
    const gy = GRAVITY * dtSq

    // Integrate
    for (let pi = 0; pi < proxyCount; pi++) {
        if (pinned[pi]) continue
        const i = pi * 3
        let vx = (proxyPos[i]   - proxyPrev[i])   * DAMPING + wx
        let vy = (proxyPos[i+1] - proxyPrev[i+1]) * DAMPING + gy
        let vz = (proxyPos[i+2] - proxyPrev[i+2]) * DAMPING + wz

        // Clamp per-frame velocity to prevent explosion
        const vLen = Math.sqrt(vx*vx + vy*vy + vz*vz)
        if (vLen > MAX_VEL) { const s = MAX_VEL / vLen; vx *= s; vy *= s; vz *= s }

        proxyPrev[i]   = proxyPos[i];   proxyPos[i]   += vx
        proxyPrev[i+1] = proxyPos[i+1]; proxyPos[i+1] += vy
        proxyPrev[i+2] = proxyPos[i+2]; proxyPos[i+2] += vz

        // Floor collision — reflect velocity, push above floor
        if (proxyPos[i+1] < floorY) {
            proxyPos[i+1] = floorY
            proxyPrev[i+1] = floorY + (floorY - proxyPrev[i+1]) * FLOOR_BOUNCE
        }

        // Mannequin sphere collision — push proxy vert outside each sphere
        for (const ms of mannequinSpheres) {
            const ddx = proxyPos[i]   - ms.cx
            const ddy = proxyPos[i+1] - ms.cy
            const ddz = proxyPos[i+2] - ms.cz
            const dist = Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz)
            if (dist < ms.r && dist > 1e-7) {
                const inv = ms.r / dist
                proxyPos[i]   = ms.cx + ddx * inv
                proxyPos[i+1] = ms.cy + ddy * inv
                proxyPos[i+2] = ms.cz + ddz * inv
            }
        }
    }

    // Satisfy spring constraints
    for (let iter = 0; iter < stiffIters; iter++) {
        for (let s = 0; s < springCount; s++) {
            const a = springs[s*2]!, b = springs[s*2+1]!
            const a3 = a*3, b3 = b*3
            const dx = proxyPos[b3]   - proxyPos[a3]
            const dy = proxyPos[b3+1] - proxyPos[a3+1]
            const dz = proxyPos[b3+2] - proxyPos[a3+2]
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz)
            if (len < 1e-7) continue
            const corr = (len - springRest[s]!) / len * 0.5
            const cx = dx * corr, cy = dy * corr, cz = dz * corr
            if (!pinned[a]) { proxyPos[a3] += cx; proxyPos[a3+1] += cy; proxyPos[a3+2] += cz }
            if (!pinned[b]) { proxyPos[b3] -= cx; proxyPos[b3+1] -= cy; proxyPos[b3+2] -= cz }
        }
    }

    // Transfer deformation → hi-res mesh
    const posArr = shirtGeo.attributes['position']!.array as Float32Array
    const e = matInvE

    for (let v = 0; v < hiResCount; v++) {
        let ddx = 0, ddy = 0, ddz = 0
        const base4 = v * INTERP_K
        for (let k = 0; k < INTERP_K; k++) {
            const pi3 = wIdx[base4 + k]! * 3
            const w   = wVal[base4 + k]!
            ddx += (proxyPos[pi3]   - proxyRest[pi3])   * w
            ddy += (proxyPos[pi3+1] - proxyRest[pi3+1]) * w
            ddz += (proxyPos[pi3+2] - proxyRest[pi3+2]) * w
        }
        // Deformed world position
        const wx2 = restWorld[v*3]   + ddx
        const wy2 = restWorld[v*3+1] + ddy
        const wz2 = restWorld[v*3+2] + ddz
        // Convert back to local space via cached matWorldInverse
        posArr[v*3]   = e[0]*wx2 + e[4]*wy2 + e[8]*wz2  + e[12]
        posArr[v*3+1] = e[1]*wx2 + e[5]*wy2 + e[9]*wz2  + e[13]
        posArr[v*3+2] = e[2]*wx2 + e[6]*wy2 + e[10]*wz2 + e[14]
    }

    ;(shirtGeo.attributes['position'] as THREE.BufferAttribute).needsUpdate = true
    shirtGeo.computeVertexNormals()
}

// ── Render loop ───────────────────────────────────────────────────────────────

function tick(): void {
    requestAnimationFrame(tick)
    const dt   = Math.min(clock.getDelta(), 0.05)
    const time = clock.getElapsedTime()
    if (simReady) stepVerlet(dt, time)
    controls.update()
    renderer.render(scene, camera)
}

clock.start()
tick()

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
})
