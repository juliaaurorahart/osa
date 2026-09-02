import { useCallback, useEffect, useState } from 'react'
import {
  isCanvasLabRequested,
  isDedicatedLabLocation,
  readAssemblyPeopleDisplay,
  readAssemblyPeopleThreshold,
  readOsaTheme,
  readWorkspaceView,
  setCanvasLabRequested,
  writeAssemblyPeopleDisplay,
  writeAssemblyPeopleThreshold,
  writeOsaTheme,
  writeWorkspaceView,
  type AssemblyPeopleDisplay,
  type OsaTheme,
  type WorkspaceView,
} from './browserSession'

/** Owns the device-level presentation of assigned people in Assembly tables. */
export function useAssemblyPeopleDisplay() {
  const [assemblyPeopleDisplay, setAssemblyPeopleDisplay] = useState<AssemblyPeopleDisplay>(
    readAssemblyPeopleDisplay,
  )

  useEffect(() => writeAssemblyPeopleDisplay(assemblyPeopleDisplay), [assemblyPeopleDisplay])

  return { assemblyPeopleDisplay, setAssemblyPeopleDisplay }
}

/** Owns how many assigned people remain individually visible before collapsing to a count. */
export function useAssemblyPeopleThreshold() {
  const [assemblyPeopleThreshold, setAssemblyPeopleThreshold] = useState(
    readAssemblyPeopleThreshold,
  )

  useEffect(
    () => writeAssemblyPeopleThreshold(assemblyPeopleThreshold),
    [assemblyPeopleThreshold],
  )

  return { assemblyPeopleThreshold, setAssemblyPeopleThreshold }
}

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
    const syncCanvasLab = () => {
      if (!isCanvasLabRequested() && !window.dispatchEvent(new window.Event('osa:lab-before-leave', { cancelable: true }))) {
        // Keep the destination entry intact, so Back works after editing closes.
        setCanvasLabRequested(true, 'push')
        return
      }
      setCanvasLabVisible(isCanvasLabRequested())
    }
    window.addEventListener('popstate', syncCanvasLab)
    return () => window.removeEventListener('popstate', syncCanvasLab)
  }, [])

  const openCanvasLab = useCallback(() => {
    setCanvasLabRequested(true, 'push')
    setCanvasLabVisible(true)
  }, [])

  const closeCanvasLab = useCallback(() => {
    if (!window.dispatchEvent(new window.Event('osa:lab-before-leave', { cancelable: true }))) return
    setCanvasLabRequested(false, 'replace')
    // On the dedicated host, leave the Lab on-screen until navigation to OSA
    // completes; briefly rendering another workspace would suggest data moved.
    if (!isDedicatedLabLocation()) setCanvasLabVisible(false)
  }, [])

  return { canvasLabVisible, openCanvasLab, closeCanvasLab }
}
