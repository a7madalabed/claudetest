"use client";

import { Download, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";

export function ButtonsDemo() {
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setSaving(false);
    toast.success("Budget saved", { description: "Groceries · $450.00 / month" });
  }

  return (
    <Card>
      <CardContent className="space-y-6">
        <Row label="Variants">
          <Button>
            <Plus /> Add transaction
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 /> Delete
          </Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Tooltip content="Export as CSV">
            <Button size="icon" variant="outline" aria-label="Export as CSV">
              <Download />
            </Button>
          </Tooltip>
        </Row>
        <Row label="States">
          <Button loading={saving} onClick={save}>
            Save budget
          </Button>
          <Button disabled variant="outline">
            Disabled
          </Button>
        </Row>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <span className="w-20 shrink-0 font-mono text-caption text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
