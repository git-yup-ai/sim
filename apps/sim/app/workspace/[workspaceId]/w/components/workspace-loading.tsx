'use client'

import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { useWorkspaceInit } from '@/app/workspace/[workspaceId]/providers/workspace-initializer'

export function WorkspaceLoading() {
  const { isInitializing, error, retry, retryCount } = useWorkspaceInit()

  if (error) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='max-w-md space-y-4 p-6 text-center'>
          <AlertCircle className='mx-auto h-12 w-12 text-destructive' />
          <h2 className='font-semibold text-xl'>Failed to Load Workspace</h2>
          <p className='text-muted-foreground text-sm'>{error}</p>
          <div className='text-muted-foreground text-xs'>
            Attempt {retryCount + 1} of {3}
          </div>
          <Button onClick={retry} variant='outline' size='default'>
            Retry Loading
          </Button>
        </div>
      </div>
    )
  }

  if (isInitializing) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='space-y-4 text-center'>
          <Loader2 className='mx-auto h-8 w-8 animate-spin text-muted-foreground' />
          <p className='text-muted-foreground text-sm'>Loading workspace...</p>
        </div>
      </div>
    )
  }

  return null
}
