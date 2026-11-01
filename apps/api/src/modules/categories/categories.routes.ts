import {
  CategorySchema,
  CreateCategorySchema,
  HouseholdParamsSchema,
  IdSchema,
  UpdateCategorySchema,
} from "@ledgerly/shared";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./categories.service.js";

const CategoryParams = HouseholdParamsSchema.extend({ categoryId: IdSchema });

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Categories"];

  app.get(
    "/categories",
    {
      schema: {
        tags,
        summary: "List all categories (flat; build the tree from parentId)",
        params: HouseholdParamsSchema,
        response: { 200: z.object({ data: z.array(CategorySchema) }), ...commonProblems },
      },
    },
    async (request) => ({ data: await service.listCategories(app.db, request.params.householdId) }),
  );

  app.post(
    "/categories",
    {
      schema: {
        tags,
        summary: "Create a category or subcategory",
        params: HouseholdParamsSchema,
        body: CreateCategorySchema,
        response: { 201: CategorySchema, ...commonProblems, ...problems(409, 422) },
      },
    },
    async (request, reply) => {
      const category = await service.createCategory(
        app.db,
        request.params.householdId,
        request.body,
      );
      return reply
        .status(201)
        .header(
          "location",
          `/v1/households/${request.params.householdId}/categories/${category.id}`,
        )
        .send(category);
    },
  );

  app.patch(
    "/categories/:categoryId",
    {
      schema: {
        tags,
        summary: "Update a category",
        params: CategoryParams,
        body: UpdateCategorySchema,
        response: { 200: CategorySchema, ...commonProblems, ...problems(409) },
      },
    },
    async (request) =>
      service.updateCategory(
        app.db,
        request.params.householdId,
        request.params.categoryId,
        request.body,
      ),
  );

  app.delete(
    "/categories/:categoryId",
    {
      schema: {
        tags,
        summary: "Delete an unused category",
        params: CategoryParams,
        response: { 204: z.null(), ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      await service.deleteCategory(app.db, request.params.householdId, request.params.categoryId);
      return reply.status(204).send(null);
    },
  );
};
