import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnimatedMoney, Amount } from "./money";

describe("Amount", () => {
  it("shows income with a plus sign and positive colour", () => {
    render(<Amount value={120000} />);
    const amount = screen.getByText("+$1,200.00");
    expect(amount.className).toContain("text-positive");
  });

  it("shows expenses with a real minus sign, not just red colour", () => {
    render(<Amount value={-5420} />);
    const amount = screen.getByText("−$54.20");
    expect(amount.className).toContain("text-negative");
  });
});

describe("AnimatedMoney", () => {
  it("writes a negative total with the same real minus sign as Amount (Stage 19)", () => {
    // The statement showed "-$550.00" (a hyphen) under lines written "−$50.00".
    render(<AnimatedMoney value={-55000} />);
    // Two copies: the visible one, and the one only screen readers get.
    expect(screen.getAllByText("−$550.00")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("-$");
  });
});
