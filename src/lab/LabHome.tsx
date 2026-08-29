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

/** The Lab's front door: a visual index rather than another crowded toolbar. */
export function LabHome({
  noteCount,
  artifactCount,
  onOpenNotebook,
  onOpenSettings,
  onOpenWorkbench,
}: LabHomeProps) {
  return (
    <div className="lab-home">
      <section className="lab-home__hero" aria-labelledby="lab-home-title">
        <div className="lab-home__hero-copy">
          <p className="lab-home__eyebrow">Experimental facility</p>
          <h2 id="lab-home-title">Make a mess.<br />Keep the useful parts.</h2>
          <p>
            One subject can move through many instruments. Explore freely, keep notes and files,
            and decide later what belongs in OSA.
          </p>
          <div className="lab-home__hero-actions">
            <button type="button" onClick={onOpenNotebook}>
              Open notebook
              <span>{noteCount} notes · {artifactCount} files</span>
            </button>
            <button type="button" onClick={onOpenSettings}>
              Lab settings
              <span>appearance · modules · storage</span>
            </button>
          </div>
        </div>

        <div className="lab-home__apparatus" aria-hidden="true">
          <span className="lab-home__apparatus-core">OSA</span>
          <span className="lab-home__apparatus-ring lab-home__apparatus-ring--one" />
          <span className="lab-home__apparatus-ring lab-home__apparatus-ring--two" />
          <span className="lab-home__apparatus-node lab-home__apparatus-node--one">data</span>
          <span className="lab-home__apparatus-node lab-home__apparatus-node--two">sound</span>
          <span className="lab-home__apparatus-node lab-home__apparatus-node--three">form</span>
        </div>
      </section>

      <div className="lab-home__catalog">
        {LAB_GROUPS.map((group) => (
          <section className="lab-home__group" key={group.name} aria-labelledby={`lab-group-${group.labs[0].id}`}>
            <header>
              <h3 id={`lab-group-${group.labs[0].id}`}>{group.name}</h3>
              <p>{group.description}</p>
            </header>
            <div className="lab-home__instruments">
              {group.labs.map((lab) => (
                <button
                  className="lab-home__instrument"
                  type="button"
                  key={lab.id}
                  onClick={() => onOpenWorkbench(lab.id)}
                >
                  <span className="lab-home__instrument-glyph" aria-hidden="true">{lab.glyph}</span>
                  <span className="lab-home__instrument-copy">
                    <strong>{lab.name}</strong>
                    <span>{lab.note}</span>
                    <small>makes {lab.output}</small>
                  </span>
                  <span className="lab-home__instrument-open" aria-hidden="true">open →</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
