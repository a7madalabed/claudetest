"use client";

import { formatMoney, parseMoney } from "@ledgerly/shared";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

export function FormsDemo() {
  const [amount, setAmount] = useState("1,234.5");
  const [touched, setTouched] = useState(false);
  const parsed = parseMoney(amount, "USD");
  const error = touched && parsed === null ? "Enter an amount like 12.50" : undefined;

  return (
    <Card>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <Field label="Description" description="Shown in your transaction list.">
          <Input placeholder="e.g. Weekly groceries" />
        </Field>
        <Field label="Amount" error={error}>
          <Input
            prefix="$"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <div className="rounded-xl bg-muted p-4 font-mono text-sm sm:col-span-2">
          <p className="text-muted-foreground">parseMoney(&quot;{amount}&quot;, &quot;USD&quot;)</p>
          <p className="mt-1">
            →{" "}
            {parsed === null ? (
              <span className="text-negative">null</span>
            ) : (
              <>
                <span className="text-primary">{parsed}</span>{" "}
                <span className="text-muted-foreground">
                  minor units = {formatMoney(parsed, "USD")}
                </span>
              </>
            )}
          </p>
        </div>
        <Field label="Disabled field">
          <Input disabled value="Read-only" />
        </Field>
      </CardContent>
    </Card>
  );
}
