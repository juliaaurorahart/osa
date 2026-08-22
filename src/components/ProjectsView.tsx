import { useState, type FormEvent } from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import { nodeTitle, taskIdsForProject } from '../graph/taskProject'
import type { TextFlowNode } from '../graph/textNode'

type ProjectsViewProps = {
  projects: TextFlowNode[]
  tasks: TextFlowNode[]
  edges: GraphEdge[]
  selectedProjectId: string | null
  onSelectProject: (projectId: string) => void
  onCreateProject: (title: string) => void
  onCreateTask: (projectId: string, text: string, day: string | null) => void
  onProjectTitleChange: (projectId: string, title: string) => void
  onProjectTextChange: (projectId: string, text: string) => void
  onTaskTextChange: (taskId: string, text: string) => void
  onTaskDayChange: (taskId: string, day: string | null) => void
  onTaskCompletionChange: (taskId: string, complete: boolean) => void
  onLinkTask: (projectId: string, taskId: string) => void
  onUnlinkTask: (projectId: string, taskId: string) => void
  onOpenNode: (nodeId: string) => void
}

export function ProjectsView({
  projects,
  tasks,
  edges,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onCreateTask,
  onProjectTitleChange,
  onProjectTextChange,
  onTaskTextChange,
  onTaskDayChange,
  onTaskCompletionChange,
  onLinkTask,
  onUnlinkTask,
  onOpenNode,
}: ProjectsViewProps) {
  const [projectDraft, setProjectDraft] = useState('')
  const [taskDraft, setTaskDraft] = useState('')
  const [taskDay, setTaskDay] = useState('')
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const linkedTaskIds = selectedProject ? taskIdsForProject(selectedProject.id, edges) : []
  const linkedTasks = linkedTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TextFlowNode => Boolean(task))
  const availableTasks = tasks.filter((task) => !linkedTaskIds.includes(task.id))

  const submitProject = (event: FormEvent) => {
    event.preventDefault()
    const title = projectDraft.trim()
    if (!title) return
    onCreateProject(title)
    setProjectDraft('')
  }

  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    const text = taskDraft.trim()
    if (!selectedProject || !text) return
    onCreateTask(selectedProject.id, text, taskDay || null)
    setTaskDraft('')
  }

  return (
    <section className="work-view projects-view" aria-labelledby="projects-view-title">
      <header className="work-view__header">
        <div>
          <p className="work-view__eyebrow">Tool</p>
          <h1 id="projects-view-title">Projects</h1>
        </div>
        <span>{projects.length} total</span>
      </header>

      <form className="work-view__create" onSubmit={submitProject}>
        <input
          aria-label="New project"
          placeholder="Create a project"
          value={projectDraft}
          onChange={(event) => setProjectDraft(event.target.value)}
        />
        <button type="submit">Add project</button>
      </form>

      {projects.length === 0 ? (
        <p className="work-view__empty">No projects exist yet.</p>
      ) : (
        <div className="project-workspace">
          <nav className="project-list" aria-label="Projects">
            {projects.map((project) => {
              const projectTasks = taskIdsForProject(project.id, edges)
              return (
                <button
                  className={project.id === selectedProject?.id ? 'is-active' : undefined}
                  type="button"
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                >
                  <span>{nodeTitle(project)}</span>
                  <small>{projectTasks.length} task{projectTasks.length === 1 ? '' : 's'}</small>
                </button>
              )
            })}
          </nav>

          {selectedProject ? (
            <article className="project-detail">
              <div className="project-detail__heading">
                <input
                  aria-label="Project name"
                  value={selectedProject.data.name}
                  onChange={(event) => onProjectTitleChange(selectedProject.id, event.target.value)}
                />
                <button className="text-action" type="button" onClick={() => onOpenNode(selectedProject.id)}>
                  Node Space
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
                <h2>Tasks</h2>
                <span>
                  {linkedTasks.filter((task) => task.data.task?.completedAt).length}/{linkedTasks.length} complete
                </span>
              </div>

              <form className="project-task-create" onSubmit={submitTask}>
                <input
                  aria-label="New project task"
                  placeholder="Add a task to this project"
                  value={taskDraft}
                  onChange={(event) => setTaskDraft(event.target.value)}
                />
                <input
                  aria-label="New task date"
                  type="date"
                  value={taskDay}
                  onChange={(event) => setTaskDay(event.target.value)}
                />
                <button type="submit">Add</button>
              </form>

              {availableTasks.length > 0 ? (
                <label className="project-link-existing">
                  <span>Link existing</span>
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) onLinkTask(selectedProject.id, event.target.value)
                    }}
                  >
                    <option value="">Choose task…</option>
                    {availableTasks.map((task) => (
                      <option key={task.id} value={task.id}>{nodeTitle(task)}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {linkedTasks.length === 0 ? (
                <p className="work-view__empty">No tasks are linked to this project.</p>
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
                          aria-label="Task"
                          rows={2}
                          placeholder="Write the task"
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
                        Node Space
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
          ) : null}
        </div>
      )}
    </section>
  )
}
