import type { Metadata } from "next";
import { CategoriesView } from "@/components/categories/categories-view";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return <CategoriesView householdId={householdId} />;
}
