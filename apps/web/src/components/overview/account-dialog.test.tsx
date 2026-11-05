import type { AccountDto } from "@ledgerly/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query/client";
import { AccountDialog } from "./account-dialog";

const card: AccountDto = {
  id: "0199a000-0000-7000-8000-000000000001",
  name: "Visa",
  type: "credit_card",
  currency: "USD",
  openingBalanceMinor: -45_000,
  balanceMinor: -45_000,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(account: AccountDto | null) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AccountDialog
        open
        onOpenChange={onOpenChange}
        householdId="h1"
        currency="USD"
        account={account}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** Replies like the API; returns what was sent. */
function mockApi(status = 201, body: object = card) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
const sentBody = (fetchMock: ReturnType<typeof mockApi>) =>
  JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);

afterEach(() => vi.restoreAllMocks());

describe("AccountDialog", () => {
  it("adds an account with today's balance, in minor units", async () => {
    const fetchMock = mockApi();
    const { onOpenChange } = renderDialog(null);
    await userEvent.type(screen.getByLabelText("Name"), "Everyday checking");
    await userEvent.type(screen.getByLabelText("Balance today"), "1,250.40");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/households/h1/accounts");
    expect(sentBody(fetchMock)).toEqual({
      name: "Everyday checking",
      type: "checking",
      openingBalanceMinor: 125_040,
    });
  });

  it("shows a card's debt as 'amount owed', and keeps it negative when saved", async () => {
    const fetchMock = mockApi(200);
    renderDialog(card);
    const owed = screen.getByLabelText("Amount owed");
    expect(owed).toHaveValue("450.00"); // what you owe, without a minus sign

    await userEvent.clear(owed);
    await userEvent.type(owed, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toMatchObject({ openingBalanceMinor: -50_000 });
  });

  it("refuses an amount it can't read, without calling the API", async () => {
    const fetchMock = mockApi();
    renderDialog(null);
    await userEvent.type(screen.getByLabelText("Name"), "Cash");
    await userEvent.type(screen.getByLabelText("Balance today"), "12.345");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText("Enter an amount like 1250.00")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts a duplicate name error on the name field", async () => {
    mockApi(409, {
      status: 409,
      code: "account_name_taken",
      title: "Conflict",
      detail: 'An account named "Cash" already exists in this household.',
    });
    renderDialog(null);
    await userEvent.type(screen.getByLabelText("Name"), "Cash");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText(/already exists in this household/)).toBeInTheDocument();
  });
});
