import { useMemo, useState, type CSSProperties } from 'react'
import { LAB_GROUPS } from './labCatalog'
import type { LabWorkbenchId } from './labTypes'
import './LabHome.css'

type LabHomeProps = {
  noteCount: number
  artifactCount: number
  onOpenNotebook: () => void
  onOpenSettings: () => void
  onOpenWorkbench: (workbenchId: LabWorkbenchId) => void
}

type StationStyle = CSSProperties & {
  '--station-x': string
  '--station-y': string
  '--station-size': string
  '--paint-turn': string
  '--paint-variant': string
}

type ClusterStyle = CSSProperties & {
  '--cluster-x': string
  '--cluster-y': string
  '--cluster-width': string
  '--cluster-height': string
  '--cluster-turn': string
  '--label-x': string
  '--label-y': string
}

type Station = {
  id: string
  name: string
  note: string
  output: string
  glyph: string
  kind: 'workbench' | 'room'
  style: StationStyle
  open: () => void
}

type ClusterLayout = {
  x: number
  y: number
  width: number
  height: number
  turn: number
  labelX: number
  labelY: number
  points: readonly { x: number, y: number }[]
}

/**
 * Families occupy loose islands around LAB. The values describe composition,
 * while the catalog still owns which instruments exist in each family.
 */
const CLUSTER_LAYOUTS: readonly ClusterLayout[] = [
  {
    x: 15, y: 16, width: 20, height: 46, turn: -5,
    labelX: 5, labelY: 25,
    points: [{ x: 60, y: 21.74 }, { x: 30, y: 48.91 }, { x: 35, y: 83.7 }],
  },
  {
    x: 35, y: 7, width: 24, height: 22, turn: 5,
    labelX: 50, labelY: 96,
    points: [{ x: 33.33, y: 59.09 }, { x: 75, y: 40.91 }],
  },
  {
    x: 63, y: 13, width: 21, height: 58, turn: -4,
    labelX: 0, labelY: 78,
    points: [
      { x: 28.57, y: 15.52 },
      { x: 66.67, y: 36.21 },
      { x: 76.19, y: 62.93 },
      { x: 61.9, y: 87.93 },
    ],
  },
  {
    x: 38, y: 65, width: 32, height: 23, turn: 6,
    labelX: 18, labelY: 12,
    points: [{ x: 84.38, y: 30.43 }, { x: 53.13, y: 69.57 }, { x: 21.88, y: 60.87 }],
  },
]

const ROOM_CLUSTER: ClusterLayout = {
  x: 17, y: 62, width: 19, height: 26, turn: 1,
  labelX: 12, labelY: 18,
  points: [{ x: 73.68, y: 26.92 }, { x: 31.58, y: 73.08 }],
}

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function clusterStyle(layout: ClusterLayout): ClusterStyle {
  return {
    '--cluster-x': `${layout.x}%`,
    '--cluster-y': `${layout.y}%`,
    '--cluster-width': `${layout.width}%`,
    '--cluster-height': `${layout.height}%`,
    '--cluster-turn': `${layout.turn}deg`,
    '--label-x': `${layout.labelX}%`,
    '--label-y': `${layout.labelY}%`,
  }
}

/**
 * The authored points keep the known instruments clear around LAB. A generated
 * fallback keeps a newly catalogued instrument usable until the composition is
 * deliberately rebalanced.
 */
function clusteredStationStyle(
  layout: ClusterLayout,
  groupIndex: number,
  stationIndex: number,
  stationCount: number,
): StationStyle {
  const fallbackAngle = -90 + (360 / Math.max(stationCount, 1)) * stationIndex
  const fallbackRadians = fallbackAngle * (Math.PI / 180)
  const point = layout.points[stationIndex] ?? {
    x: 50 + Math.cos(fallbackRadians) * 34,
    y: 50 + Math.sin(fallbackRadians) * 34,
  }
  const size = 90 + ((groupIndex * 5 + stationIndex * 7) % 6)

  return {
    '--station-x': `${point.x}%`,
    '--station-y': `${point.y}%`,
    '--station-size': `${size}px`,
    '--paint-turn': `${-28 + ((groupIndex * 29 + stationIndex * 23) % 56)}deg`,
    '--paint-variant': `${(groupIndex + stationIndex) % 5}`,
  }
}

