import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { AppShell } from '../components/layout/app-shell'
import { ToastProvider } from '../components/providers/toast-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'RapBooster Advance',
  description: 'WhatsApp marketing desktop application',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="h-full antialiased">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  )
}
