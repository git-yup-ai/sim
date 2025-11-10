import { env } from '@/lib/env'
import type { createLogger } from '@/lib/logs/console/logger'

interface WorkspaceResourceChangeData {
  [key: string]: unknown
}

/**
 * Notify the socket server about a workspace resource change via HTTP.
 *
 * This sends a non-blocking HTTP notification to the socket server, which then
 * broadcasts the change to all connected clients in the workspace room.
 *
 * @param workspaceId - The workspace where the resource changed
 * @param resourceType - The type of resource that changed
 * @param operation - The operation performed
 * @param data - Optional resource data for context
 * @param resourceId - Optional resource ID for logging context
 * @param logger - Logger instance
 *
 * @example
 * ```typescript
 * await notifyWorkspaceResourceChange(
 *   workspaceId,
 *   'workflows',
 *   'create',
 *   { workflowId: workflow.id, name: workflow.name },
 *   workflow.id,
 *   logger
 * )
 * ```
 */
export async function notifyWorkspaceResourceChange(
  workspaceId: string,
  resourceType: 'env' | 'tools' | 'folders' | 'mcp' | 'workflows',
  operation: 'create' | 'update' | 'delete',
  data: WorkspaceResourceChangeData,
  resourceId: string,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  if (!workspaceId) {
    logger.warn('Invalid workspaceId provided to notifyWorkspaceResourceChange')
    return
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
    const socketResponse = await fetch(`${socketUrl}/api/workspace-resource-changed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        resourceType,
        operation,
        data,
      }),
      signal: controller.signal,
    })

    if (socketResponse.ok) {
      logger.info(`Notified Socket.IO server about ${resourceType} ${resourceId} ${operation}`)
    } else {
      logger.warn(
        `Failed to notify Socket.IO server about ${resourceType} ${resourceId} ${operation}`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn(
        `Socket notification timeout after 5s for ${resourceType} ${resourceId} ${operation}`
      )
    } else {
      logger.warn(
        `Error notifying Socket.IO server about ${resourceType} ${resourceId} ${operation}:`,
        error
      )
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
