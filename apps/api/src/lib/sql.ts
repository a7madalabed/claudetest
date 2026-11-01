/**
 * Escapes LIKE/ILIKE wildcards in user input. Without this, searching for "50%"
 * would match "50", "500", "5000"… and "_" would match any character.
 * (It's not an injection risk — values are sent as parameters — but it IS a
 * correctness bug, and a performance one: '%' alone matches every row.)
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (character) => `\\${character}`);
}
