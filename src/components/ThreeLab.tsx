import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './ThreeLab.css'

type ThreeTheme = 'dark' | 'light'
type ObjectKind = 'torus-knot' | 'icosahedron' | 'cube'
type ScenePreset = 'studio' | 'neon' | 'clay'

type ThreeLabProps = {
  /** Uses OSA's app-level theme; the scene remains an unsaved Lab draft. */
  theme: ThreeTheme
}

type ThreeEngine = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  floor: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  keyLight: THREE.DirectionalLight
  fillLight: THREE.DirectionalLight
  resizeObserver: ResizeObserver
  frameId: number
  objectKind: ObjectKind
  preset: ScenePreset
  render: () => void
}

type PresetDefinition = {
  background: THREE.ColorRepresentation
  fog: THREE.ColorRepresentation
  object: THREE.ColorRepresentation
  emissive: THREE.ColorRepresentation
  floor: THREE.ColorRepresentation
  key: THREE.ColorRepresentation
  fill: THREE.ColorRepresentation
  emissiveIntensity: number
  roughness: number
  metalness: number
  wireframe: boolean
  exposure: number
}

function createGeometry(kind: ObjectKind) {
  switch (kind) {
    case 'torus-knot':
      return new THREE.TorusKnotGeometry(0.98, 0.31, 180, 28)
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(1.34, 2)
    case 'cube':
      return new THREE.BoxGeometry(1.85, 1.85, 1.85, 5, 5, 5)
  }
}

function presetDefinition(preset: ScenePreset, theme: ThreeTheme): PresetDefinition {
  const dark = theme === 'dark'

  switch (preset) {
    case 'studio':
      return {
        background: dark ? '#10141c' : '#edf2f8',
        fog: dark ? '#10141c' : '#edf2f8',
        object: dark ? '#71a8ff' : '#2569c8',
        emissive: dark ? '#102b52' : '#071a36',
        floor: dark ? '#1b2230' : '#d5dde8',
        key: '#dceaff',
        fill: '#8e7cff',
        emissiveIntensity: dark ? 0.28 : 0.08,
        roughness: 0.34,
        metalness: 0.68,
        wireframe: false,
        exposure: dark ? 1.12 : 1.02,
      }
    case 'neon':
      return {
        background: dark ? '#090713' : '#ece9f7',
        fog: dark ? '#090713' : '#ece9f7',
        object: '#d769ff',
        emissive: '#53136e',
        floor: dark ? '#161124' : '#dad3ec',
        key: '#ff8be5',
        fill: '#5ee8ff',
        emissiveIntensity: 0.72,
        roughness: 0.2,
        metalness: 0.46,
        wireframe: false,
        exposure: dark ? 1.2 : 0.92,
      }
    case 'clay':
      return {
        background: dark ? '#171412' : '#f1e9df',
        fog: dark ? '#171412' : '#f1e9df',
        object: dark ? '#df8b63' : '#b95f3d',
        emissive: '#000000',
        floor: dark ? '#29221e' : '#ded1c3',
        key: '#ffe3c9',
        fill: '#9cc7df',
        emissiveIntensity: 0,
        roughness: 0.9,
        metalness: 0,
        wireframe: false,
        exposure: dark ? 1.05 : 1,
      }
  }
}

function applyPreset(engine: ThreeEngine, preset: ScenePreset, theme: ThreeTheme) {
  const definition = presetDefinition(preset, theme)
  engine.scene.background = new THREE.Color(definition.background)
  engine.scene.fog = new THREE.Fog(definition.fog, 7, 15)
  engine.mesh.material.color.set(definition.object)
  engine.mesh.material.emissive.set(definition.emissive)
  engine.mesh.material.emissiveIntensity = definition.emissiveIntensity
  engine.mesh.material.roughness = definition.roughness
  engine.mesh.material.metalness = definition.metalness
  engine.mesh.material.wireframe = definition.wireframe
  engine.mesh.material.needsUpdate = true
  engine.floor.material.color.set(definition.floor)
  engine.keyLight.color.set(definition.key)
  engine.fillLight.color.set(definition.fill)
  engine.renderer.toneMappingExposure = definition.exposure
  engine.preset = preset
  engine.render()
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose()
  }
  material.dispose()
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }

    renderable.geometry?.dispose()
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach(disposeMaterial)
    } else if (renderable.material) {
      disposeMaterial(renderable.material)
    }
  })
  scene.clear()
}

