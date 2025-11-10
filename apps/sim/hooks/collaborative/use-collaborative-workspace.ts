'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useSocket } from '@/contexts/socket-context'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useFolderStore } from '@/stores/folders/store'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CollaborativeWorkspace')

/**
 * Factory function to create workspace resource update handlers
 */
function createResourceUpdateHandler(
  workspaceId: string | undefined,
  resourceName: string,
  fetchFunction: (workspaceId: string) => Promise<unknown>,
  isApplyingRef: React.MutableRefObject<boolean>,
  clearCacheFunction?: ((workspaceId: string) => void) | (() => void)
) {
  return (data: WorkspaceResourceUpdate) => {
    if (!workspaceId || data.workspaceId !== workspaceId || isApplyingRef.current) return

    logger.info(`${resourceName} ${data.operation}d in workspace ${workspaceId}, refetching...`)

    isApplyingRef.current = true

    // Clear cache before fetching to ensure fresh data
    if (clearCacheFunction) {
      // Check if function accepts workspace parameter
      if (clearCacheFunction.length === 1) {
        ;(clearCacheFunction as (workspaceId: string) => void)(workspaceId)
      } else {
        ;(clearCacheFunction as () => void)()
      }
    }

    fetchFunction(workspaceId)
      .catch((error) => {
        logger.error(`Failed to reload ${resourceName} after socket update:`, error)
      })
      .finally(() => {
        isApplyingRef.current = false
      })
  }
}

/**
 * Workspace resource update event data
 */
interface WorkspaceResourceUpdate {
  workspaceId: string
  resourceType: 'env' | 'tools' | 'folders' | 'mcp' | 'workflows'
  operation: 'create' | 'update' | 'delete'
  data: any
  timestamp: number
}

/**
 * Hook to manage real-time collaboration for workspace-scoped resources.
 *
 * Listens for socket events and automatically refetches data when other users
 * make changes to environment variables, custom tools, folders, MCP servers,
 * or workflows in the same workspace.
 *
 * @param workspaceId - The workspace to listen for updates. If undefined, hook is inactive.
 *
 * @example
 * ```tsx
 * function WorkspaceInitializer({ workspaceId }: { workspaceId: string }) {
 *   useCollaborativeWorkspace(workspaceId)
 *   // Now all workspace resources automatically sync in real-time
 * }
 * ```
 */
