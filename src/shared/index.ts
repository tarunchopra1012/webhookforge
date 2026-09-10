/**
 * The `@shared` barrel: the infrastructure a domain module may depend on.
 *
 * Deliberately exports no Nest **modules**. A domain module importing
 * `SharedModule` does so by its own path; re-exporting it here would mean
 * every `import { TransactionHelper } from '@shared'` also pulls in the
 * module graph, and barrel-plus-module is the classic way to create a
 * circular import that only shows up as a mystifying `undefined` provider at
 * boot.
 */
export * from './cache/redis-client.token';
export * from './database';
