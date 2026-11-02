import "server-only";
import { MeSchema } from "@ledgerly/shared";
import { cache } from "react";
import { serverApi } from "./server";

/**
 * The current user, fetched on the server. React's `cache()` de-duplicates calls
 * within ONE request: the app layout and the household layout both call getMe(),
 * but the API is only hit once per page load.
 */
export const getMe = cache(() => serverApi("/v1/me", MeSchema));
