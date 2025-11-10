'use client'

import { createLogger } from '@/lib/logs/console/logger'
import { useKnowledgeStore } from '@/stores/knowledge/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkspaceCleanup')

/**
 * Unified workspace cleanup hook
 *
 * Provides a centralized cleanup function that clears all workspace-scoped
 * cached data when switching workspaces or unmounting.
 *
 * This ensures no stale data persists across workspace boundaries.
 *
 * @returns cleanup function that accepts the workspaceId being cleaned up
 *
 * @example
 * ```tsx
 * const cleanupWorkspace = useWorkspaceCleanup()
 *
 * useEffect(() => {
 *   return () => {
 *     if (previousWorkspaceId && previousWorkspaceId !== currentWorkspaceId) {
 *       cleanupWorkspace(previousWorkspaceId)
 *     }
 *   }
 * }, [workspaceId])
 * ```
 */
export function useWorkspaceCleanup() {
  const { clearKnowledgeBasesList } = useKnowledgeStore()
  const { clearWorkspaceEnvCache } = useEnvironmentStore()
  const { clearWorkflowsCache } = useWorkflowRegistry()

  /**
   * Clear all workspace-scoped caches
   * @param workspaceId - The workspace being cleaned up (for logging and env cache clearing)
   */
  const cleanupWorkspace = (workspaceId: string) => {
    logger.info(`Cleaning up workspace caches: ${workspaceId}`)

    // Clear knowledge bases list (global - clears all)
    clearKnowledgeBasesList()

    // Clear environment variables cache for this specific workspace
    clearWorkspaceEnvCache(workspaceId)

    // Clear workflows cache (global - clears all)
    clearWorkflowsCache()

    logger.info(`Workspace cleanup complete: ${workspaceId}`)
  }

  return cleanupWorkspace
}
