import { redirect } from "next/navigation";
import { getMe } from "@/lib/api/me";

/** /app has no page of its own: send people to their first household. */
export default async function AppIndex() {
  const me = await getMe();
  const first = me.households[0];
  redirect(first ? `/app/${first.id}` : "/app/settings/security");
}
