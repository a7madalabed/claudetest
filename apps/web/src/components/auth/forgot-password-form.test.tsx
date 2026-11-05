import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query/client";
import { ForgotPasswordForm } from "./forgot-password-form";

afterEach(() => vi.restoreAllMocks());

function renderForm() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ForgotPasswordForm />
    </QueryClientProvider>,
  );
}

describe("ForgotPasswordForm", () => {
  it("doesn't flag the empty field before you submit (no layout jump under the cursor)", async () => {
    renderForm();
    await userEvent.click(screen.getByLabelText("Email"));
    await userEvent.tab(); // focus leaves the field, as when clicking a link below it
    expect(screen.queryByText("Enter a valid email address")).toBeNull();
  });

  it("says the same thing whether or not an account exists", async () => {
    // The API answers 202 for every address; the page must not add a hint either.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "maybe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account uses maybe@example.com, we've sent it a link",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/password-reset/request",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
