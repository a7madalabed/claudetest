import { describe, expect, it } from "vitest";
import { OWNER, request, useTestApp } from "../../test/helpers.js";

describe("categories", () => {
  const ctx = useTestApp();
  const url = (path = "") => `/v1/households/${ctx.fixtures.householdId}/categories${path}`;
  const as = (method: "GET" | "POST" | "PATCH" | "DELETE", path = "", payload?: object) =>
    request(ctx.app, OWNER, { method, url: url(path), ...(payload && { payload }) });
  const find = async (name: string) =>
    (await as("GET")).json().data.find((c: { name: string }) => c.name === name);

  it("lists the category tree as a flat list", async () => {
    const data = (await as("GET")).json().data;
    expect(data).toHaveLength(21);
    const food = data.find((c: { name: string }) => c.name === "Food");
    expect(
      data
        .filter((c: { parentId: string }) => c.parentId === food.id)
        .map((c: { name: string }) => c.name)
        .sort(),
    ).toEqual(["Coffee", "Dining out", "Groceries"]);
  });

  it("creates a subcategory", async () => {
    const food = await find("Food");
    const response = await as("POST", "", {
      name: "Bakery",
      kind: "expense",
      parentId: food.id,
      icon: "croissant",
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ parentId: food.id, icon: "croissant" });
  });

  it("enforces business rules with 422", async () => {
    const groceries = await find("Groceries");
    const tooDeep = await as("POST", "", {
      name: "Organic",
      kind: "expense",
      parentId: groceries.id,
    });
    expect(tooDeep.json().code).toBe("category_too_deep");

    const food = await find("Food");
    const mismatch = await as("POST", "", { name: "Tips", kind: "income", parentId: food.id });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().code).toBe("category_kind_mismatch");
  });

  it("409 for a duplicate sibling name", async () => {
    const response = await as("POST", "", { name: "Food", kind: "expense" });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("category_name_taken");
  });

  it("409 when deleting a category that's in use", async () => {
    const groceries = await find("Groceries");
    const response = await as("DELETE", `/${groceries.id}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("category_in_use");
  });
});
