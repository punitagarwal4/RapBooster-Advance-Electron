import { defineConfig } from 'prisma/config'

// The CLI (migrate/generate) needs a concrete database to work against at
// development time. The shipped app never uses this path — at runtime the
// adapter is constructed with app.getPath('userData')/rapbooster.db.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
})
