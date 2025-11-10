import * as schema from '@sim/db/schema'
import { workflowBlocks, workflowEdges } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Server } from 'socket.io'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const connectionString = env.DATABASE_URL
const db = drizzle(
  postgres(connectionString, {
    prepare: false,
    idle_timeout: 15,
    connect_timeout: 20,
    max: 3,
    onnotice: () => {},
  }),
  { schema }
)

const logger = createLogger('RoomManager')

export interface UserPresence {
  userId: string
  workflowId: string
  userName: string
  socketId: string
  joinedAt: number
  lastActivity: number
  role: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
  avatarUrl?: string | null
}

export interface WorkflowRoom {
  workflowId: string
  users: Map<string, UserPresence> // socketId -> UserPresence
  lastModified: number
  activeConnections: number
}

export interface WorkspaceRoom {
  workspaceId: string
  users: Set<string> // socketIds
  lastModified: number
  activeConnections: number
}

export class RoomManager {
  private workflowRooms = new Map<string, WorkflowRoom>()
  private workspaceRooms = new Map<string, WorkspaceRoom>()
  private socketToWorkflow = new Map<string, string>()
  private socketToWorkspace = new Map<string, { workspaceId: string; role: string }>()
  private userSessions = new Map<
    string,
    { userId: string; userName: string; avatarUrl?: string | null }
  >()
  private io: Server

  constructor(io: Server) {
    this.io = io
  }

  createWorkflowRoom(workflowId: string): WorkflowRoom {
    return {
      workflowId,
      users: new Map(),
      lastModified: Date.now(),
      activeConnections: 0,
    }
  }

  cleanupUserFromRoom(socketId: string, workflowId: string) {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      room.users.delete(socketId)
      room.activeConnections = Math.max(0, room.activeConnections - 1)

      if (room.activeConnections === 0) {
        this.workflowRooms.delete(workflowId)
        logger.info(`Cleaned up empty workflow room: ${workflowId}`)
      }
    }

