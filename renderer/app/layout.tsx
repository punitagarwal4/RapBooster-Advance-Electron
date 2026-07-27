import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { ToastProvider } from '@renderer/components/providers/toast-provider'
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

/**
 * Root layout holds only the document and the toast host. The application
 * chrome lives in the `(app)` route group so the activation screen — which the
 * user sees before they are licensed — renders full-bleed with no sidebar.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="h-full antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
