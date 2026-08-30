import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Application,
  Container,
  Graphics,
  Sprite,
  type Texture,
  type Ticker,
} from 'pixi.js'
import { LabCaptureButton } from '../lab/LabCaptureButton'
import { dataUrlToBlob } from '../lab/labCaptureUtils'
import type { LabCapture } from '../lab/labTypes'
import './PixiLab.css'

type PixiTheme = 'dark' | 'light'

type PixiLabProps = {
  /** Uses OSA's app-level theme; this Lab never owns a saved preference. */
  theme: PixiTheme
}

type LabParticle = {
  sprite: Sprite
  velocityX: number
  velocityY: number
  spin: number
  phase: number
  pulse: number
  baseAlpha: number
}

type PixiEngine = {
  app: Application
  layer: Container
  particles: LabParticle[]
  particleTexture: Texture
  resizeObserver: ResizeObserver
  update: (ticker: Ticker) => void
  width: number
  height: number
  speed: number
}

const MIN_PARTICLES = 40
const MAX_PARTICLES = 700
const PARTICLE_STEP = 20

function particlePalette(theme: PixiTheme) {
  return theme === 'dark'
    ? [0x58a6ff, 0x78dce8, 0xa770d5, 0xee8dbe, 0xf0c36a, 0x74d7a5]
    : [0x0969da, 0x078b91, 0x6f42c1, 0xbf3989, 0xbc6b00, 0x1a7f37]
}

function stageBackground(theme: PixiTheme) {
  return theme === 'dark' ? '#10141c' : '#f8fafc'
}

function randomBetween(minimum: number, maximum: number) {
  return minimum + Math.random() * (maximum - minimum)
}

function randomizeParticle(
  particle: LabParticle,
  width: number,
  height: number,
  palette: number[],
) {
  particle.sprite.position.set(Math.random() * width, Math.random() * height)
  particle.sprite.scale.set(randomBetween(0.35, 1.25))
  particle.sprite.rotation = Math.random() * Math.PI * 2
  particle.sprite.tint = palette[Math.floor(Math.random() * palette.length)]
  particle.baseAlpha = randomBetween(0.42, 0.9)
  particle.sprite.alpha = particle.baseAlpha
  particle.velocityX = randomBetween(-1.25, 1.25)
  particle.velocityY = randomBetween(-1.05, 1.05)
  particle.spin = randomBetween(-0.025, 0.025)
  particle.phase = Math.random() * Math.PI * 2
  particle.pulse = randomBetween(0.012, 0.04)
}

function addParticle(engine: PixiEngine, palette: number[]) {
  const sprite = new Sprite({
    texture: engine.particleTexture,
    anchor: 0.5,
  })
  const particle: LabParticle = {
    sprite,
    velocityX: 0,
    velocityY: 0,
    spin: 0,
    phase: 0,
    pulse: 0,
    baseAlpha: 1,
  }

  randomizeParticle(particle, engine.width, engine.height, palette)
  engine.particles.push(particle)
  engine.layer.addChild(sprite)
}

function setParticleCount(engine: PixiEngine, requestedCount: number, palette: number[]) {
  const count = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, requestedCount))

  while (engine.particles.length < count) {
    addParticle(engine, palette)
  }

  while (engine.particles.length > count) {
    const particle = engine.particles.pop()
    if (!particle) break
    engine.layer.removeChild(particle.sprite)
    // The generated circle texture is shared, so each sprite releases only
    // its own display-object resources here.
    particle.sprite.destroy()
  }
}

function destroyEngine(engine: PixiEngine) {
  engine.resizeObserver.disconnect()
  engine.app.stop()
  engine.app.ticker.remove(engine.update)
  engine.layer.removeChildren().forEach((child) => child.destroy())
  engine.particles.length = 0
  engine.particleTexture.destroy(true)
  engine.app.destroy({ removeView: true }, { children: true, context: true })
}

/**
 * A disposable PixiJS playground. It generates one shared sprite texture and
 * batches hundreds of sprites, but never reads or writes an OSA board.
 */
