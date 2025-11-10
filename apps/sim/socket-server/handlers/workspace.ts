import { createLogger } from '@/lib/logs/console/logger'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import { verifyWorkspaceAccess } from '@/socket-server/middleware/permissions'
import type { RoomManager, WorkspaceRoom } from '@/socket-server/rooms/manager'

const logger = createLogger('WorkspaceHandlers')

export type { WorkspaceRoom }

export interface HandlerDependencies {
  roomManager: RoomManager
}

export const createWorkspaceRoom = (workspaceId: string): WorkspaceRoom => ({
  workspaceId,
  users: new Set(),
  lastModified: Date.now(),
  activeConnections: 0,
})

export function setupWorkspaceHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)

  /**
   * Join workspace room
   * Users join when entering workspace pages (workflows list, knowledge bases, etc.)
   */
  socket.on('join-workspace', async ({ workspaceId }) => {
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        logger.warn(`Join workspace rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workspace-error', { error: 'Authentication required' })
        return
      }

      logger.info(
        `Join workspace request from ${userId} (${userName}) for workspace ${workspaceId}`
      )

      // Verify workspace access
      let userRole: string
      try {
        const accessInfo = await verifyWorkspaceAccess(userId, workspaceId)
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workspace ${workspaceId}`)
          socket.emit('join-workspace-error', { error: 'Access denied to workspace' })
          return
        }
        userRole = accessInfo.role || 'read'
      } catch (error) {
        logger.warn(`Error verifying workspace access for ${userId}:`, error)
        socket.emit('join-workspace-error', { error: 'Failed to verify workspace access' })
        return
      }

      // Leave previous workspace room if any
      const currentWorkspaceId = roomManager.getWorkspaceIdForSocket(socket.id)
      if (currentWorkspaceId && currentWorkspaceId !== workspaceId) {
        socket.leave(currentWorkspaceId)
        roomManager.cleanupUserFromWorkspaceRoom(socket.id, currentWorkspaceId)
      }

      // Join new workspace room
      socket.join(workspaceId)

      // Create workspace room if it doesn't exist
      if (!roomManager.hasWorkspaceRoom(workspaceId)) {
        roomManager.setWorkspaceRoom(workspaceId, createWorkspaceRoom(workspaceId))
      }

      // Add user to room
      const room = roomManager.getWorkspaceRoom(workspaceId)!
      room.activeConnections++
      room.users.add(socket.id)

      // Map socket to workspace
      roomManager.setSocketWorkspace(socket.id, workspaceId, userRole)

      logger.info(
        `User ${userId} (${userName}) joined workspace ${workspaceId} with role ${userRole}. Active connections: ${room.activeConnections}`
      )

      // Confirm join
      socket.emit('joined-workspace', {
        workspaceId,
        role: userRole,
        activeUsers: room.activeConnections,
      })
    } catch (error) {
      logger.error('Error in join-workspace handler:', error)
      socket.emit('join-workspace-error', { error: 'Failed to join workspace' })
    }
  })

  /**
   * Leave workspace room
   * Users leave when navigating away from workspace
   */
  socket.on('leave-workspace', async ({ workspaceId }) => {
    try {
      const userId = socket.userId

      logger.info(`Leave workspace request from ${userId} for workspace ${workspaceId}`)

      socket.leave(workspaceId)
      roomManager.cleanupUserFromWorkspaceRoom(socket.id, workspaceId)

      const room = roomManager.getWorkspaceRoom(workspaceId)
      if (room) {
        logger.info(
          `User ${userId} left workspace ${workspaceId}. Remaining connections: ${room.activeConnections}`
        )
      }

      socket.emit('left-workspace', { workspaceId })
    } catch (error) {
      logger.error('Error in leave-workspace handler:', error)
    }
  })
}
