'use client'

import { Megaphone } from 'lucide-react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { EmptyState } from '@renderer/components/ui/empty-state'

/** Campaigns. Implemented in T3.1 (see SPRINTS.md). */
export default function CampaignsPage() {
  return (
    <>
      <PageHeader title="WhatsApp Bulk Campaigns" description="Send a template to a contact list across your devices, with delay and sleep pacing." />
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet."
        description="This screen is part of T3.1 and is not built yet."
      />
    </>
  )
}
