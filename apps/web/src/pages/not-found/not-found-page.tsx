import { Link } from '@tanstack/react-router'
import { FileQuestion, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'

export function NotFoundPage() {
  const { t } = useTranslation('errors')

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-lighter">
        <FileQuestion size={30} className="text-primary-light" />
      </div>
      <div className="text-center">
        <p className="text-4xl leading-none font-bold text-foreground">404</p>
        <p className="mt-1 text-ui-xl font-medium text-muted-foreground">{t('notFound.title')}</p>
        <p className="mt-1 text-ui-md text-foreground-subtle">{t('notFound.description')}</p>
      </div>
      <Button asChild className="mt-2">
        <Link to="/">
          <Home size={14} />
          {t('backToHome')}
        </Link>
      </Button>
    </div>
  )
}
