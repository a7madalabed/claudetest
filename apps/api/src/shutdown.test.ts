import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { API_TEST_DATABASE_URL } from "./test/database.js";
import { TEST_ENCRYPTION_KEY } from "./test/helpers.js";

/*
 * Stage 17: a deploy failed ONE request, every time we measured (1 in ~10,000).
 * The cause, reproduced here exactly: a request that had started arriving on
 * an open connection was completed just after the draining instance began to
 * close, and Fastify's default answer to that is 503. This runs the real server
 * process (src/server.ts) and sends a real SIGTERM, as `docker stop` does.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("graceful shutdown", () => {
  let server: ChildProcess | undefined;
  afterEach(() => {
    server?.kill("SIGKILL");
  });

  it("answers a request that completes while the server is closing, instead of 503", async () => {
    const port = 4300 + Number(process.env.VITEST_POOL_ID ?? 1);
    server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_URL: API_TEST_DATABASE_URL,
        ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        COOKIE_SECURE: "true",
        MAIL_DRIVER: "log",
        LOG_LEVEL: "silent",
        SHUTDOWN_DRAIN_MS: "500",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`http://127.0.0.1:${port}/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await sleep(100);
    }

    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    let reply = "";
    socket.on("data", (chunk) => (reply += chunk));
    socket.on("error", () => {});

    socket.write("GET /health HTTP/1.1\r\nHost: api\r\n"); // the request has started…
    await sleep(100);
    server.kill("SIGTERM"); // …a deploy stops this instance…
    await sleep(700); // …the 500 ms drain ends, and closing begins…
    socket.write("\r\n"); // …and only now does the request complete.
    await sleep(500);
    socket.destroy();

    expect(reply.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
  });
});
