import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import common from './locales/en/common.json'
import auth from './locales/en/auth.json'
import projects from './locales/en/projects.json'
import workItems from './locales/en/work-items.json'
import nav from './locales/en/nav.json'

export const defaultNS = 'common'

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  resources: {
    en: { common, auth, projects, 'work-items': workItems, nav },
  },
  interpolation: { escapeValue: false },
})

export default i18n
