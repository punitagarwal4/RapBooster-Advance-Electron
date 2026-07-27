'use client'

import { Users } from 'lucide-react'
import { PageHeader } from '../../components/layout/page-header'
import { EmptyState } from '../../components/ui/empty-state'

/** WA Groups. Implemented in T3.7 (see SPRINTS.md). */
export default function WAGroupsPage() {
  return (
    <>
      <PageHeader title="WhatsApp Groups" description="Sync groups from your devices, message them in bulk, or create them in bulk." />
      <EmptyState
        icon={Users}
        title="No groups synced yet."
        description="This screen is part of T3.7 and is not built yet."
      />
    </>
  )
}
