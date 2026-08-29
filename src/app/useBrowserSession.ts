import { useCallback, useEffect, useState } from 'react'
import {
  isCanvasLabRequested,
  readOsaTheme,
  readWorkspaceView,
  setCanvasLabRequested,
  writeOsaTheme,
  writeWorkspaceView,
  type OsaTheme,
  type WorkspaceView,
} from './browserSession'

/** Owns the browser-only theme preference; board data never depends on it. */
export function useOsaTheme() {
  const [theme, setTheme] = useState<OsaTheme>(readOsaTheme)

  useEffect(() => writeOsaTheme(theme), [theme])

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, toggleTheme }
}

/** Owns the last browser workspace while allowing public links to force Assembly. */
export function useWorkspaceView(forceAssembly: boolean) {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => (
    forceAssembly ? 'assembly' : readWorkspaceView()
  ))

  useEffect(() => writeWorkspaceView(workspaceView), [workspaceView])

  return { workspaceView, setWorkspaceView }
}

/** Keeps the experimental Canvas Lab query flag synchronized with Back/Forward. */
export function useCanvasLabLocation() {
  const [canvasLabVisible, setCanvasLabVisible] = useState(isCanvasLabRequested)

  useEffect(() => {
    const syncCanvasLab = () => setCanvasLabVisible(isCanvasLabRequested())
    window.addEventListener('popstate', syncCanvasLab)
    return () => window.removeEventListener('popstate', syncCanvasLab)
  }, [])

  const openCanvasLab = useCallback(() => {
    setCanvasLabRequested(true, 'push')
    setCanvasLabVisible(true)
  }, [])

  const closeCanvasLab = useCallback(() => {
    setCanvasLabRequested(false, 'replace')
    setCanvasLabVisible(false)
  }, [])

  return { canvasLabVisible, openCanvasLab, closeCanvasLab }
}