export function useCollaborativeWorkspace(workspaceId: string | undefined): void {
  const {
    isConnected,
    joinWorkspace,
    leaveWorkspace,
    onWorkspaceEnvUpdated,
    onWorkspaceToolCreated,
    onWorkspaceToolUpdated,
    onWorkspaceToolDeleted,
    onWorkspaceFolderCreated,
    onWorkspaceFolderUpdated,
    onWorkspaceFolderDeleted,
    onWorkspaceMcpUpdated,
    onWorkspaceWorkflowCreated,
    onWorkspaceWorkflowUpdated,
    onWorkspaceWorkflowDeleted,
  } = useSocket()

  // Store actions
  const { loadWorkspaceEnvironment, clearWorkspaceEnvCache } = useEnvironmentStore()
  const { fetchTools } = useCustomToolsStore()
  const { fetchFolders } = useFolderStore()
  const { fetchServers } = useMcpServersStore()
  const {
    loadWorkflows,
    clearWorkflowsCache,
    addWorkflow,
    updateWorkflowInRegistry,
    removeWorkflowFromRegistry,
  } = useWorkflowRegistry()

  // Prevent recursive updates when applying remote changes
  const isApplyingRemoteChange = useRef(false)

  // Join workspace room on mount, leave on unmount
  useEffect(() => {
    if (!workspaceId || !isConnected) return

    logger.info(`Joining workspace room: ${workspaceId}`)
    joinWorkspace(workspaceId)

    return () => {
      logger.info(`Leaving workspace room: ${workspaceId}`)
      leaveWorkspace(workspaceId)
    }
  }, [workspaceId, isConnected, joinWorkspace, leaveWorkspace])

  // Environment variables
  useEffect(() => {
    if (!workspaceId) return

    const handleEnvUpdate = createResourceUpdateHandler(
      workspaceId,
      'environment variables',
      loadWorkspaceEnvironment,
      isApplyingRemoteChange,
      clearWorkspaceEnvCache
    )

    onWorkspaceEnvUpdated(handleEnvUpdate)
  }, [workspaceId, onWorkspaceEnvUpdated, loadWorkspaceEnvironment, clearWorkspaceEnvCache])

  // Custom tools
  useEffect(() => {
    if (!workspaceId) return

    const handleToolChange = createResourceUpdateHandler(
      workspaceId,
      'custom tool',
      fetchTools,
      isApplyingRemoteChange
    )

    onWorkspaceToolCreated(handleToolChange)
    onWorkspaceToolUpdated(handleToolChange)
    onWorkspaceToolDeleted(handleToolChange)
  }, [
    workspaceId,
    onWorkspaceToolCreated,
    onWorkspaceToolUpdated,
    onWorkspaceToolDeleted,
    fetchTools,
  ])

  // Folders
  useEffect(() => {
    if (!workspaceId) return

    const handleFolderChange = createResourceUpdateHandler(
      workspaceId,
      'folder',
      fetchFolders,
      isApplyingRemoteChange
    )

    onWorkspaceFolderCreated(handleFolderChange)
    onWorkspaceFolderUpdated(handleFolderChange)
    onWorkspaceFolderDeleted(handleFolderChange)
  }, [
    workspaceId,
    onWorkspaceFolderCreated,
    onWorkspaceFolderUpdated,
    onWorkspaceFolderDeleted,
    fetchFolders,
  ])

  // MCP servers
  useEffect(() => {
    if (!workspaceId) return

    const handleMcpUpdate = createResourceUpdateHandler(
      workspaceId,
      'MCP server',
      fetchServers,
      isApplyingRemoteChange
    )

    onWorkspaceMcpUpdated(handleMcpUpdate)
  }, [workspaceId, onWorkspaceMcpUpdated, fetchServers])

  // Workflows - Smart incremental updates to prevent page flash
  useEffect(() => {
    if (!workspaceId) return

    // Handle workflow creation - add single workflow to registry
    const handleWorkflowCreated = (data: WorkspaceResourceUpdate) => {
      if (!workspaceId || data.workspaceId !== workspaceId || isApplyingRemoteChange.current) return

      logger.info(`Workflow created in workspace ${workspaceId}, adding to registry...`, data.data)

      isApplyingRemoteChange.current = true

      try {
        // Extract workflow data from socket event
        const { workflowId, name, folderId, color, createdAt, workspaceId: wId } = data.data

        addWorkflow({
          id: workflowId,
          name,
          folderId: folderId ?? null,
          color: color || '#3b82f6',
          createdAt: createdAt ? new Date(createdAt) : new Date(),
          lastModified: new Date(),
          workspaceId: wId,
        })

        logger.info(`Successfully added workflow ${workflowId} to registry`)
      } catch (error) {
        logger.error('Failed to add workflow to registry, falling back to refetch:', error)
        // Fallback: clear cache and refetch all
        clearWorkflowsCache()
        loadWorkflows(workspaceId).catch((err) => {
          logger.error('Failed to reload workflows after add error:', err)
        })
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    // Handle workflow update - update single workflow in registry
    const handleWorkflowUpdated = (data: WorkspaceResourceUpdate) => {
      if (!workspaceId || data.workspaceId !== workspaceId || isApplyingRemoteChange.current) return

      logger.info(
        `Workflow updated in workspace ${workspaceId}, updating in registry...`,
        data.data
      )

      isApplyingRemoteChange.current = true

      try {
        const { workflowId, updates } = data.data

        updateWorkflowInRegistry(workflowId, {
          ...updates,
          lastModified: new Date(),
        })

        logger.info(`Successfully updated workflow ${workflowId} in registry`)
      } catch (error) {
        logger.error('Failed to update workflow in registry, falling back to refetch:', error)
        // Fallback: clear cache and refetch all
        clearWorkflowsCache()
        loadWorkflows(workspaceId).catch((err) => {
          logger.error('Failed to reload workflows after update error:', err)
        })
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    // Handle workflow deletion - remove single workflow from registry
    const handleWorkflowDeleted = (data: WorkspaceResourceUpdate) => {
      if (!workspaceId || data.workspaceId !== workspaceId || isApplyingRemoteChange.current) return

      logger.info(
        `Workflow deleted in workspace ${workspaceId}, removing from registry...`,
        data.data
      )

      isApplyingRemoteChange.current = true

      try {
        const { workflowId } = data.data

        removeWorkflowFromRegistry(workflowId)

        logger.info(`Successfully removed workflow ${workflowId} from registry`)
      } catch (error) {
        logger.error('Failed to remove workflow from registry, falling back to refetch:', error)
        // Fallback: clear cache and refetch all
        clearWorkflowsCache()
        loadWorkflows(workspaceId).catch((err) => {
          logger.error('Failed to reload workflows after delete error:', err)
        })
      } finally {
        isApplyingRemoteChange.current = false
      }
    }

    onWorkspaceWorkflowCreated(handleWorkflowCreated)
    onWorkspaceWorkflowUpdated(handleWorkflowUpdated)
    onWorkspaceWorkflowDeleted(handleWorkflowDeleted)
  }, [
    workspaceId,
    onWorkspaceWorkflowCreated,
    onWorkspaceWorkflowUpdated,
    onWorkspaceWorkflowDeleted,
    loadWorkflows,
    clearWorkflowsCache,
    addWorkflow,
    updateWorkflowInRegistry,
    removeWorkflowFromRegistry,
  ])
}
