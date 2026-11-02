import {
  HouseholdParamsSchema,
  IdSchema,
  ImportSchema,
  ImportUploadResultSchema,
  StartImportSchema,
  UploadImportQuerySchema,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { commonProblems, problems } from "../../lib/responses.js";
import { MAX_IMPORT_BYTES } from "./csv.js";
import * as service from "./imports.service.js";

const ImportParams = HouseholdParamsSchema.extend({ importId: IdSchema });

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Imports"];

  /*
   * The file is sent as the raw request body with Content-Type: text/csv — no
   * multipart parsing needed. This keeps our CSRF rule intact: text/csv is NOT
   * one of the three content types an HTML form can send, so a browser must ask
   * permission first (a CORS preflight), which other sites can't get.
   * The parser is registered only inside this plugin, for these routes.
   */
  app.addContentTypeParser(
    "text/csv",
    { parseAs: "string", bodyLimit: MAX_IMPORT_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/imports",
    {
      bodyLimit: MAX_IMPORT_BYTES,
      schema: {
        tags,
        summary: "Upload a bank CSV (raw text/csv body) and get a preview + guessed mapping",
        params: HouseholdParamsSchema,
        querystring: UploadImportQuerySchema,
        body: z.string().meta({ description: "The CSV file's contents" }),
        response: { 201: ImportUploadResultSchema, ...commonProblems, ...problems(413, 415, 422) },
      },
    },
    async (request, reply) => {
      const result = await service.uploadImport(
        app.db,
        { householdId: request.household!.id, userId: request.user!.id },
        { ...request.query, text: request.body },
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/imports",
    {
      schema: {
        tags,
        summary: "Recent imports",
        params: HouseholdParamsSchema,
        response: { 200: z.object({ data: z.array(ImportSchema) }), ...commonProblems },
      },
    },
    async (request) => ({ data: await service.listImports(app.db, request.params.householdId) }),
  );

  app.get(
    "/imports/:importId",
    {
      schema: {
        tags,
        summary: "One import, with live progress while it runs",
        params: ImportParams,
        response: { 200: ImportSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.getImport(app.db, request.params.householdId, request.params.importId),
  );

  app.post(
    "/imports/:importId/start",
    {
      schema: {
        tags,
        summary: "Confirm the column mapping and import in the background",
        params: ImportParams,
        body: StartImportSchema,
        response: { 202: ImportSchema, ...commonProblems, ...problems(409, 422) },
      },
    },
    async (request, reply) => {
      const started = await service.startImport(
        app.db,
        request.params.householdId,
        request.params.importId,
        request.body.mapping,
      );
      // 202 Accepted: "we've got it, and it will happen" — not "it's done".
      return reply.status(202).send(started);
    },
  );

  app.post(
    "/imports/:importId/revert",
    {
      schema: {
        tags,
        summary: "Undo an import: delete the transactions it created",
        params: ImportParams,
        response: { 200: ImportSchema, ...commonProblems, ...problems(409) },
      },
    },
    async (request) =>
      service.revertImport(app.db, request.params.householdId, request.params.importId),
  );

  app.delete(
    "/imports/:importId",
    {
      schema: {
        tags,
        summary: "Discard an upload that hasn't been started",
        params: ImportParams,
        response: { 204: z.null(), ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      await service.discardImport(app.db, request.params.householdId, request.params.importId);
      return reply.status(204).send(null);
    },
  );
};
