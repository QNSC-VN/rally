import { Link } from '@tanstack/react-router'
import { ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'

/**
 * 403 Access Denied page (SHELL-FR-014, P0-08).
 * Shown when the user is authenticated but lacks permission for the resource.
 */
export function ForbiddenPage() {
  const { t } = useTranslation('errors')

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 bg-background py-24"
      role="main"
      aria-labelledby="forbidden-heading"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive-bg">
        <ShieldOff size={30} className="text-destructive" />
      </div>
      <div className="text-center">
        <p id="forbidden-heading" className="text-4xl leading-none font-bold text-foreground">
          403
        </p>
        <p className="mt-1 text-ui-xl font-medium text-muted-foreground">{t('forbidden.title')}</p>
        <p className="mt-2 max-w-xs text-ui-lg text-muted-foreground" style={{ opacity: 0.8 }}>
          {t('forbidden.description')}
        </p>
      </div>
      <Button asChild className="mt-2">
        <Link to="/">{t('backToHome')}</Link>
      </Button>
    </div>
  )
}
