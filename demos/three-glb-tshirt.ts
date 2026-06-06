/**
 * three-glb-tshirt — GLB mesh explorer + physics feasibility check
 *
 * Loads the t-shirt GLB, shows the full scene hierarchy with vertex
 * counts, and assesses whether Ammo.js CreateFromTriMesh can be applied
 * to each mesh. Camera is driven by OrbitControls with Leva-style sliders
 * that stay in sync bidirectionally.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
// @ts-ignore - bun serves the GLB as a URL asset
import tshirtUrl from './t-shirt_vandalisme.glb' with { type: 'url' }

// ── Scene ─────────────────────────────────────────────────────────────────────

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
scene.background = new THREE.Color(0x111115)

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0, 1, 3.5)

// ── Lighting ──────────────────────────────────────────────────────────────────

scene.add(new THREE.AmbientLight(0xffffff, 0.7))

const keyLight = new THREE.DirectionalLight(0xfff8f0, 2.0)
keyLight.position.set(2, 4, 5)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0x99aacc, 0.6)
fillLight.position.set(-4, 1, -2)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xffd0aa, 0.4)
rimLight.position.set(0, -3, -4)
scene.add(rimLight)

// Ground plane for shadow catching
const groundMat = new THREE.ShadowMaterial({ opacity: 0.18 })
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat)
ground.rotation.x = -Math.PI / 2
ground.position.y = -1.2
ground.receiveShadow = true
scene.add(ground)

// ── Controls ──────────────────────────────────────────────────────────────────

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.target.set(0, 0.4, 0)
controls.minDistance = 0.3
controls.maxDistance = 15
controls.update()

// ── Helpers ───────────────────────────────────────────────────────────────────

let skeletonHelper: THREE.SkeletonHelper | null = null

// ── Leva panel sync ───────────────────────────────────────────────────────────

const CAM_DEFAULTS = { dist: 3.5, elev: 10, azim: 0, ty: 0.4 }

function sphericalToCamera(dist: number, elevDeg: number, azimDeg: number, targetY: number): void {
    const elev = (elevDeg * Math.PI) / 180
    const azim = (azimDeg * Math.PI) / 180
    camera.position.set(
        dist * Math.cos(elev) * Math.sin(azim),
        dist * Math.sin(elev),
        dist * Math.cos(elev) * Math.cos(azim),
    )
    camera.position.y += targetY
    controls.target.set(0, targetY, 0)
    controls.update()
}

function cameraToSpherical(): { dist: number; elev: number; azim: number } {
    const t = controls.target
    const dx = camera.position.x - t.x
    const dy = camera.position.y - t.y
    const dz = camera.position.z - t.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const elev = (Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180) / Math.PI
    const azim = (Math.atan2(dx, dz) * 180) / Math.PI
    return { dist, elev, azim }
}

const $ = (id: string) => document.getElementById(id)!
const getSlider = (id: string) => $(`cam-${id}`) as HTMLInputElement
const getVal    = (id: string) => $(`cam-${id}-val`) as HTMLSpanElement

function setSliderValue(id: string, value: number, fmt: (v: number) => string): void {
    const sl = getSlider(id) as HTMLInputElement
    sl.value = String(value)
    getVal(id).textContent = fmt(value)
}

let manualControl = false   // true while user is dragging a panel slider

function syncPanelFromCamera(): void {
    if (manualControl) return
    const { dist, elev, azim } = cameraToSpherical()
    setSliderValue('dist', dist, v => v.toFixed(2))
    setSliderValue('elev', elev, v => `${v.toFixed(0)}°`)
    setSliderValue('azim', azim, v => `${v.toFixed(0)}°`)
}

function syncCameraFromPanel(): void {
    const dist = parseFloat(getSlider('dist').value)
    const elev = parseFloat(getSlider('elev').value)
    const azim = parseFloat(getSlider('azim').value)
    const ty   = parseFloat(getSlider('ty').value)
    sphericalToCamera(dist, elev, azim, ty)
    setSliderValue('dist', dist, v => v.toFixed(2))
    setSliderValue('elev', elev, v => `${v.toFixed(0)}°`)
    setSliderValue('azim', azim, v => `${v.toFixed(0)}°`)
    setSliderValue('ty', ty, v => v.toFixed(2))
}

;['cam-dist','cam-elev','cam-azim','cam-ty'].forEach(id => {
    const el = $(id) as HTMLInputElement
    el.addEventListener('pointerdown', () => { manualControl = true })
    el.addEventListener('pointerup',   () => { manualControl = false })
    el.addEventListener('input',       () => syncCameraFromPanel())
})

$('cam-reset').addEventListener('click', () => {
    sphericalToCamera(CAM_DEFAULTS.dist, CAM_DEFAULTS.elev, CAM_DEFAULTS.azim, CAM_DEFAULTS.ty)
    setSliderValue('dist', CAM_DEFAULTS.dist, v => v.toFixed(2))
    setSliderValue('elev', CAM_DEFAULTS.elev, v => `${v.toFixed(0)}°`)
    setSliderValue('azim', CAM_DEFAULTS.azim, v => `${v.toFixed(0)}°`)
    setSliderValue('ty',   CAM_DEFAULTS.ty,   v => v.toFixed(2))
})

controls.addEventListener('change', syncPanelFromCamera)

// Debug toggles
const allMeshMats: THREE.Material[] = []
let wireframeOn = false

$('wireframe').addEventListener('change', e => {
    wireframeOn = (e.target as HTMLInputElement).checked
    allMeshMats.forEach(m => { (m as any).wireframe = wireframeOn })
})

$('skeleton').addEventListener('change', e => {
    if (skeletonHelper) skeletonHelper.visible = (e.target as HTMLInputElement).checked
})

// ── Hierarchy builder ─────────────────────────────────────────────────────────

interface MeshSummary {
    name: string
    vertexCount: number
    faceCount: number
    indexed: boolean
    materialName: string
    hasSkin: boolean
    boundingBox: THREE.Box3
    physicsAssessment: string
}

const meshSummaries: MeshSummary[] = []

function physicsAssess(verts: number, faces: number, hasSkin: boolean): string {
    if (hasSkin) return '⚠ Skinned mesh — strip skin or use vertex positions as static input'
    if (faces < 50)  return '✗ Too few faces for meaningful soft body'
    if (verts > 8000) return '⚠ High vertex count — may need decimation before soft body'
    return '✓ Suitable for CreateFromTriMesh — weld duplicate UVs first'
}

function buildHierarchyHTML(obj: THREE.Object3D, depth = 0): string {
    const indent = '&nbsp;'.repeat(depth * 4)
    let html = ''

    const tag = obj instanceof THREE.SkinnedMesh ? 'skinnedmesh'
              : obj instanceof THREE.Mesh ? 'mesh'
              : obj instanceof THREE.Bone ? 'bone'
              : 'group'

    const cssClass = obj instanceof THREE.Mesh ? 'mesh'
                   : obj instanceof THREE.Bone ? 'bone'
                   : 'group'

    const name = obj.name || '(unnamed)'

    if (obj instanceof THREE.Mesh) {
        const geo = obj.geometry as THREE.BufferGeometry
        const pos = geo.attributes['position']
        const idx = geo.index
        const verts = pos ? pos.count : 0
        const faces = idx ? idx.count / 3 : (verts / 3)
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
        const matName = mat?.name || mat?.type || 'Material'
        const hasSkin = obj instanceof THREE.SkinnedMesh

        const bbox = new THREE.Box3().setFromObject(obj)
        const assessment = physicsAssess(verts, faces, hasSkin)

        meshSummaries.push({ name, vertexCount: verts, faceCount: Math.round(faces),
            indexed: !!idx, materialName: matName, hasSkin, boundingBox: bbox,
            physicsAssessment: assessment })

        const assessClass = assessment.startsWith('✓') ? 'ok' : 'warn'
        html += `<div class="node">${indent}<span class="${cssClass}">[${tag}]</span> <b>${name}</b><br>`
        html += `${indent}&nbsp;&nbsp;&nbsp;&nbsp;<span class="verts">${verts} verts · ${Math.round(faces)} faces${idx ? ' (indexed)' : ''}</span><br>`
        html += `${indent}&nbsp;&nbsp;&nbsp;&nbsp;<span class="mat">mat: ${matName}</span>${hasSkin ? ' <span class="warn">· skinned</span>' : ''}<br>`
        html += `${indent}&nbsp;&nbsp;&nbsp;&nbsp;<span class="${assessClass}">${assessment}</span></div>`

        if (mat) allMeshMats.push(mat)
        if (hasSkin && !skeletonHelper) {
            skeletonHelper = new THREE.SkeletonHelper(obj)
            skeletonHelper.visible = false
            scene.add(skeletonHelper)
        }
    } else {
        html += `<div class="node">${indent}<span class="${cssClass}">[${tag}]</span> ${name}</div>`
    }

    for (const child of obj.children) {
        html += buildHierarchyHTML(child, depth + 1)
    }
    return html
}

function physicsNotes(): string {
    if (meshSummaries.length === 0) return ''
    const suitable = meshSummaries.filter(m => m.physicsAssessment.startsWith('✓'))
    const skinned  = meshSummaries.filter(m => m.hasSkin)

    let html = '<div class="note">'
    html += `<b>Physics summary</b><br>`
    html += `${meshSummaries.length} mesh(es) found · ${suitable.length} suitable for soft body<br><br>`

    if (skinned.length > 0) {
        html += `<span class="warn">⚠ Skinned meshes detected.</span> Ammo soft body works on raw vertex positions, not skeletal-driven positions. Options:<br>`
        html += `1. In Blender: apply armature modifier → export as plain mesh<br>`
        html += `2. Or: snapshot the posed vertices each frame and feed to Ammo as a dynamic rigid body (not true soft body)<br><br>`
    }

    if (suitable.length > 0) {
        html += `<span class="ok">✓ For suitable meshes:</span> use <code>CreateFromTriMesh(vertices, indices, nFaces)</code>. Weld duplicate vertices first (UV seams create split verts that break spring constraints).<br>`
    }
    html += '</div>'
    return html
}

// ── GLB Load ──────────────────────────────────────────────────────────────────

const loader = new GLTFLoader()

loader.load(
    tshirtUrl,
    gltf => {
        document.getElementById('loading')!.remove()

        const model = gltf.scene

        // Auto-center and scale to roughly fit the viewport
        const bbox = new THREE.Box3().setFromObject(model)
        const center = bbox.getCenter(new THREE.Vector3())
        const size   = bbox.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale  = 2.0 / maxDim

        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        // Enable shadows on all meshes
        model.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true
                child.receiveShadow = true
            }
        })

        scene.add(model)

        // Auto-aim camera at the model's top third (collar area)
        const scaledCenter = bbox.getCenter(new THREE.Vector3()).multiplyScalar(scale)
        const targetY = scaledCenter.y + size.y * scale * 0.1
        controls.target.set(0, targetY, 0)
        setSliderValue('ty', targetY, v => v.toFixed(2))

        const camDist = 3.5
        sphericalToCamera(camDist, CAM_DEFAULTS.elev, CAM_DEFAULTS.azim, targetY)

        // Build and show hierarchy panel
        const hierarchyEl = document.getElementById('hierarchy')!
        const treeHTML = buildHierarchyHTML(model)
        hierarchyEl.innerHTML = `<h3>Scene Hierarchy</h3>${treeHTML}${physicsNotes()}`

        console.log('[GLB Explorer] Mesh summaries:', meshSummaries)
        console.log('[GLB Explorer] Animations:', gltf.animations.map(a => a.name))
    },
    xhr => {
        const pct = xhr.total ? Math.round((xhr.loaded / xhr.total) * 100) : '…'
        const el = document.getElementById('loading')
        if (el) el.textContent = `Loading GLB… ${pct}%`
    },
    err => {
        console.error('GLB load error:', err)
        const el = document.getElementById('loading')
        if (el) el.textContent = 'Failed to load GLB'
    },
)

// ── Render Loop ───────────────────────────────────────────────────────────────

function tick(): void {
    requestAnimationFrame(tick)
    controls.update()
    renderer.render(scene, camera)
}
tick()

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
})
