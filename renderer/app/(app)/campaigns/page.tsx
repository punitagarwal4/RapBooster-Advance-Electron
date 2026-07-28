'use client'

import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import { CreateCampaignDialog } from '@renderer/components/campaigns/create-campaign-dialog'
import { RecipientsDialog } from '@renderer/components/campaigns/recipients-dialog'
import { PageHeader } from '@renderer/components/layout/page-header'
import { useToast } from '@renderer/components/providers/toast-provider'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { CampaignStatusPill } from '@renderer/components/ui/status-pill'
import { useIpcEvent, useIpcQuery } from '@renderer/hooks/useIpc'

export default function CampaignsPage() {
  const campaigns = useIpcQuery('campaign:list')
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string>()
  const [viewing, setViewing] = useState<{ id: string; name: string }>()

  // Progress arrives batched from the engine, so a 100k-recipient run cannot
  // flood this screen.
  useIpcEvent('campaign:progress', () => campaigns.refetch())

  async function act(
    id: string,
    channel:
      | 'campaign:start'
      | 'campaign:pause'
      | 'campaign:resume'
      | 'campaign:stop'
      | 'campaign:delete',
  ) {
    setBusyId(id)
    const result = await window.api.invoke(channel, { id })
    setBusyId(undefined)
    if (!result.ok) toast('error', result.error.userMessage)
    campaigns.refetch()
  }

  async function report(id: string) {
    setBusyId(id)
    const result = await window.api.invoke('campaign:report', { id })
    setBusyId(undefined)
    if (!result.ok) {
      toast('error', result.error.userMessage)
      return
    }
    toast('success', `Report exported (${result.data.rows} rows)`)
    await window.api.invoke('system:openPath', { path: result.data.filePath })
  }

  const list = campaigns.data ?? []

  return (
    <>
      <PageHeader
        title="WhatsApp Bulk Campaigns"
        description="Send a template to a contact list across your devices, with delay and sleep pacing."
        actions={
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="new-campaign"
          >
            + Create Campaign
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet."
          description="Pick a template, some devices and a contact list, and RapBooster paces the sending for you."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Create Campaign
            </Button>
          }
        />
      ) : (
        <div
          className="grid gap-4 p-6 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]"
          data-testid="campaign-grid"
        >
          {list.map((campaign) => {
            const done = campaign.sentCount + campaign.failedCount
            const pct = campaign.totalCount > 0 ? (done / campaign.totalCount) * 100 : 0

            return (
              <div
                key={campaign.id}
                data-testid="campaign-card"
                className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {campaign.name}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {new Date(campaign.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <CampaignStatusPill status={campaign.status} />
                </div>

                <dl className="text-xs text-ink-muted">
                  <div className="flex justify-between">
                    <dt>Devices</dt>
                    <dd>{campaign.deviceIds.length}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Recipients</dt>
                    <dd>{campaign.totalCount.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Template</dt>
                    <dd className="truncate">{campaign.templateName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Pacing</dt>
                    <dd>
                      {campaign.delayFrom}-{campaign.delayTo}s · {campaign.sleepDuration}
                      s/
                      {campaign.sleepAfter}
                    </dd>
                  </div>
                  {campaign.scheduledAt && (
                    <div className="flex justify-between">
                      <dt>Scheduled</dt>
                      <dd>{new Date(campaign.scheduledAt).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>

                <div className="h-1.5 overflow-hidden rounded bg-app-bg">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs" data-testid="campaign-counters">
                  <span className="text-success">✓ Sent: {campaign.sentCount}</span>
                  {' | '}
                  <span className="text-danger">✗ Failed: {campaign.failedCount}</span>
                </p>

                <div className="mt-1 flex flex-wrap gap-2">
                  {campaign.status === 'running' ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => void act(campaign.id, 'campaign:pause')}
                        disabled={busyId === campaign.id}
                        data-testid="pause-campaign"
                      >
                        Pause
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void act(campaign.id, 'campaign:stop')}
                        disabled={busyId === campaign.id}
                      >
                        Stop
                      </Button>
                    </>
                  ) : campaign.status === 'paused' ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void act(campaign.id, 'campaign:resume')}
                        disabled={busyId === campaign.id}
                        data-testid="resume-campaign"
                      >
                        Resume
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void act(campaign.id, 'campaign:stop')}
                        disabled={busyId === campaign.id}
                      >
                        Stop
                      </Button>
                    </>
                  ) : campaign.status === 'draft' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void act(campaign.id, 'campaign:start')}
                      disabled={busyId === campaign.id}
                      data-testid="start-campaign"
                    >
                      Start
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    onClick={() => setViewing({ id: campaign.id, name: campaign.name })}
                    data-testid="view-recipients"
                  >
                    Recipients
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void report(campaign.id)}
                    disabled={busyId === campaign.id}
                    data-testid="report-campaign"
                  >
                    Report
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void act(campaign.id, 'campaign:delete')}
                    disabled={busyId === campaign.id}
                    data-testid="delete-campaign"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viewing && (
        <RecipientsDialog
          campaignId={viewing.id}
          campaignName={viewing.name}
          onClose={() => setViewing(undefined)}
        />
      )}

      {creating && (
        <CreateCampaignDialog
          onClose={() => setCreating(false)}
          onCreated={(id, startNow) => {
            campaigns.refetch()
            if (startNow) void act(id, 'campaign:start')
            else toast('success', 'Campaign saved as draft')
          }}
        />
      )}
    </>
  )
}