/** The Lab's front door is an instrument surface, not a catalog page. */
export function LabHome({
  noteCount,
  artifactCount,
  onOpenNotebook,
  onOpenSettings,
  onOpenWorkbench,
}: LabHomeProps) {
  const [activeStationId, setActiveStationId] = useState<string | null>(null)

  const workbenchGroups = useMemo(() => LAB_GROUPS.map((group, groupIndex) => {
    const layout = CLUSTER_LAYOUTS[groupIndex % CLUSTER_LAYOUTS.length]

    return {
      ...group,
      id: toId(group.name),
      clusterIndex: groupIndex % CLUSTER_LAYOUTS.length,
      style: clusterStyle(layout),
      stations: group.labs.map<Station>((lab, stationIndex) => ({
        ...lab,
        kind: 'workbench',
        style: clusteredStationStyle(layout, groupIndex, stationIndex, group.labs.length),
        open: () => onOpenWorkbench(lab.id),
      })),
    }
  }), [onOpenWorkbench])

  const roomStations = useMemo<Station[]>(() => [
    {
      id: 'notebook',
      name: 'Notebook',
      note: `${noteCount} notes · ${artifactCount} files`,
      output: 'ideas, observations, and Lab artifacts',
      glyph: '▤',
      kind: 'room',
      style: clusteredStationStyle(ROOM_CLUSTER, 4, 0, 2),
      open: onOpenNotebook,
    },
    {
      id: 'settings',
      name: 'Settings',
      note: 'appearance · modules · storage',
      output: 'the way the Lab behaves',
      glyph: '⚙',
      kind: 'room',
      style: clusteredStationStyle(ROOM_CLUSTER, 4, 1, 2),
      open: onOpenSettings,
    },
  ], [artifactCount, noteCount, onOpenNotebook, onOpenSettings])

  const stations = [...workbenchGroups.flatMap((group) => group.stations), ...roomStations]
  const activeStation = stations.find((station) => station.id === activeStationId)

  const renderStation = (station: Station) => (
    <li
      className={`lab-home__station${station.kind === 'room' ? ' is-room' : ''}`}
      data-paint={station.style['--paint-variant']}
      key={station.id}
      style={station.style}
      onMouseEnter={() => setActiveStationId(station.id)}
      onMouseLeave={() => setActiveStationId(null)}
    >
      <button
        type="button"
        aria-label={`Open ${station.name}: ${station.note}`}
        title={`${station.name} — ${station.note}`}
        onClick={station.open}
        onFocus={() => setActiveStationId(station.id)}
        onBlur={() => setActiveStationId(null)}
      >
        <span className="lab-home__station-glyph" aria-hidden="true">{station.glyph}</span>
        <strong>{station.name}</strong>
      </button>
    </li>
  )

  return (
    <section className="lab-home" aria-labelledby="lab-home-title">
      <h2 className="lab-home__visually-hidden" id="lab-home-title">OSA Lab instruments</h2>

      <div className="lab-home__stage">
        <div className="lab-home__ambient-paint" aria-hidden="true" />
        <div className="lab-home__light lab-home__light--one" aria-hidden="true" />
        <div className="lab-home__light lab-home__light--two" aria-hidden="true" />
        <div className="lab-home__orbits" aria-hidden="true">
          <span />
          <span />
        </div>

        <div
          className="lab-home__core"
          role="img"
          aria-label="LAB, surrounded by clustered creative workbenches and rooms."
        >
          <span className="lab-home__core-paint" aria-hidden="true" />
          <span className="lab-home__core-disc" aria-hidden="true">
            <strong>LAB</strong>
          </span>
        </div>

        <section
          className="lab-home__rooms"
          style={clusterStyle(ROOM_CLUSTER)}
          aria-labelledby="lab-home-rooms-title"
        >
          <h3 id="lab-home-rooms-title">Lab rooms</h3>
          <ul>{roomStations.map(renderStation)}</ul>
        </section>

        <div className="lab-home__groups">
          {workbenchGroups.map((group) => (
            <section
              className={`lab-home__group lab-home__group--cluster-${group.clusterIndex}`}
              style={group.style}
              aria-labelledby={`lab-home-group-${group.id}`}
              key={group.id}
            >
              <h3 id={`lab-home-group-${group.id}`}>{group.name}</h3>
              <p className="lab-home__visually-hidden">{group.description}</p>
              <ul>{group.stations.map(renderStation)}</ul>
            </section>
          ))}
        </div>

        <div className="lab-home__readout" role="status" aria-live="polite">
          {activeStation ? (
            <>
              <strong>{activeStation.name}</strong>
              <span>{activeStation.note}</span>
              <small>makes {activeStation.output}</small>
            </>
          ) : (
            <>
              <strong>Enter the Lab</strong>
              <span>Choose an instrument and start playing.</span>
            </>
          )}
        </div>

        <p className="lab-home__hint" aria-hidden="true">move over an instrument</p>
      </div>
    </section>
  )
}
