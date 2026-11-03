import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";

/*
 * `output: "standalone"` copies the server and its dependencies, but by design
 * not the static assets: those are usually served by a CDN. We serve them from
 * the same server, so copy them next to it. Runs after every `next build`.
 */
const standalone = new URL("../.next/standalone/apps/web/", import.meta.url);
await cp(new URL("../.next/static/", import.meta.url), new URL(".next/static/", standalone), {
  recursive: true,
});
if (existsSync(new URL("../public/", import.meta.url))) {
  await cp(new URL("../public/", import.meta.url), new URL("public/", standalone), {
    recursive: true,
  });
}
