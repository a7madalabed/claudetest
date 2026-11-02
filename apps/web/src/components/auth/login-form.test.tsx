import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query/client";
import { LoginForm, safeNext } from "./login-form";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function renderForm(next?: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LoginForm next={next} />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(email = "demo@ledgerly.app", password = "correct-horse-ledger") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("safeNext (open-redirect protection)", () => {
  it("only allows paths on our own site", () => {
    expect(safeNext("/app/settings/security")).toBe("/app/settings/security");
    expect(safeNext("https://evil.example")).toBe("/app");
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
  });
});

describe("LoginForm", () => {
  it("validates on the client before sending anything", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's error with a headline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 401,
          code: "invalid_credentials",
          title: "Invalid email or password",
          detail: "Check your details and try again.",
        }),
        { status: 401 },
      ),
    );
    renderForm();
    await fillAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password");
    expect(alert).toHaveTextContent("Check your details and try again.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("goes to the 2FA step when the account needs it, keeping the destination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "mfa_required", message: "Enter your code" }), {
        status: 200,
      }),
    );
    renderForm("/app/settings/security");
    await fillAndSubmit();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/login/verify?next=%2Fapp%2Fsettings%2Fsecurity"),
    );
  });
});
