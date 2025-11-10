import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error'
import { WorkflowInitializer } from '@/app/workspace/[workspaceId]/w/[workflowId]/providers/workflow-initializer'

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='h-full overflow-hidden bg-muted/40'>
      <ErrorBoundary>
        <WorkflowInitializer>{children}</WorkflowInitializer>
      </ErrorBoundary>
    </main>
  )
}
