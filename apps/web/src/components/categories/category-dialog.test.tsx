import type { CategoryDto } from "@ledgerly/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query/client";
import { CategoryDialog } from "./category-dialog";

const food: CategoryDto = {
  id: "0199a000-0000-7000-8000-0000000000f0",
  parentId: null,
  name: "Food",
  kind: "expense",
  icon: "utensils",
  sortOrder: 0,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(category: CategoryDto | null) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CategoryDialog
        open
        onOpenChange={onOpenChange}
        householdId="h1"
        category={category}
        categories={[food]}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const mockApi = (status = 201, body: object = food) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
const sentBody = (fetchMock: ReturnType<typeof mockApi>) =>
  JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);

afterEach(() => vi.restoreAllMocks());

describe("CategoryDialog", () => {
  it("creates a top-level expense category by default", async () => {
    const fetchMock = mockApi();
    const { onOpenChange } = renderDialog(null);
    await userEvent.type(screen.getByLabelText("Name"), "Childcare");
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sentBody(fetchMock)).toEqual({
      name: "Childcare",
      kind: "expense",
      parentId: null,
      icon: null,
      sortOrder: 0,
    });
  });

  it("renames without touching anything else", async () => {
    const fetchMock = mockApi(200);
    renderDialog(food);
    expect(screen.queryByLabelText("Kind")).not.toBeInTheDocument(); // kind and parent are fixed
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Food & drink");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("PATCH");
    expect(sentBody(fetchMock)).toEqual({ name: "Food & drink" });
  });

  it("puts a duplicate name error on the name field", async () => {
    mockApi(409, {
      status: 409,
      code: "category_name_taken",
      title: "Conflict",
      detail: 'A category named "Food" already exists at this level.',
    });
    renderDialog(null);
    await userEvent.type(screen.getByLabelText("Name"), "Food");
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(await screen.findByText(/already exists at this level/)).toBeInTheDocument();
  });
});
