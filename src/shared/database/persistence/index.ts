/**
 * The entity list, in one place.
 *
 * Both `src/orm.ts` (the CLI DataSource that generates and runs migrations)
 * and `DatabaseModule` (the connection the app runs on) read this array.
 * The reference codebase keeps two separate lists, which is how a migration
 * ends up generated against a different set of entities than the app
 * actually uses — the schema diff is then quietly wrong.
 *
 * A glob would avoid the list entirely, but globs resolve differently under
 * ts-node and under the compiled build, and silently matching nothing is the
 * worst possible failure for a migration tool. An explicit array fails at
 * compile time instead.
 *
 * Slice 2 adds the first entities here.
 */
export const entities: (new () => object)[] = [];
