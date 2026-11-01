import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Input } from "./field";

describe("Field", () => {
  it("connects the label to the input", () => {
    render(
      <Field label="Amount">
        <Input />
      </Field>,
    );
    // getByLabelText only succeeds if <label for> and <input id> are correctly linked.
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("announces the description as the input's accessible description", () => {
    render(
      <Field label="Description" description="Shown in your list">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("Description")).toHaveAccessibleDescription("Shown in your list");
  });

  it("marks the input invalid and announces the error", () => {
    render(
      <Field label="Amount" error="Enter an amount">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter an amount");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
  });
});