export function PixiLab({ theme }: PixiLabProps) {
  const stageHostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<PixiEngine | null>(null)
  const requestedPlayingRef = useRef(true)
  const requestedCountRef = useRef(260)
  const requestedSpeedRef = useRef(1)
  const [isPlaying, setIsPlaying] = useState(true)
  const [particleCount, setParticleCountState] = useState(260)
  const [speed, setSpeed] = useState(1)
  const [isReady, setIsReady] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(null)

  useEffect(() => {
    requestedPlayingRef.current = isPlaying
    const engine = engineRef.current
    if (!engine) return

    if (isPlaying) {
      engine.app.start()
    } else {
      engine.app.stop()
      engine.app.render()
    }
  }, [isPlaying])

  useEffect(() => {
    requestedCountRef.current = particleCount
    const engine = engineRef.current
    if (!engine) return

    setParticleCount(engine, particleCount, particlePalette(theme))
    if (!isPlaying) engine.app.render()
  }, [isPlaying, particleCount, theme])

  useEffect(() => {
    requestedSpeedRef.current = speed
    if (engineRef.current) engineRef.current.speed = speed
  }, [speed])

  useEffect(() => {
    const host = stageHostRef.current
    if (!host) return undefined

    let disposed = false
    let engine: PixiEngine | null = null
    let appInitialized = false
    let partialTexture: Texture | null = null
    setIsReady(false)
    setInitializationError(null)

    const initialize = async () => {
      const app = new Application()

      try {
        const initialWidth = Math.max(1, host.clientWidth)
        const initialHeight = Math.max(1, host.clientHeight)
        await app.init({
          width: initialWidth,
          height: initialHeight,
          antialias: true,
          autoDensity: true,
          autoStart: false,
          background: stageBackground(theme),
          powerPreference: 'high-performance',
          preference: 'webgl',
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          sharedTicker: false,
        })
        appInitialized = true

        if (disposed) {
          app.destroy({ removeView: true }, { children: true, context: true })
          return
        }

        app.canvas.setAttribute('aria-label', 'Animated PixiJS particle field')
        app.canvas.setAttribute('role', 'img')
        host.replaceChildren(app.canvas)

        // Drawing one circle and turning it into a shared texture keeps this a
        // graphics experiment while letting Pixi batch every visible sprite.
        const sourceGraphic = new Graphics()
          .circle(14, 14, 11)
          .fill(0xffffff)
        let particleTexture: Texture
        try {
          particleTexture = app.renderer.generateTexture({
            target: sourceGraphic,
            resolution: 2,
          })
          partialTexture = particleTexture
        } finally {
          sourceGraphic.destroy({ context: true })
        }

        const layer = new Container()
        app.stage.addChild(layer)

        const update = (ticker: Ticker) => {
          const frameScale = ticker.deltaTime * currentEngine.speed
          const margin = 24

          for (const particle of currentEngine.particles) {
            const { sprite } = particle
            sprite.x += particle.velocityX * frameScale
            sprite.y += particle.velocityY * frameScale
            sprite.rotation += particle.spin * frameScale
            particle.phase += particle.pulse * frameScale
            sprite.alpha = particle.baseAlpha + Math.sin(particle.phase) * 0.1

            if (sprite.x < -margin) sprite.x = currentEngine.width + margin
            if (sprite.x > currentEngine.width + margin) sprite.x = -margin
            if (sprite.y < -margin) sprite.y = currentEngine.height + margin
            if (sprite.y > currentEngine.height + margin) sprite.y = -margin
          }
        }

        const resizeObserver = new ResizeObserver(() => {
          const width = Math.max(1, host.clientWidth)
          const height = Math.max(1, host.clientHeight)
          currentEngine.width = width
          currentEngine.height = height
          app.renderer.resize(width, height)
          if (!requestedPlayingRef.current) app.render()
        })

        const currentEngine: PixiEngine = {
          app,
          layer,
          particles: [],
          particleTexture,
          resizeObserver,
          update,
          width: initialWidth,
          height: initialHeight,
          speed: requestedSpeedRef.current,
        }
        engine = currentEngine
        partialTexture = null
        engineRef.current = currentEngine
        setParticleCount(currentEngine, requestedCountRef.current, particlePalette(theme))
        app.ticker.add(update)
        resizeObserver.observe(host)
        app.render()

        if (requestedPlayingRef.current) app.start()
        setIsReady(true)
      } catch {
        if (engine) {
          const failedEngine = engine
          engine = null
          destroyEngine(failedEngine)
          if (engineRef.current === failedEngine) engineRef.current = null
        } else if (appInitialized) {
          partialTexture?.destroy(true)
          app.destroy({ removeView: true }, { children: true, context: true })
        } else {
          // A renderer was never created, but the Application constructor did
          // create its stage container.
          app.stage.destroy({ children: true, context: true })
        }
        if (!disposed) {
          setInitializationError('PixiJS could not start on this device.')
        }
      }
    }

    void initialize()

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

    const palette = particlePalette(theme)
    for (const particle of engine.particles) {
      randomizeParticle(particle, engine.width, engine.height, palette)
    }
    if (!requestedPlayingRef.current) engine.app.render()
  }, [theme])

  const exportPng = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return

    engine.app.render()
    engine.app.renderer.extract.download({
      target: engine.app.stage,
      frame: engine.app.screen,
      filename: 'osa-pixi-particles.png',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      clearColor: stageBackground(theme),
      antialias: true,
    })
  }, [theme])

  const capture = async (): Promise<LabCapture> => {
    const engine = engineRef.current
    if (!engine) throw new Error('The Pixi renderer is not ready yet.')
    engine.app.render()
    const dataUrl = await engine.app.renderer.extract.base64({
      target: engine.app.stage,
      frame: engine.app.screen,
      format: 'png',
      resolution: 1,
      clearColor: stageBackground(theme),
      antialias: true,
    })
    const preview = await dataUrlToBlob(dataUrl)
    return { name: 'Pixi particle field', toolId: 'pixi', preview, description: `${particleCount} particles at ${speed.toFixed(2)}× speed; captured animation frame.` }
  }

  return (
    <section className="pixi-lab" aria-label="PixiJS graphics lab">
      <header className="pixi-lab__header">
        <div className="pixi-lab__identity">
          <h2>PixiJS</h2>
          <p>disposable 2D particles</p>
        </div>

        <div className="pixi-lab__controls" aria-label="Particle controls">
          <button
            type="button"
            aria-pressed={!isPlaying}
            onClick={() => setIsPlaying((playing) => !playing)}
          >
            {isPlaying ? 'pause' : 'play'}
          </button>
          <button type="button" disabled={!isReady} onClick={randomize}>randomize</button>

          <label className="pixi-lab__range">
            <span>particles</span>
            <input
              type="range"
              min={MIN_PARTICLES}
              max={MAX_PARTICLES}
              step={PARTICLE_STEP}
              value={particleCount}
              onChange={(event) => setParticleCountState(Number(event.target.value))}
            />
            <output>{particleCount}</output>
          </label>

          <label className="pixi-lab__range">
            <span>speed</span>
            <input
              type="range"
              min="0.25"
              max="2.5"
              step="0.25"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
            <output>{speed.toFixed(2)}x</output>
          </label>

          <button
            className="pixi-lab__export"
            type="button"
            disabled={!isReady}
            onClick={exportPng}
          >
            export PNG
          </button>
          <LabCaptureButton capture={capture} disabled={!isReady} />
        </div>
      </header>

      <div className="pixi-lab__stage">
        <div ref={stageHostRef} className="pixi-lab__canvas" />
        {!isReady && !initializationError
          ? <p className="pixi-lab__notice">starting renderer…</p>
          : null}
        {initializationError
          ? <p className="pixi-lab__notice is-error" role="alert">{initializationError}</p>
          : null}
      </div>

      <footer className="pixi-lab__footer">
        shared sprite texture · local-only · PNG export
      </footer>
    </section>
  )
}
