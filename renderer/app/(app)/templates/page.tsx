'use client'

import { FileText } from 'lucide-react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { EmptyState } from '@renderer/components/ui/empty-state'

/** Templates. Implemented in T2.5 (see SPRINTS.md). */
export default function TemplatesPage() {
  return (
    <>
      <PageHeader title="WhatsApp Templates" description="Reusable messages with media, buttons and merge tags." />
      <EmptyState
        icon={FileText}
        title="No templates yet."
        description="This screen is part of T2.5 and is not built yet."
      />
    </>
  )
}
