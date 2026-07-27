'use client'

import { Contact } from 'lucide-react'
import { PageHeader } from '../../components/layout/page-header'
import { EmptyState } from '../../components/ui/empty-state'

/** Contacts. Implemented in T2.4 (see SPRINTS.md). */
export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Contact Lists" description="Import, organise and export your recipients." />
      <EmptyState
        icon={Contact}
        title="No contact lists yet."
        description="This screen is part of T2.4 and is not built yet."
      />
    </>
  )
}
