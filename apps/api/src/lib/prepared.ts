/**
 * Prepared statements, built once per database handle (Stage 12).
 *
 * Profiling showed ~30% of the API's CPU went into Drizzle BUILDING the same
 * two SQL strings on every request (auth + household check) — Postgres ran
 * them in 0.02 ms. A prepared statement is built once with placeholders and
 * then only executed with new values; Postgres also parses and plans it once
 * per connection.
 *
 * Cached per handle in a WeakMap: tests create several apps with their own
 * database handles, and a prepared statement belongs to one handle.
 */
export function preparedFor<Db extends object, Statement>(build: (db: Db) => Statement) {
  const cache = new WeakMap<Db, Statement>();
  return (db: Db): Statement => {
    let statement = cache.get(db);
    if (!statement) {
      statement = build(db);
      cache.set(db, statement);
    }
    return statement;
  };
}
