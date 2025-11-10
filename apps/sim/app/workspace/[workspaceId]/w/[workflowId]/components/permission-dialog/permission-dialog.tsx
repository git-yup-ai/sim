'use client'

import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface PermissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: 'changed' | 'revoked'
  oldRole?: string
  newRole?: string
  workspaceId?: string
}

export function PermissionDialog({
  open,
  onOpenChange,
  type,
  oldRole,
  newRole,
  workspaceId,
}: PermissionDialogProps) {
  const router = useRouter()

  const handleAcknowledge = () => {
    onOpenChange(false)

    if (type === 'revoked' && workspaceId) {
      // Redirect to workspace list
      router.push(`/workspace/${workspaceId}/w`)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {type === 'revoked' ? 'Access Removed' : 'Permissions Updated'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {type === 'revoked'
              ? 'Your access to this workspace has been removed by an administrator.'
              : `Your permissions have been updated from "${oldRole}" to "${newRole}".`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleAcknowledge}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
