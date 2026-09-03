import { defineConfig } from '@mikro-orm/postgresql';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://wagering:wagering@localhost:5432/wagering';

export default defineConfig({
  clientUrl: databaseUrl,
  entities: ['dist/**/*.entity.js'],
  entitiesTs: ['src/**/*.entity.ts'],
  migrations: {
    path: 'dist/migrations',
    pathTs: 'src/migrations',
  },
});
