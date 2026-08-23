import { useState, type FormEvent } from 'react'
import { TasksView } from './TasksView'
import type { GraphEdge } from '../graph/graphEdge'
import { nodeTitle, taskIdsForProject } from '../graph/taskProject'
import type { TextFlowNode } from '../graph/textNode'

type ProjectsViewProps = {
  projects: TextFlowNode[]
  tasks: TextFlowNode[]
  edges: GraphEdge[]
  selectedProjectId: string | null
  /** The host supplies its local calendar day, so Today is deterministic. */
  today: string
  onSelectProject: (projectId: string) => void
  /** Creates an unlinked action for the compact Today list. */
  onCreateAction: (text: string, day: string | null) => void
  /** Creates an action and immediately links it to the open project. */
  onCreateTask: (projectId: string, text: string, day: string | null) => void
  onProjectTitleChange: (projectId: string, title: string) => void
  onProjectTextChange: (projectId: string, text: string) => void
  onTaskTextChange: (taskId: string, text: string) => void
  onTaskDayChange: (taskId: string, day: string | null) => void
  onTaskCompletionChange: (taskId: string, complete: boolean) => void
  /** These keep Today task rows able to show/link their project context. */
  onLinkProject: (taskId: string, projectId: string) => void
  onUnlinkProject: (taskId: string, projectId: string) => void
  onLinkTask: (projectId: string, taskId: string) => void
  onUnlinkTask: (projectId: string, taskId: string) => void
  onOpenNode: (nodeId: string) => void
}

