import { setupConnectionHandlers } from '@/socket-server/handlers/connection'
import { setupOperationsHandlers } from '@/socket-server/handlers/operations'
import { setupPresenceHandlers } from '@/socket-server/handlers/presence'
import { setupSubblocksHandlers } from '@/socket-server/handlers/subblocks'
import { setupVariablesHandlers } from '@/socket-server/handlers/variables'
import { setupWorkflowHandlers } from '@/socket-server/handlers/workflow'
import { setupWorkspaceHandlers } from '@/socket-server/handlers/workspace'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type {
  RoomManager,
  UserPresence,
  WorkflowRoom,
  WorkspaceRoom,
} from '@/socket-server/rooms/manager'

export type { UserPresence, WorkflowRoom, WorkspaceRoom }

/**
 * Sets up all socket event handlers for an authenticated socket connection
 * @param socket - The authenticated socket instance
 * @param roomManager - Room manager instance for state management
 */
export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: RoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupWorkspaceHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}

export {
  setupWorkflowHandlers,
  setupWorkspaceHandlers,
  setupOperationsHandlers,
  setupSubblocksHandlers,
  setupVariablesHandlers,
  setupPresenceHandlers,
  setupConnectionHandlers,
}
