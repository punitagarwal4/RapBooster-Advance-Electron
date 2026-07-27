'use client'

import { Settings } from 'lucide-react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { EmptyState } from '@renderer/components/ui/empty-state'

/** Settings. Implemented in T1.9 (see SPRINTS.md). */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="License, AI, sending defaults, data and updates." />
      <EmptyState
        icon={Settings}
        title="Settings arrive with the license panel."
        description="This screen is part of T1.9 and is not built yet."
      />
    </>
  )
}
