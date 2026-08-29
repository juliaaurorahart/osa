import { LAB_GROUPS } from './labCatalog'
import type { ReactNode } from 'react'
import type { LabTheme } from './labTypes'
import './LabSettings.css'

type LabSettingsProps = {
  theme: LabTheme
  noteCount: number
  artifactCount: number
  storageMessage: string
  onToggleTheme: () => void
  workspaceSettingsMenu?: ReactNode
}

/** Mirrors shared controls without creating a second settings source of truth. */
export function LabSettings({
  theme,
  noteCount,
  artifactCount,
  storageMessage,
  onToggleTheme,
  workspaceSettingsMenu,
}: LabSettingsProps) {
  return (
    <section className="lab-settings" aria-labelledby="lab-settings-title">
      <header className="lab-settings__header">
        <p>Facility controls</p>
        <h2 id="lab-settings-title">Lab settings</h2>
        <span>Shared preferences are mirrored. Instrument controls remain available inside each workbench.</span>
      </header>

      <div className="lab-settings__grid">
        <section className="lab-settings__panel" aria-labelledby="lab-settings-appearance">
          <header>
            <span aria-hidden="true">◐</span>
            <div>
              <h3 id="lab-settings-appearance">Appearance</h3>
              <p>Uses the same theme preference as the rest of OSA.</p>
            </div>
          </header>
          <div className="lab-settings__row">
            <span>Current theme</span>
            <strong>{theme}</strong>
            <button type="button" onClick={onToggleTheme}>
              Use {theme === 'dark' ? 'light' : 'dark'} theme
            </button>
          </div>
        </section>

        <section className="lab-settings__panel" aria-labelledby="lab-settings-storage">
          <header>
            <span aria-hidden="true">▤</span>
            <div>
              <h3 id="lab-settings-storage">Notebook &amp; files</h3>
              <p>Working storage for Lab material on this device.</p>
            </div>
          </header>
          <dl className="lab-settings__facts">
            <div><dt>Notes</dt><dd>{noteCount}</dd></div>
            <div><dt>Saved files</dt><dd>{artifactCount}</dd></div>
            <div><dt>Status</dt><dd>{storageMessage}</dd></div>
            <div><dt>OSA boards</dt><dd>separate and untouched</dd></div>
          </dl>
          <p className="lab-settings__note">
            Local Lab storage is working space, not a backup. Keep downloadable source files for important experiments.
          </p>
        </section>

        <section className="lab-settings__panel" aria-labelledby="lab-settings-workspace">
          <header>
            <span aria-hidden="true">OSA</span>
            <div>
              <h3 id="lab-settings-workspace">OSA workspace</h3>
              <p>The existing board, people, sharing, cloud, and backup controls.</p>
            </div>
          </header>
          <div className="lab-settings__workspace-mirror">
            <p>This opens the same settings and actions available from the OSA menu. Nothing is copied into Lab state.</p>
            {workspaceSettingsMenu ?? <span>Return to OSA to open workspace settings.</span>}
          </div>
        </section>

        <section className="lab-settings__panel" aria-labelledby="lab-settings-instruments">
          <header>
            <span aria-hidden="true">⌁</span>
            <div>
              <h3 id="lab-settings-instruments">Instrument controls</h3>
              <p>Tool-specific controls remain mirrored inside each workbench.</p>
            </div>
          </header>
          <div className="lab-settings__workspace-mirror">
            <p>Keeping those controls beside their canvas makes experimentation faster. This page remains the inventory and shared-settings home.</p>
          </div>
        </section>
      </div>

      <section className="lab-settings__modules" aria-labelledby="lab-settings-modules">
        <header>
          <div>
            <p>Instrument inventory</p>
            <h3 id="lab-settings-modules">Lab modules</h3>
          </div>
          <span>{LAB_GROUPS.reduce((count, group) => count + group.labs.length, 0)} available</span>
        </header>
        <div className="lab-settings__module-groups">
          {LAB_GROUPS.map((group) => (
            <section key={group.name}>
              <h4>{group.name}</h4>
              <ul>
                {group.labs.map((lab) => (
                  <li key={lab.id}>
                    <span aria-hidden="true">{lab.glyph}</span>
                    <span><strong>{lab.name}</strong><small>{lab.output}</small></span>
                    <em>ready</em>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </section>
  )
}
