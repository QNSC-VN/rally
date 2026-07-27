import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppModal, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form-field'
import { NativeSelect } from '@/shared/ui/native-select'
import { notify } from '@/shared/lib/toast'
import type { Permission } from '@/shared/config/permissions'
import type { Role } from '../model/use-system-roles'
import { permissionsFromStates, statesFromRole } from '../model/role-capabilities'
import { useCreateRole } from '../model/use-role-mutations'

interface CreateRoleDialogProps {
  open: boolean
  onClose: () => void
  /** Built-in roles offered as a "start from" template to seed the new role. */
  templates: Role[]
}

/**
 * Create a workspace custom role — name + an optional starting template. Its
 * permissions are then tuned INLINE in the matrix (no modal matrix here).
 */
export function CreateRoleDialog({ open, onClose, templates }: CreateRoleDialogProps) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [templateSlug, setTemplateSlug] = useState('')
  const create = useCreateRole()

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      notify.error(t('roles.nameRequired', 'Role name is required'))
      return
    }
    const tmpl = templates.find((r) => r.slug === templateSlug)
    const permissions = (tmpl ? permissionsFromStates(statesFromRole(tmpl)) : []) as Permission[]
    try {
      await create.mutateAsync({ name: trimmed, description: description.trim() || null, permissions })
      notify.success(t('roles.created', 'Role created'))
      onClose()
    } catch (err) {
      notify.fromError(err, t('roles.saveError', 'Could not save the role'))
    }
  }

  return (
    <AppModal open={open} onClose={onClose} title={t('roles.createTitle', 'Create role')} width={460}>
      <div className="space-y-4 px-6 py-5">
        <FormField label={t('roles.nameLabel', 'Name')} htmlFor="role-name" required>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('roles.namePlaceholder', 'e.g. QA Lead')}
            maxLength={100}
            autoFocus
          />
        </FormField>

        <FormField label={t('roles.descriptionLabel', 'Description')} htmlFor="role-desc">
          <Input
            id="role-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('roles.descriptionPlaceholder', 'What this role is for (optional)')}
            maxLength={500}
          />
        </FormField>

        {templates.length > 0 && (
          <FormField
            label={t('roles.startFrom', 'Start from')}
            htmlFor="role-template"
            hint={t('roles.startFromHint', 'Copy a built-in role, then fine-tune it in the grid.')}
          >
            <NativeSelect
              id="role-template"
              value={templateSlug}
              onChange={(e) => setTemplateSlug(e.target.value)}
            >
              <option value="">{t('roles.blankTemplate', 'Blank (no access)')}</option>
              {templates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.slug}>
                  {tmpl.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button onClick={handleCreate} disabled={create.isPending}>
          {t('roles.createRole', 'Create role')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
