'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useCollaborativeWorkspace } from '@/hooks/collaborative/use-collaborative-workspace'
import { useWorkspaceCleanup } from '@/hooks/use-workspace-cleanup'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useFolderStore } from '@/stores/folders/store'
import { useKnowledgeStore } from '@/stores/knowledge/store'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import { useProvidersStore } from '@/stores/providers/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkspaceInitializer')

interface WorkspaceInitState {
  isInitializing: boolean
  isReady: boolean
  error: string | null
  retryCount: number
}

interface WorkspaceInitContextType extends WorkspaceInitState {
  retry: () => void
}

const WorkspaceInitContext = createContext<WorkspaceInitContextType | null>(null)

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export function WorkspaceInitializer({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const [state, setState] = useState<WorkspaceInitState>({
    isInitializing: false,
    isReady: false,
    error: null,
    retryCount: 0,
  })

  const initializingRef = useRef(false)
  const currentWorkspaceRef = useRef<string | null>(null)

  // Workspace collaboration - handles room join/leave and real-time updates for all resources
  useCollaborativeWorkspace(workspaceId)

  // Store actions
  const { loadWorkflows } = useWorkflowRegistry()
  const { fetchTools } = useCustomToolsStore()
  const { loadWorkspaceEnvironment } = useEnvironmentStore()
  const { fetchServers } = useMcpServersStore()
  const { fetchFolders } = useFolderStore()
  const { getKnowledgeBasesList } = useKnowledgeStore()
  const { fetchModels, hasLoadedModels } = useProvidersStore()

  // Unified workspace cleanup
  const cleanupWorkspace = useWorkspaceCleanup()

  const initializeWorkspace = async (retryAttempt = 0) => {
    if (!workspaceId || initializingRef.current) return

    initializingRef.current = true
    setState({ isInitializing: true, isReady: false, error: null, retryCount: retryAttempt })

    logger.info(
      `Initializing workspace: ${workspaceId} (attempt ${retryAttempt + 1}/${MAX_RETRIES})`
    )

    try {
      // Phase 1: Critical data (parallel) - workflows and folders are essential
      const criticalResults = await Promise.allSettled([
        loadWorkflows(workspaceId),
        fetchFolders(workspaceId),
      ])

      // Check for critical failures
      const criticalFailures = criticalResults.filter((r) => r.status === 'rejected')
      if (criticalFailures.length > 0) {
        const errorMessage =
          criticalFailures.length === criticalResults.length
            ? 'Failed to load all critical workspace data'
            : `Failed to load ${criticalFailures.length} critical workspace resources`

        logger.error(errorMessage, {
          failures: criticalFailures.map((f) => (f.status === 'rejected' ? f.reason : null)),
        })

        throw new Error(errorMessage)
      }

      // Phase 2: Secondary data (parallel, non-blocking)
      // These can fail without blocking workspace access
      const secondaryPromises: Promise<unknown>[] = [
        fetchTools(workspaceId),
        loadWorkspaceEnvironment(workspaceId),
        fetchServers(workspaceId),
        getKnowledgeBasesList(workspaceId),
      ]

      // Only fetch provider models if they haven't been loaded yet (global, not workspace-specific)
      if (!hasLoadedModels('base')) secondaryPromises.push(fetchModels('base'))
      if (!hasLoadedModels('ollama')) secondaryPromises.push(fetchModels('ollama'))
      if (!hasLoadedModels('openrouter')) secondaryPromises.push(fetchModels('openrouter'))

      const secondaryResults = await Promise.allSettled(secondaryPromises)

      // Log secondary failures but don't block initialization
      const secondaryFailures = secondaryResults.filter((r) => r.status === 'rejected')
      if (secondaryFailures.length > 0) {
        logger.warn(`${secondaryFailures.length} secondary resources failed to load`, {
          failures: secondaryFailures.map((f) => (f.status === 'rejected' ? f.reason : null)),
        })
      }

      // Success - workspace is ready
      logger.info(`Workspace ${workspaceId} initialized successfully`)
      setState({ isInitializing: false, isReady: true, error: null, retryCount: retryAttempt })
      currentWorkspaceRef.current = workspaceId
      // Note: Workspace room join/leave is now handled by useCollaborativeWorkspace
    } catch (error) {
      logger.error(`Workspace initialization failed (attempt ${retryAttempt + 1}):`, error)

      // Retry logic for critical failures
      if (retryAttempt < MAX_RETRIES - 1) {
        logger.info(`Retrying workspace initialization in ${RETRY_DELAY}ms...`)
        setTimeout(
          () => {
            initializingRef.current = false
            initializeWorkspace(retryAttempt + 1)
          },
          RETRY_DELAY * (retryAttempt + 1)
        ) // Exponential backoff
      } else {
        setState({
          isInitializing: false,
          isReady: false,
          error: error instanceof Error ? error.message : 'Failed to initialize workspace',
          retryCount: retryAttempt,
        })
      }
    } finally {
      initializingRef.current = false
    }
  }

  const retry = () => {
    setState({ ...state, error: null, retryCount: 0 })
    initializeWorkspace(0)
  }

  // Initialize on workspace change
  useEffect(() => {
    if (workspaceId && workspaceId !== currentWorkspaceRef.current) {
      initializeWorkspace(0)
    }
  }, [workspaceId])

  // Cleanup on unmount or workspace change
  useEffect(() => {
    return () => {
      if (currentWorkspaceRef.current && currentWorkspaceRef.current !== workspaceId) {
        logger.info(`Cleaning up workspace: ${currentWorkspaceRef.current}`)
        // Note: Workspace room leave is now handled by useCollaborativeWorkspace
        // Clear all workspace-scoped caches to prevent stale data across workspaces
        cleanupWorkspace(currentWorkspaceRef.current)
      }
    }
  }, [workspaceId, cleanupWorkspace])

  const contextValue = {
    ...state,
    retry,
  }

  return (
    <WorkspaceInitContext.Provider value={contextValue}>{children}</WorkspaceInitContext.Provider>
  )
}

export function useWorkspaceInit() {
  const context = useContext(WorkspaceInitContext)
  if (!context) {
    throw new Error('useWorkspaceInit must be used within WorkspaceInitializer')
  }
  return context
}

// Re-export permission hooks from the separate provider
export {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