export function ProjectsView({
  projects,
  tasks,
  edges,
  selectedProjectId,
  today,
  onSelectProject,
  onCreateAction,
  onCreateTask,
  onProjectTitleChange,
  onProjectTextChange,
  onTaskTextChange,
  onTaskDayChange,
  onTaskCompletionChange,
  onLinkProject,
  onUnlinkProject,
  onLinkTask,
  onUnlinkTask,
  onOpenNode,
}: ProjectsViewProps) {
  // Opening Actions starts with the first project-level context (the Shako
  // assembly on the starter board); Today remains a compact list at bottom.
  const [showToday, setShowToday] = useState(false)
  const [taskDraft, setTaskDraft] = useState('')
  const [taskDay, setTaskDay] = useState('')
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const linkedTaskIds = selectedProject ? taskIdsForProject(selectedProject.id, edges) : []
  const linkedTasks = linkedTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TextFlowNode => Boolean(task))
  const availableTasks = tasks.filter((task) => !linkedTaskIds.includes(task.id))
  const todayTaskCount = tasks.filter((task) => task.data.task?.day === today).length

  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    const text = taskDraft.trim()
    if (!selectedProject || !text) return
    onCreateTask(selectedProject.id, text, taskDay || null)
    setTaskDraft('')
  }

  return (
    <section className="work-view projects-view" aria-labelledby="actions-view-title">
      <header className="work-view__header">
        <div>
          <h1 id="actions-view-title">Actions</h1>
        </div>
        <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
      </header>

      <div className="work-view__divider" />

      <div className="project-workspace">
        <nav className="project-list" aria-label="Actions and projects">
          {projects.map((project) => {
            const projectTasks = taskIdsForProject(project.id, edges)
            return (
              <button
                className={!showToday && project.id === selectedProject?.id ? 'is-active' : undefined}
                type="button"
                key={project.id}
                onClick={() => {
                  setShowToday(false)
                  onSelectProject(project.id)
                }}
              >
                <span>{nodeTitle(project)}</span>
                <small>{projectTasks.length} action{projectTasks.length === 1 ? '' : 's'}</small>
              </button>
            )
          })}
          <div className="project-list__divider" />
          <button
            className={`project-list__today${showToday ? ' is-active' : ''}`}
            type="button"
            aria-current={showToday ? 'page' : undefined}
            onClick={() => setShowToday(true)}
          >
            <span>Today</span>
            <small>{todayTaskCount} action{todayTaskCount === 1 ? '' : 's'}</small>
          </button>
        </nav>

        {showToday ? (
          <TasksView
            compact
            tasks={tasks}
            projects={projects}
            edges={edges}
            day={today}
            onCreateTask={onCreateAction}
            onTaskTextChange={onTaskTextChange}
            onTaskDayChange={onTaskDayChange}
            onTaskCompletionChange={onTaskCompletionChange}
            onLinkProject={onLinkProject}
            onUnlinkProject={onUnlinkProject}
            onOpenNode={onOpenNode}
            onViewProject={(projectId) => {
              setShowToday(false)
              onSelectProject(projectId)
            }}
          />
        ) : selectedProject ? (
          <article className="project-detail">
            <div className="project-detail__heading">
              <input
                aria-label="Project name"
                value={selectedProject.data.name}
                onChange={(event) => onProjectTitleChange(selectedProject.id, event.target.value)}
              />
              <button className="text-action" type="button" onClick={() => onOpenNode(selectedProject.id)}>
                Space
              </button>
            </div>
            <textarea
              className="project-detail__notes"
              aria-label={`${nodeTitle(selectedProject)} notes`}
              placeholder="Project notes"
              value={selectedProject.data.text}
              onChange={(event) => onProjectTextChange(selectedProject.id, event.target.value)}
            />

            <div className="project-detail__task-heading">
              <h2>Actions</h2>
              <span>
                {linkedTasks.filter((task) => task.data.task?.completedAt).length}/{linkedTasks.length} complete
              </span>
            </div>

            <form className="project-task-create" onSubmit={submitTask}>
              <input
                aria-label="New project action"
                placeholder="Add an action to this project"
                value={taskDraft}
                onChange={(event) => setTaskDraft(event.target.value)}
              />
              <input
                aria-label="New action date"
                type="date"
                value={taskDay}
                onChange={(event) => setTaskDay(event.target.value)}
              />
              <button type="submit">Add</button>
            </form>

            {availableTasks.length > 0 ? (
              <label className="project-link-existing">
                <span>Link existing action</span>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onLinkTask(selectedProject.id, event.target.value)
                  }}
                >
                  <option value="">Choose action…</option>
                  {availableTasks.map((task) => (
                    <option key={task.id} value={task.id}>{nodeTitle(task)}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {linkedTasks.length === 0 ? (
              <p className="work-view__empty">No actions are linked to this project.</p>
            ) : (
              <ul className="object-list project-task-list">
                {linkedTasks.map((task) => (
                  <li className="project-task-row" key={task.id}>
                    <input
                      type="checkbox"
                      aria-label={`Mark ${nodeTitle(task)} complete`}
                      checked={Boolean(task.data.task?.completedAt)}
                      onChange={(event) => onTaskCompletionChange(task.id, event.target.checked)}
                    />
                    <div className="project-task-row__content">
                      <textarea
                        className="project-task-row__text"
                        aria-label="Action"
                        rows={2}
                        placeholder="Write the action"
                        value={task.data.text}
                        onChange={(event) => onTaskTextChange(task.id, event.target.value)}
                      />
                      {task.data.name.trim() && task.data.name.trim() !== task.data.text.trim() ? (
                        <small>{task.data.name.trim()}</small>
                      ) : null}
                    </div>
                    <input
                      type="date"
                      aria-label={`${nodeTitle(task)} date`}
                      value={task.data.task?.day ?? ''}
                      onChange={(event) => onTaskDayChange(task.id, event.target.value || null)}
                    />
                    <button className="text-action" type="button" onClick={() => onOpenNode(task.id)}>
                      Space
                    </button>
                    <button
                      className="text-action"
                      type="button"
                      aria-label={`Unlink ${nodeTitle(task)} from ${nodeTitle(selectedProject)}`}
                      onClick={() => onUnlinkTask(selectedProject.id, task.id)}
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ) : (
          <p className="work-view__empty">No projects exist yet. Today can still hold your actions.</p>
        )}
      </div>
    </section>
  )
}
