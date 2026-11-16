/** Session-independent main-panel shell for the Git dock. */
import { h, useEffect, useRef, useState, getPluginContext } from '../platform.js'
import { DOCK_WORKSPACE_STORAGE_KEY, initialDockWorkspaceId, mainViewSessionId } from '../dock-workspace.js'
import { Panel } from './Panel.js'
import { PanelRenderBoundary } from './GitPanelSurface.js'

const workspaceSnapshot = (snapshot) => snapshot
const selectedMainSession = (state) => mainViewSessionId(state)

function readRememberedWorkspace() {
  try {
    const value = localStorage.getItem(DOCK_WORKSPACE_STORAGE_KEY)
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

function rememberWorkspace(workspaceId) {
  try {
    if (workspaceId === null) localStorage.removeItem(DOCK_WORKSPACE_STORAGE_KEY)
    else localStorage.setItem(DOCK_WORKSPACE_STORAGE_KEY, workspaceId)
  } catch {
    // A blocked browser preference store must not disable workspace navigation.
  }
}

function workspaceLabel(workspace) {
  const title = typeof workspace.title === 'string' ? workspace.title.trim() : ''
  return title === '' ? workspace.path : title + ' — ' + workspace.path
}

function errorMessage(error) {
  if (error === null || error === undefined) return ''
  if (typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * Main root slot props supply useWorkspaces(selector), useSessions(selector), and t.
 * No sessionId is forwarded: the selected workspace path is the Panel's only binding.
 */
export function GitDockSurface(props) {
  const { useWorkspaces, useSessions, t } = props
  const snapshot = useWorkspaces(workspaceSnapshot)
  const currentSessionId = useSessions(selectedMainSession)
  const rememberedRef = useRef(undefined)
  if (rememberedRef.current === undefined) rememberedRef.current = readRememberedWorkspace()

  // One visit owns this selection. A delayed initial Session may supply the default;
  // a manual choice always wins, and later Session changes never replace it.
  const [selection, setSelection] = useState({ initialized: false, workspaceId: null })
  const manualSelectionRef = useRef(false)
  const initialSessionRef = useRef(null)
  const items = snapshot.items
  const pending = snapshot.phase === 'pending'
  const failed = snapshot.error !== null && snapshot.error !== undefined

  useEffect(() => {
    if (manualSelectionRef.current || pending || failed) return
    // 工作区快照可能先于会话恢复到达；首次有效 mainView 稍后到达时仍应优先采用。
    if (selection.initialized && (currentSessionId === null || initialSessionRef.current !== null)) return
    const workspaceId = initialDockWorkspaceId(items, currentSessionId, rememberedRef.current)
    if (currentSessionId !== null && items.some((item) => item.sessionIds.includes(currentSessionId))) {
      initialSessionRef.current = currentSessionId
    }
    setSelection({ initialized: true, workspaceId })
    rememberWorkspace(workspaceId)
  }, [selection.initialized, pending, failed, items, currentSessionId])

  const workspace = items.find((item) => item.workspaceId === selection.workspaceId) ?? null
  const cwd = workspace === null ? null : workspace.path
  const value = workspace === null ? '' : workspace.workspaceId
  const ctx = getPluginContext()

  function changeWorkspace(event) {
    manualSelectionRef.current = true
    const id = event.currentTarget.value
    const next = items.find((item) => item.workspaceId === id)
    const workspaceId = next === undefined ? null : next.workspaceId
    setSelection({ initialized: true, workspaceId })
    rememberWorkspace(workspaceId)
  }

  const emptyWorkspace = {
    title: t('dock.emptyTitle'),
    description: t('dock.emptyDescription')
  }
  const notice = pending
    ? t('dock.loading')
    : failed
      ? [t('dock.loadFailed'), errorMessage(snapshot.error)].filter(Boolean).join('：')
      : items.length === 0 ? t('dock.noWorkspaces') : null

  return h('section', { className: 'dgp-dock-root', 'data-dgp-dock-workspace': value },
    h('header', { className: 'dgp-dock-header' },
      h('h1', { className: 'dgp-dock-title' }, t('dock.title')),
      h('label', { className: 'dgp-dock-workspace' },
        h('span', { className: 'dgp-dock-label' }, t('dock.workspace')),
        h('select', {
          className: 'dgp-dock-select',
          value,
          disabled: pending || failed,
          title: workspace === null ? t('dock.noSelection') : workspaceLabel(workspace),
          onChange: changeWorkspace
        },
        h('option', { value: '' }, t('dock.noSelection')),
        items.map((item) => h('option', { key: item.workspaceId, value: item.workspaceId }, workspaceLabel(item))))),
      h('button', {
        type: 'button',
        className: 'dgp-dock-back',
        onClick: () => ctx.layout.selectPanel(null)
      }, t('dock.backToSession'))),
    notice === null ? null : h('div', {
      className: 'dgp-dock-notice',
      role: failed ? 'alert' : 'status',
      'data-tone': failed ? 'error' : 'info'
    }, notice),
    h('div', { className: 'dgp-dock-body' },
      h(PanelRenderBoundary, { key: value, t },
        h(Panel, { key: value, cwd, emptyWorkspace, t }))))
}
