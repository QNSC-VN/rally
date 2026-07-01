import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'http://localhost:3000/api/docs-json',
  output: {
    path: 'src/shared/api/generated',
    format: 'prettier',
    lint: 'eslint',
  },
  plugins: ['@hey-api/typescript'],
})
