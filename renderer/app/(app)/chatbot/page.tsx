'use client'

import { Bot } from 'lucide-react'
import { PageHeader } from '@renderer/components/layout/page-header'
import { EmptyState } from '@renderer/components/ui/empty-state'

/** AI Bot. Implemented in T4.2 (see SPRINTS.md). */
export default function AIBotPage() {
  return (
    <>
      <PageHeader title="AI Chatbot Configuration" description="Configure automatic replies powered by OpenAI." />
      <EmptyState
        icon={Bot}
        title="Auto-reply is not configured yet."
        description="This screen is part of T4.2 and is not built yet."
      />
    </>
  )
}
