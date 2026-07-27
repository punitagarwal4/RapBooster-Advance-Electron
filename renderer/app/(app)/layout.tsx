import type { ReactNode } from 'react'
import { AppShell } from '@renderer/components/layout/app-shell'

/** Chrome for the licensed application: sidebar, title bar, content column. */
export default function AppGroupLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>
}
