'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowInitializer')

interface WorkflowInitState {
  isInitializing: boolean
  isReady: boolean
  error: string | null
  retryCount: number
}

interface WorkflowInitContextType extends WorkflowInitState {
  retry: () => void
}

const WorkflowInitContext = createContext<WorkflowInitContextType | null>(null)

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export function WorkflowInitializer({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const workflowId = params?.workflowId as string

  const [state, setState] = useState<WorkflowInitState>({
    isInitializing: false,
    isReady: false,
    error: null,
    retryCount: 0,
  })

  const initializingRef = useRef(false)
  const currentWorkflowRef = useRef<string | null>(null)

  // Store actions
  const { setActiveWorkflow, activeWorkflowId } = useWorkflowRegistry()
  const { loadForWorkflow } = useVariablesStore()

  const initializeWorkflow = async (retryAttempt = 0) => {
    if (!workflowId || initializingRef.current) return

    // If this workflow is already active, just mark as ready
    if (activeWorkflowId === workflowId && currentWorkflowRef.current === workflowId) {
      setState({ isInitializing: false, isReady: true, error: null, retryCount: 0 })
      return
    }

    initializingRef.current = true
    setState({ isInitializing: true, isReady: false, error: null, retryCount: retryAttempt })

    logger.info(`Initializing workflow: ${workflowId} (attempt ${retryAttempt + 1}/${MAX_RETRIES})`)

    try {
      // Load workflow state
      // This includes blocks, edges, deployment status, and workflow variables
      await setActiveWorkflow(workflowId)

      // Phase 2: Additional workflow-specific data could be loaded here if needed
      // For example: workflow-specific permissions, execution history, etc.
      // Currently, setActiveWorkflow loads all necessary data

      // Success - workflow is ready
      logger.info(`Workflow ${workflowId} initialized successfully`)
      setState({ isInitializing: false, isReady: true, error: null, retryCount: retryAttempt })
      currentWorkflowRef.current = workflowId
    } catch (error) {
      logger.error(`Workflow initialization failed (attempt ${retryAttempt + 1}):`, error)

      // Retry logic for critical failures
      if (retryAttempt < MAX_RETRIES - 1) {
        logger.info(`Retrying workflow initialization in ${RETRY_DELAY}ms...`)
        setTimeout(
          () => {
            initializingRef.current = false
            initializeWorkflow(retryAttempt + 1)
          },
          RETRY_DELAY * (retryAttempt + 1)
        ) // Exponential backoff
      } else {
        setState({
          isInitializing: false,
          isReady: false,
          error: error instanceof Error ? error.message : 'Failed to initialize workflow',
          retryCount: retryAttempt,
        })
      }
    } finally {
      initializingRef.current = false
    }
  }

  const retry = () => {
    setState({ ...state, error: null, retryCount: 0 })
    initializeWorkflow(0)
  }

  // Initialize on workflow change
  useEffect(() => {
    if (workflowId && workflowId !== currentWorkflowRef.current) {
      initializeWorkflow(0)
    }
  }, [workflowId])

  // Cleanup on unmount or workflow change
  useEffect(() => {
    return () => {
      if (currentWorkflowRef.current && currentWorkflowRef.current !== workflowId) {
        logger.info(`Cleaning up workflow: ${currentWorkflowRef.current}`)
        // Individual stores handle their own cleanup
      }
    }
  }, [workflowId])

  const contextValue = {
    ...state,
    retry,
  }

  return (
    <WorkflowInitContext.Provider value={contextValue}>{children}</WorkflowInitContext.Provider>
  )
}

export function useWorkflowInit() {
  const context = useContext(WorkflowInitContext)
  if (!context) {
    throw new Error('useWorkflowInit must be used within WorkflowInitializer')
  }
  return context
}
