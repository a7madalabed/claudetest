import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState, loadFailed } from "./error-state";

describe("ErrorState", () => {
  it("is announced as an alert and retries on request", async () => {
    let finish!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this");
    const retry = screen.getByRole("button", { name: "Try again" });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    // One retry at a time: the button waits for the first to finish.
    expect(retry).toBeDisabled();
    finish();
    await vi.waitFor(() => expect(retry).toBeEnabled());
  });
});

describe("loadFailed", () => {
  it("is true only when the request failed AND there's nothing to show", () => {
    expect(loadFailed({ isError: true, data: undefined })).toBe(true);
    // A background refresh failed, but the last good data is still on screen: keep it.
    expect(loadFailed({ isError: true, data: [] })).toBe(false);
    expect(loadFailed({ isError: false, data: undefined })).toBe(false);
  });
});