function destroyEngine(engine: ThreeEngine) {
  window.cancelAnimationFrame(engine.frameId)
  engine.resizeObserver.disconnect()
  engine.controls.dispose()
  disposeScene(engine.scene)
  engine.renderer.renderLists.dispose()
  engine.renderer.dispose()
  engine.renderer.forceContextLoss()
  engine.renderer.domElement.remove()
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

/**
 * A local Three.js scene for experimenting with geometry, lighting, materials,
 * and orbit controls. Its only exits are ordinary PNG and Three scene files.
 */
export function ThreeLab({ theme }: ThreeLabProps) {
  const stageHostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<ThreeEngine | null>(null)
  const requestedPlayingRef = useRef(true)
  const requestedObjectRef = useRef<ObjectKind>('torus-knot')
  const requestedPresetRef = useRef<ScenePreset>('studio')
  const [isPlaying, setIsPlaying] = useState(true)
  const [objectKind, setObjectKind] = useState<ObjectKind>('torus-knot')
  const [preset, setPreset] = useState<ScenePreset>('studio')
  const [isReady, setIsReady] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(null)

  useEffect(() => {
    requestedPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    requestedObjectRef.current = objectKind
    const engine = engineRef.current
    if (!engine || engine.objectKind === objectKind) return

    const previousGeometry = engine.mesh.geometry
    engine.mesh.geometry = createGeometry(objectKind)
    engine.objectKind = objectKind
    previousGeometry.dispose()
    engine.render()
  }, [objectKind])

  useEffect(() => {
    requestedPresetRef.current = preset
    const engine = engineRef.current
    if (!engine) return
    applyPreset(engine, preset, theme)
  }, [preset, theme])

  useEffect(() => {
    const host = stageHostRef.current
    if (!host) return undefined

    let engine: ThreeEngine | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let partialScene: THREE.Scene | null = null
    let partialControls: OrbitControls | null = null
    let disposed = false
    setIsReady(false)
    setInitializationError(null)

    try {
      const scene = new THREE.Scene()
      partialScene = scene
      scene.name = 'OSA Three.js Lab Scene'
      scene.userData = { source: 'OSA Three.js Lab', disposable: true }

      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const camera = new THREE.PerspectiveCamera(43, width / height, 0.1, 100)
      camera.name = 'Orbit Camera'
      camera.position.set(4.4, 2.9, 5.4)
      scene.add(camera)

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      renderer.domElement.setAttribute('aria-label', 'Interactive Three.js scene')
      renderer.domElement.setAttribute('role', 'img')
      host.replaceChildren(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      partialControls = controls
      controls.enableDamping = true
      controls.dampingFactor = 0.065
      controls.minDistance = 3
      controls.maxDistance = 11
      controls.maxPolarAngle = Math.PI * 0.49
      controls.target.set(0, 0, 0)
      controls.update()

      const objectMaterial = new THREE.MeshStandardMaterial()
      const mesh = new THREE.Mesh(createGeometry(requestedObjectRef.current), objectMaterial)
      mesh.name = 'Lab Object'
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)

      const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 })
      const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 72), floorMaterial)
      floor.name = 'Ground Disc'
      floor.position.y = -1.62
      floor.rotation.x = -Math.PI / 2
      floor.receiveShadow = true
      scene.add(floor)

      const hemisphere = new THREE.HemisphereLight('#c9ddff', '#352d46', 1.15)
      hemisphere.name = 'Ambient Light'
      scene.add(hemisphere)

      const keyLight = new THREE.DirectionalLight('#ffffff', 3.4)
      keyLight.name = 'Key Light'
      keyLight.position.set(4.2, 6.2, 3.4)
      keyLight.castShadow = true
      keyLight.shadow.mapSize.set(1024, 1024)
      keyLight.shadow.camera.near = 0.5
      keyLight.shadow.camera.far = 18
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight('#91a9ff', 2.1)
      fillLight.name = 'Fill Light'
      fillLight.position.set(-4.5, 2.2, -2.8)
      scene.add(fillLight)

      const render = () => renderer?.render(scene, camera)
      const resizeObserver = new ResizeObserver(() => {
        const nextWidth = Math.max(1, host.clientWidth)
        const nextHeight = Math.max(1, host.clientHeight)
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer?.setSize(nextWidth, nextHeight, false)
        render()
      })

      engine = {
        scene,
        camera,
        renderer,
        controls,
        mesh,
        floor,
        keyLight,
        fillLight,
        resizeObserver,
        frameId: 0,
        objectKind: requestedObjectRef.current,
        preset: requestedPresetRef.current,
        render,
      }
      engineRef.current = engine
      applyPreset(engine, requestedPresetRef.current, theme)
      resizeObserver.observe(host)

      let previousTime = performance.now()
      const animate = (time: number) => {
        if (!engine) return
        const delta = Math.min((time - previousTime) / 1000, 0.05)
        previousTime = time

        if (requestedPlayingRef.current) {
          engine.mesh.rotation.y += delta * 0.48
          engine.mesh.rotation.x += delta * 0.11
        }
        engine.controls.update(delta)
        engine.renderer.render(engine.scene, engine.camera)
        engine.frameId = window.requestAnimationFrame(animate)
      }
      engine.frameId = window.requestAnimationFrame(animate)
      queueMicrotask(() => {
        if (!disposed && engineRef.current === engine) setIsReady(true)
      })
    } catch {
      if (engine) {
        const failedEngine = engine
        engine = null
        destroyEngine(failedEngine)
        if (engineRef.current === failedEngine) engineRef.current = null
      } else {
        partialControls?.dispose()
        if (partialScene) disposeScene(partialScene)
        renderer?.renderLists.dispose()
        renderer?.dispose()
        renderer?.forceContextLoss()
        renderer?.domElement.remove()
      }
      queueMicrotask(() => {
        if (!disposed && !engineRef.current) {
          setInitializationError('Three.js could not start WebGL on this device.')
        }
      })
    }

    return () => {
      disposed = true
      if (!engine) return
      const currentEngine = engine
      engine = null
      destroyEngine(currentEngine)
      if (engineRef.current === currentEngine) engineRef.current = null
    }
  }, [theme])

  const randomize = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return

    const hue = Math.random()
    const scale = 0.82 + Math.random() * 0.36
    engine.mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    )
    engine.mesh.scale.setScalar(scale)
    engine.mesh.material.color.setHSL(hue, 0.72, theme === 'dark' ? 0.63 : 0.46)
    engine.mesh.material.emissive.setHSL((hue + 0.08) % 1, 0.65, theme === 'dark' ? 0.14 : 0.05)
    engine.keyLight.position.set(
      -5 + Math.random() * 10,
      4.5 + Math.random() * 3,
      -4 + Math.random() * 8,
    )
    engine.fillLight.position.set(
      -4 + Math.random() * 8,
      1.5 + Math.random() * 3,
      -4 + Math.random() * 8,
    )
    engine.render()
  }, [theme])

  const exportPng = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return

    engine.renderer.render(engine.scene, engine.camera)
    engine.renderer.domElement.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'osa-three-scene.png')
    }, 'image/png')
  }, [])

  const exportSceneJson = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return

    const contents = JSON.stringify(engine.scene.toJSON(), null, 2)
    downloadBlob(new Blob([contents], { type: 'application/json' }), 'osa-three-scene.json')
  }, [])

  return (
    <section className="three-lab" aria-label="Three.js 3D lab">
      <header className="three-lab__header">
        <div className="three-lab__identity">
          <h2>Three.js</h2>
          <p>disposable 3D scene</p>
        </div>

        <div className="three-lab__controls" aria-label="3D scene controls">
          <button
            type="button"
            aria-pressed={!isPlaying}
            onClick={() => setIsPlaying((playing) => !playing)}
          >
            {isPlaying ? 'pause' : 'play'}
          </button>
          <button type="button" disabled={!isReady} onClick={randomize}>randomize</button>

          <label>
            <span>object</span>
            <select
              value={objectKind}
              onChange={(event) => setObjectKind(event.target.value as ObjectKind)}
            >
              <option value="torus-knot">torus knot</option>
              <option value="icosahedron">icosahedron</option>
              <option value="cube">cube</option>
            </select>
          </label>

          <label>
            <span>look</span>
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value as ScenePreset)}
            >
              <option value="studio">studio</option>
              <option value="neon">neon</option>
              <option value="clay">clay</option>
            </select>
          </label>

          <button type="button" disabled={!isReady} onClick={exportPng}>export PNG</button>
          <button
            className="three-lab__export"
            type="button"
            disabled={!isReady}
            onClick={exportSceneJson}
          >
            export scene JSON
          </button>
        </div>
      </header>

      <div className="three-lab__stage">
        <div ref={stageHostRef} className="three-lab__canvas" />
        {!isReady && !initializationError
          ? <p className="three-lab__notice">starting renderer…</p>
          : null}
        {initializationError
          ? <p className="three-lab__notice is-error" role="alert">{initializationError}</p>
          : null}
        <p className="three-lab__hint">drag to orbit · wheel to zoom</p>
      </div>

      <footer className="three-lab__footer">
        local-only · PNG + portable Three.js scene JSON
      </footer>
    </section>
  )
}
