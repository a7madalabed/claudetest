import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Amount } from "./money";

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
