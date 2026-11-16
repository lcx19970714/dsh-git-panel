/** Pure workspace selection rules for the session-independent Git dock. */
export const DOCK_WORKSPACE_STORAGE_KEY = 'dsh-git-panel:dock-workspace:v1'

/** The main view retains its active session, even while a main panel covers it. */
export function mainViewSessionId(state) {
  const sessions = state?.byId
  if (sessions === null || typeof sessions !== 'object') return null
  for (const session of Object.values(sessions)) {
    if (session?.retainedBy?.mainView > 0 && typeof session.id === 'string') return session.id
  }
  return null
}

/** Never infer the first workspace: absence of a match means an explicit empty selection. */
export function initialDockWorkspaceId(items, sessionId, rememberedId) {
  if (sessionId !== null) {
    const current = items.find((workspace) => workspace.sessionIds.includes(sessionId))
    if (current !== undefined) return current.workspaceId
  }
  return items.some((workspace) => workspace.workspaceId === rememberedId) ? rememberedId : null
}
