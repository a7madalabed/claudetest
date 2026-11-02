import { Compass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Compass className="size-6" />
      </span>
      <h1 className="text-title">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Button asChild variant="outline">
        <Link href="/app">Back to your dashboard</Link>
      </Button>
    </div>
  );
}
