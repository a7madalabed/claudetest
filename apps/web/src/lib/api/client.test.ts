import { MeSchema } from "@ledgerly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { ApiError, errorMessage } from "./errors";

const respond = (status: number, body?: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("calls our own /api proxy with JSON and same-origin credentials", async () => {
    const fetchMock = respond(204);
    await api("/v1/auth/logout", { method: "POST", body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: '{"a":1}' }),
    );
  });

  it("turns Problem Details into a typed ApiError with field errors", async () => {
    respond(400, {
      status: 400,
      code: "validation_failed",
      title: "Invalid request",
      detail: "One or more fields are invalid.",
      requestId: "req-1",
      errors: [{ path: "body.email", message: "Enter a valid email address" }],
    });
    const error = (await api("/v1/auth/signup", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "validation_failed", requestId: "req-1" });
    expect(error.fieldError("email")).toBe("Enter a valid email address");
  });

  it("validates successful responses against the shared schema", async () => {
    respond(200, { id: "not-the-right-shape" });
    await expect(api("/v1/me", { schema: MeSchema })).rejects.toThrow();
  });

  it("produces friendly messages, never internals", () => {
    expect(errorMessage(new ApiError(500, { detail: "TypeError at line 42" }))).toBe(
      "Something went wrong on our side. Please try again.",
    );
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
