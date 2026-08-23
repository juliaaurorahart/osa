import { useState, type FormEvent } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import { nodeTitle, projectIdsForTask } from '../graph/taskProject'
import type { TextFlowNode } from '../graph/textNode'

export type TaskViewMode = 'day' | 'all' | 'no-day'

type SharedTasksViewProps = {
  tasks: TextFlowNode[]
  projects: TextFlowNode[]
  edges: GraphEdge[]
  /** Day is required for both the full view and the compact Today view. */
  day: string
  onCreateTask: (text: string, day: string | null) => void
  onTaskTextChange: (taskId: string, text: string) => void
  onTaskDayChange: (taskId: string, day: string | null) => void
  onTaskCompletionChange: (taskId: string, complete: boolean) => void
  onLinkProject: (taskId: string, projectId: string) => void
  onUnlinkProject: (taskId: string, projectId: string) => void
  onOpenNode: (nodeId: string) => void
  onViewProject: (projectId: string) => void
}

/** The standalone Actions tool keeps its filter controls. */
type FullTasksViewProps = SharedTasksViewProps & {
  compact?: false
  mode: TaskViewMode
  onModeChange: (mode: TaskViewMode) => void
  onDayChange: (day: string) => void
}

/** The ProjectsView owns the heading and sidebar when showing Today's actions. */
type CompactTasksViewProps = SharedTasksViewProps & {
  compact: true
}

type TasksViewProps = FullTasksViewProps | CompactTasksViewProps

export function TasksView(props: TasksViewProps) {
  const {
    tasks,
    projects,
    edges,
    day,
    onCreateTask,
    onTaskTextChange,
    onTaskDayChange,
    onTaskCompletionChange,
    onLinkProject,
    onUnlinkProject,
    onOpenNode,
    onViewProject,
  } = props
  const isCompact = props.compact === true
  const mode: TaskViewMode = props.compact === true ? 'day' : props.mode
  const [draft, setDraft] = useState('')
  const visibleTasks = tasks.filter((task) => {
    const taskDay = task.data.task?.day ?? null
    if (mode === 'day') return taskDay === day
    if (mode === 'no-day') return taskDay === null
    return true
  })

  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onCreateTask(text, mode === 'day' ? day : null)
    setDraft('')
  }

  return (
    <section
      className={isCompact ? 'tasks-view tasks-view--compact' : 'work-view tasks-view'}
      aria-label={isCompact ? `Actions for ${day}` : undefined}
      aria-labelledby={isCompact ? undefined : 'tasks-view-title'}
    >
      {!isCompact ? (
        <>
          <header className="work-view__header">
            <div>
              <p className="work-view__eyebrow">Tool</p>
              <h1 id="tasks-view-title">Actions</h1>
            </div>
            <span>{visibleTasks.length} shown · {tasks.length} total</span>
          </header>

          <div className="task-filter" aria-label="Choose which actions to show">
            <button
              className={mode === 'day' ? 'is-active' : undefined}
              type="button"
              onClick={() => props.onModeChange('day')}
            >
              Day
            </button>
            <input
              aria-label="Day shown"
              type="date"
              value={day}
              onChange={(event) => {
                if (event.target.value) {
                  props.onDayChange(event.target.value)
                  props.onModeChange('day')
                } else {
                  props.onModeChange('no-day')
                }
              }}
            />
            <button
              className={mode === 'no-day' ? 'is-active' : undefined}
              type="button"
              onClick={() => props.onModeChange('no-day')}
            >
              No date
            </button>
            <button
              className={mode === 'all' ? 'is-active' : undefined}
              type="button"
              onClick={() => props.onModeChange('all')}
            >
              All
            </button>
          </div>
        </>
      ) : null}

      <form className="work-view__create" onSubmit={submitTask}>
        <input
          aria-label="New action"
          placeholder={mode === 'day' ? `Add to ${day}` : 'Add action'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Add action</button>
      </form>

      {visibleTasks.length === 0 ? (
        <p className="work-view__empty">
          {isCompact ? 'No actions are scheduled for today.' : 'No actions are placed here.'}
        </p>
      ) : (
        <ul className="object-list task-list">
          {visibleTasks.map((task) => {
            const taskProjectIds = projectIdsForTask(task.id, edges)
            const linkedProjects = taskProjectIds
              .map((projectId) => projects.find((project) => project.id === projectId))
              .filter((project): project is TextFlowNode => Boolean(project))
            const availableProjects = projects.filter((project) => !taskProjectIds.includes(project.id))
            const isComplete = Boolean(task.data.task?.completedAt)
            const taskName = task.data.name.trim()
            const showTaskName = taskName !== '' && taskName !== task.data.text.trim()

            return (
              <li className="task-row" key={task.id}>
                <input
                  className="task-row__check"
                  type="checkbox"
                  aria-label={`Mark ${nodeTitle(task)} complete`}
                  checked={isComplete}
                  onChange={(event) => onTaskCompletionChange(task.id, event.target.checked)}
                />
                <div className="task-row__content">
                  <textarea
                    className="task-row__text"
                    aria-label="Action"
                    rows={2}
                    placeholder="Write the action"
                    value={task.data.text}
                    onChange={(event) => onTaskTextChange(task.id, event.target.value)}
                  />
                  <div className="task-row__facts">
                    {showTaskName ? <span className="task-row__name">{taskName}</span> : null}
                    <label>
                      <span>On</span>
                      <input
                        type="date"
                        aria-label={`${nodeTitle(task)} date`}
                        value={task.data.task?.day ?? ''}
                        onChange={(event) => onTaskDayChange(task.id, event.target.value || null)}
                      />
                    </label>
                    <button className="text-action" type="button" onClick={() => onOpenNode(task.id)}>
                      Space
                    </button>
                  </div>
                  <div className="context-links" aria-label="Action projects">
                    {linkedProjects.map((project) => (
                      <span className="context-link" key={project.id}>
                        <button type="button" onClick={() => onViewProject(project.id)}>
                          {nodeTitle(project)}
                        </button>
                        <button
                          type="button"
                          aria-label={`Unlink ${nodeTitle(project)}`}
                          onClick={() => onUnlinkProject(task.id, project.id)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {availableProjects.length > 0 ? (
                      <select
                        aria-label={`Link ${nodeTitle(task)} to a project`}
                        value=""
                        onChange={(event) => {
                          if (event.target.value) onLinkProject(task.id, event.target.value)
                        }}
                      >
                        <option value="">Link project…</option>
                        {availableProjects.map((project) => (
                          <option key={project.id} value={project.id}>{nodeTitle(project)}</option>
                        ))}
                      </select>
                    ) : projects.length === 0 ? (
                      <span className="context-links__empty">No projects yet</span>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
