'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useCollaborativeWorkflow } from '@/hooks/collaborative/use-collaborative-workflow'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'

interface WorkspacePermissionsContextType {
  // Raw workspace permissions data
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>

  // Computed user permissions (connection-aware)
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }

  // Connection state management
  setOfflineMode: (isOffline: boolean) => void
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType>({
  workspacePermissions: null,
  permissionsLoading: false,
  permissionsError: null,
  updatePermissions: () => {},
  refetchPermissions: async () => {},
  userPermissions: {
    canRead: false,
    canEdit: false,
    canAdmin: false,
    userPermissions: 'read',
    isLoading: false,
    error: null,
  },
  setOfflineMode: () => {},
})

/**
 * Provider for workspace permissions and user permissions
 *
 * NOTE: This provider must be used within a component that has access to
 * useCollaborativeWorkflow() (i.e., within the workspace scope) because it
 * depends on the collaborative workflow state to detect operation errors.
 */
export function WorkspacePermissionsProvider({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  // Manage offline mode state locally
  const [isOfflineMode, setIsOfflineMode] = useState(false)

  // Get operation error state from collaborative workflow
  const { hasOperationError } = useCollaborativeWorkflow()

  // Set offline mode when there are operation errors
  useEffect(() => {
    if (hasOperationError) {
      setIsOfflineMode(true)
    }
  }, [hasOperationError])

  // Fetch workspace permissions and loading state
  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
    refetch: refetchPermissions,
  } = useWorkspacePermissions(workspaceId)

  // Get base user permissions from workspace permissions
  const baseUserPermissions = useUserPermissions(
    workspacePermissions,
    permissionsLoading,
    permissionsError
  )

  // Create connection-aware permissions that override user permissions when offline
  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode) {
      // In offline mode, force read-only permissions regardless of actual user permissions
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        // Keep canRead true so users can still view content
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    // When online, use normal permissions
    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

  const contextValue = useMemo(
    () => ({
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
      setOfflineMode: setIsOfflineMode,
    }),
    [
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    ]
  )

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}

/**
 * Hook to access workspace permissions and data from context
 * This provides both raw workspace permissions and computed user permissions
 */
export function useWorkspacePermissionsContext(): WorkspacePermissionsContextType {
  const context = useContext(WorkspacePermissionsContext)
  if (!context) {
    throw new Error(
      'useWorkspacePermissionsContext must be used within WorkspacePermissionsProvider'
    )
  }
  return context
}

/**
 * Hook to access user permissions from context
 * This replaces individual useUserPermissions calls and includes connection-aware permissions
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
