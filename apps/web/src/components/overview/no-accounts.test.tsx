import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoAccountsNotice } from "./no-accounts";

describe("NoAccountsNotice", () => {
  it("offers editors a way to add the first account", () => {
    render(<NoAccountsNotice householdId="h1" canEdit />);
    expect(screen.getByRole("link", { name: "Add an account" })).toHaveAttribute(
      "href",
      "/app/h1/accounts?new=1",
    );
  });

  it("tells viewers who can", () => {
    render(<NoAccountsNotice householdId="h1" canEdit={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an owner or editor/)).toBeInTheDocument();
  });
});
