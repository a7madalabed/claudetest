import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpInput } from "./otp-input";

function Harness({ onComplete }: { onComplete: (value: string) => void }) {
  const [value, setValue] = useState("");
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} />;
}

describe("OtpInput", () => {
  it("is ONE labelled input with the right hints for phones and autofill", () => {
    render(<Harness onComplete={() => {}} />);
    const input = screen.getByLabelText("Verification code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("keeps only digits and completes after six", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText("Verification code");
    await userEvent.type(input, "12a3-45 6789");
    expect(input).toHaveValue("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("accepts a pasted code", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("Verification code"));
    await userEvent.paste("654321");
    expect(onComplete).toHaveBeenCalledWith("654321");
  });
});