    this.socketToWorkflow.delete(socketId)
    this.userSessions.delete(socketId)
  }

  handleWorkflowDeletion(workflowId: string) {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for deleted workflow ${workflowId}`)
      return
    }

    this.io.to(workflowId).emit('workflow-deleted', {
      workflowId,
      message: 'This workflow has been deleted',
      timestamp: Date.now(),
    })

    const socketsToDisconnect: string[] = []
    room.users.forEach((_, socketId) => {
      socketsToDisconnect.push(socketId)
    })

    socketsToDisconnect.forEach((socketId) => {
      const socket = this.io.sockets.sockets.get(socketId)
      if (socket) {
        socket.leave(workflowId)
        logger.debug(`Disconnected socket ${socketId} from deleted workflow ${workflowId}`)
      }
      this.cleanupUserFromRoom(socketId, workflowId)
    })

    this.workflowRooms.delete(workflowId)
    logger.info(
      `Cleaned up workflow room ${workflowId} after deletion (${socketsToDisconnect.length} users disconnected)`
    )
  }

  handleWorkflowRevert(workflowId: string, timestamp: number) {
    logger.info(`Handling workflow revert notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    this.io.to(workflowId).emit('workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow revert: ${workflowId}`)
  }

  handleWorkflowUpdate(workflowId: string) {
    logger.info(`Handling workflow update notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for updated workflow ${workflowId}`)
      return
    }

    const timestamp = Date.now()

    this.io.to(workflowId).emit('workflow-updated', {
      workflowId,
      message: 'Workflow has been updated externally',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about workflow update: ${workflowId}`)
  }

  handleCopilotWorkflowEdit(workflowId: string, description?: string) {
    logger.info(`Handling copilot workflow edit notification for ${workflowId}`)

    const room = this.workflowRooms.get(workflowId)
    if (!room) {
      logger.debug(`No active room found for copilot workflow edit ${workflowId}`)
      return
    }

    const timestamp = Date.now()

    this.io.to(workflowId).emit('copilot-workflow-edit', {
      workflowId,
      description,
      message: 'Copilot has edited the workflow - rehydrating from database',
      timestamp,
    })

    room.lastModified = timestamp

    logger.info(`Notified ${room.users.size} users about copilot workflow edit: ${workflowId}`)
  }

  handlePermissionChange(
    userId: string,
    workspaceId: string,
    newRole: string | null,
    isRemoved: boolean
  ) {
    logger.info(`Handling permission change for user ${userId} in workspace ${workspaceId}`)

    // Find all workflow rooms where this user is present
    const affectedRooms: WorkflowRoom[] = []

    for (const room of this.workflowRooms.values()) {
      const userSockets = Array.from(room.users.values()).filter((u) => u.userId === userId)
      if (userSockets.length > 0) {
        affectedRooms.push(room)
      }
    }

    if (affectedRooms.length === 0) {
      logger.info(`No active sessions found for user ${userId} in workspace ${workspaceId}`)
      return
    }

    logger.info(`Found ${affectedRooms.length} active room(s) for user ${userId}`)

    for (const room of affectedRooms) {
      const userSockets = Array.from(room.users.entries()).filter(
        ([_, presence]) => presence.userId === userId
      )

      for (const [socketId, presence] of userSockets) {
        const socket = this.io.sockets.sockets.get(socketId)

        if (isRemoved) {
          // Force disconnect - access completely revoked
          if (socket) {
            socket.emit('permission-revoked', {
              workspaceId,
              message: 'Your access to this workspace has been removed',
              timestamp: Date.now(),
            })
            socket.leave(room.workflowId)
          }
          this.cleanupUserFromRoom(socketId, room.workflowId)
          logger.info(`Disconnected user ${userId} from workflow ${room.workflowId}`)
        } else {
          // Update cached role
          const oldRole = presence.role
          presence.role = newRole!

          // Notify user of permission change
          if (socket) {
            socket.emit('permission-changed', {
              workspaceId,
              workflowId: room.workflowId,
              oldRole,
              newRole,
              message: 'Your permissions have been updated',
              timestamp: Date.now(),
            })
          }
          logger.info(
            `Updated role for user ${userId} in workflow ${room.workflowId}: ${oldRole} → ${newRole}`
          )
        }
      }

      // Broadcast presence update to reflect any changes
      this.broadcastPresenceUpdate(room.workflowId)
    }

    logger.info(`Permission change processed for user ${userId}`)
  }

  async validateWorkflowConsistency(
    workflowId: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    try {
      const issues: string[] = []

      const orphanedEdges = await db
        .select({
          id: workflowEdges.id,
          sourceBlockId: workflowEdges.sourceBlockId,
          targetBlockId: workflowEdges.targetBlockId,
        })
        .from(workflowEdges)
        .leftJoin(workflowBlocks, eq(workflowEdges.sourceBlockId, workflowBlocks.id))
        .where(and(eq(workflowEdges.workflowId, workflowId), isNull(workflowBlocks.id)))

      if (orphanedEdges.length > 0) {
        issues.push(`Found ${orphanedEdges.length} orphaned edges with missing source blocks`)
      }

      return { valid: issues.length === 0, issues }
    } catch (error) {
      logger.error('Error validating workflow consistency:', error)
      return { valid: false, issues: ['Consistency check failed'] }
    }
  }

  getWorkflowRooms(): ReadonlyMap<string, WorkflowRoom> {
    return this.workflowRooms
  }

  getSocketToWorkflow(): ReadonlyMap<string, string> {
    return this.socketToWorkflow
  }

  getUserSessions(): ReadonlyMap<string, { userId: string; userName: string }> {
    return this.userSessions
  }

  hasWorkflowRoom(workflowId: string): boolean {
    return this.workflowRooms.has(workflowId)
  }

  getWorkflowRoom(workflowId: string): WorkflowRoom | undefined {
    return this.workflowRooms.get(workflowId)
  }

  setWorkflowRoom(workflowId: string, room: WorkflowRoom): void {
    this.workflowRooms.set(workflowId, room)
  }

  getWorkflowIdForSocket(socketId: string): string | undefined {
    return this.socketToWorkflow.get(socketId)
  }

  setWorkflowForSocket(socketId: string, workflowId: string): void {
    this.socketToWorkflow.set(socketId, workflowId)
  }

  getUserSession(
    socketId: string
  ): { userId: string; userName: string; avatarUrl?: string | null } | undefined {
    return this.userSessions.get(socketId)
  }

  setUserSession(
    socketId: string,
    session: { userId: string; userName: string; avatarUrl?: string | null }
  ): void {
    this.userSessions.set(socketId, session)
  }

  getTotalActiveConnections(): number {
    return Array.from(this.workflowRooms.values()).reduce(
      (total, room) => total + room.activeConnections,
      0
    )
  }

  broadcastPresenceUpdate(workflowId: string): void {
    const room = this.workflowRooms.get(workflowId)
    if (room) {
      const roomPresence = Array.from(room.users.values())
      this.io.to(workflowId).emit('presence-update', roomPresence)
    }
  }

  emitToWorkflow<T = unknown>(workflowId: string, event: string, payload: T): void {
    this.io.to(workflowId).emit(event, payload)
  }

  /**
   * Get the number of unique users in a workflow room
   * (not the number of socket connections)
   */
  getUniqueUserCount(workflowId: string): number {
    const room = this.workflowRooms.get(workflowId)
    if (!room) return 0

    const uniqueUsers = new Set<string>()
    room.users.forEach((presence) => {
      uniqueUsers.add(presence.userId)
    })

    return uniqueUsers.size
  }

  // ===== Workspace Room Methods =====

  createWorkspaceRoom(workspaceId: string): WorkspaceRoom {
    return {
      workspaceId,
      users: new Set(),
      lastModified: Date.now(),
      activeConnections: 0,
    }
  }

  cleanupUserFromWorkspaceRoom(socketId: string, workspaceId: string) {
    const room = this.workspaceRooms.get(workspaceId)
    if (room) {
      room.users.delete(socketId)
      room.activeConnections = Math.max(0, room.activeConnections - 1)

      if (room.activeConnections === 0) {
        this.workspaceRooms.delete(workspaceId)
        logger.info(`Cleaned up empty workspace room: ${workspaceId}`)
      }
    }

    this.socketToWorkspace.delete(socketId)
  }

  hasWorkspaceRoom(workspaceId: string): boolean {
    return this.workspaceRooms.has(workspaceId)
  }

  getWorkspaceRoom(workspaceId: string): WorkspaceRoom | undefined {
    return this.workspaceRooms.get(workspaceId)
  }

  setWorkspaceRoom(workspaceId: string, room: WorkspaceRoom): void {
    this.workspaceRooms.set(workspaceId, room)
  }

  getWorkspaceIdForSocket(socketId: string): string | undefined {
    return this.socketToWorkspace.get(socketId)?.workspaceId
  }

  setSocketWorkspace(socketId: string, workspaceId: string, role: string): void {
    this.socketToWorkspace.set(socketId, { workspaceId, role })
  }

  getWorkspaceRoleForSocket(socketId: string): string | undefined {
    return this.socketToWorkspace.get(socketId)?.role
  }

  emitToWorkspace<T = unknown>(workspaceId: string, event: string, payload: T): void {
    this.io.to(workspaceId).emit(event, payload)
  }

  /**
   * Handle workspace resource changes and broadcast to all workspace members
   * @param workspaceId - The workspace where the resource changed
   * @param resourceType - Type of resource (env, tools, folders, mcp, workflows)
   * @param operation - Operation performed (create, update, delete)
   * @param data - The resource data
   */
  handleWorkspaceResourceChange(
    workspaceId: string,
    resourceType: 'env' | 'tools' | 'folders' | 'mcp' | 'workflows',
    operation: 'create' | 'update' | 'delete',
    data: any
  ) {
    logger.info(`Handling ${resourceType} ${operation} notification for workspace ${workspaceId}`)

    const room = this.workspaceRooms.get(workspaceId)
    if (!room) {
      logger.debug(`No active workspace room found for ${workspaceId}`)
      return
    }

    const timestamp = Date.now()
    room.lastModified = timestamp

    // Emit appropriate event based on resource type
    const eventMap = {
      env: 'workspace-env-updated',
      tools: `workspace-tool-${operation}d`, // create → created, update → updated, delete → deleted
      folders: `workspace-folder-${operation}d`,
      mcp: 'workspace-mcp-updated',
      workflows: `workspace-workflow-${operation}d`, // create → created, update → updated, delete → deleted
    }

    const event = eventMap[resourceType]

    this.io.to(workspaceId).emit(event, {
      workspaceId,
      resourceType,
      operation,
      data,
      timestamp,
    })

    logger.info(
      `Notified ${room.activeConnections} users about ${resourceType} ${operation} in workspace ${workspaceId}`
    )
  }
}
