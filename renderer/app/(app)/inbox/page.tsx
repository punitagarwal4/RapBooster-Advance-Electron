'use client'

import { MessageSquare } from 'lucide-react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { EmptyState } from '@renderer/components/ui/empty-state'

/** Inbox. Implemented in T4.1 (see SPRINTS.md). */
export default function InboxPage() {
  return (
    <>
      <PageHeader title="Unified inbox" description="Conversations from every connected device appear here." />
      <EmptyState
        icon={MessageSquare}
        title="Connect a device to start receiving messages."
        description="This screen is part of T4.1 and is not built yet."
      />
    </>
  )
}
