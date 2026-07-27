'use client'

import { Smartphone } from 'lucide-react'
import { PageHeader } from '../../components/layout/page-header'
import { EmptyState } from '../../components/ui/empty-state'

/** Devices. Implemented in T2.3 (see SPRINTS.md). */
export default function DevicesPage() {
  return (
    <>
      <PageHeader title="WhatsApp Devices" description="Link WhatsApp accounts by QR code or pairing code." />
      <EmptyState
        icon={Smartphone}
        title="No devices linked yet."
        description="This screen is part of T2.3 and is not built yet."
      />
    </>
  )
}
