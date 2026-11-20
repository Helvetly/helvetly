'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[18px] text-success-solid" />,
        info: <InfoIcon className="size-[18px] text-info-solid" />,
        warning: <TriangleAlertIcon className="size-[18px] text-warning-solid" />,
        error: <OctagonXIcon className="size-[18px] text-destructive" />,
        loading: <Loader2Icon className="size-[18px] animate-spin opacity-70" />,
      }}
      style={
        {
          // Inverted (dark on a light page, light on a dark one) so a toast stands out from cards and sheets.
          '--normal-bg': 'var(--foreground)',
          '--normal-text': 'var(--background)',
          '--normal-border': 'var(--foreground)',
          '--border-radius': 'var(--radius)',
          // An open drawer or dialog sets pointer-events: none on <body>; a toast's Undo must still take the click.
          pointerEvents: 'auto',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast gap-3 px-4 py-3.5 text-sm font-medium shadow-lg shadow-black/15',
          description: 'font-normal text-background/75!',
          actionButton: 'bg-background! text-foreground! font-medium',
          cancelButton: 'bg-background/15! text-background!',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
