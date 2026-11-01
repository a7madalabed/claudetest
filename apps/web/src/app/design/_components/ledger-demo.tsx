"use client";

import { parseMoney, sumMinorUnits, type MinorUnits } from "@ledgerly/shared";
import {
  Briefcase,
  Car,
  Coffee,
  Home,
  Plus,
  ShoppingCart,
  Sparkles,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Amount, AnimatedMoney } from "@/components/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Category = "income" | "groceries" | "dining" | "coffee" | "transport" | "home" | "other";

type Transaction = {
  id: string;
  description: string;
  category: Category;
  amount: MinorUnits; // positive = money in, negative = money out
};

const categoryStyle: Record<Category, { icon: LucideIcon; className: string; label: string }> = {
  income: { icon: Briefcase, className: "bg-positive-subtle text-positive", label: "Income" },
  groceries: {
    icon: ShoppingCart,
    className: "bg-primary-subtle text-primary",
    label: "Groceries",
  },
  dining: { icon: Utensils, className: "bg-warning-subtle text-warning", label: "Dining" },
  coffee: { icon: Coffee, className: "bg-warning-subtle text-warning", label: "Coffee" },
  transport: { icon: Car, className: "bg-muted text-muted-foreground", label: "Transport" },
  home: { icon: Home, className: "bg-primary-subtle text-primary", label: "Home" },
  other: { icon: Sparkles, className: "bg-muted text-muted-foreground", label: "Other" },
};

const samples: Omit<Transaction, "id">[] = [
  { description: "Blue Bottle Coffee", category: "coffee", amount: -575 },
  { description: "Whole Foods Market", category: "groceries", amount: -8642 },
  { description: "Freelance invoice #42", category: "income", amount: 120000 },
  { description: "Uber", category: "transport", amount: -1890 },
  { description: "Sushi Zen", category: "dining", amount: -4720 },
  { description: "Electricity bill", category: "home", amount: -9415 },
  { description: "Refund — Amazon", category: "income", amount: 2399 },
];

let nextId = 0;
const newId = () => `tx-${++nextId}`;

const initial: Transaction[] = [
  { id: newId(), description: "Salary — Acme Inc.", category: "income", amount: 425000 },
  { id: newId(), description: "Rent", category: "home", amount: -165000 },
  { id: newId(), description: "Trader Joe's", category: "groceries", amount: -6418 },
];

const STARTING_BALANCE: MinorUnits = 1_284_350;

export function LedgerDemo() {
  const [transactions, setTransactions] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  const balance = STARTING_BALANCE + sumMinorUnits(transactions.map((t) => t.amount));
  const income = sumMinorUnits(transactions.filter((t) => t.amount > 0).map((t) => t.amount));
  const spending = -sumMinorUnits(transactions.filter((t) => t.amount < 0).map((t) => t.amount));

  function add(transaction: Omit<Transaction, "id">) {
    const created = { ...transaction, id: newId() };
    setTransactions((current) => [created, ...current].slice(0, 6));
    toast(transaction.amount > 0 ? "Income added" : "Expense added", {
      description: transaction.description,
      action: { label: "Undo", onClick: () => remove(created.id) },
    });
  }

  function addRandom() {
    add(samples[Math.floor(Math.random() * samples.length)]!);
  }

  function remove(id: string) {
    setTransactions((current) => current.filter((t) => t.id !== id));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-1">
        <StatCard label="Balance" value={balance} emphasis className="col-span-2 sm:col-span-1" />
        <StatCard label="Income" value={income} tone="positive" />
        <StatCard label="Spending" value={spending} tone="negative" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle>Recent transactions</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRandom}>
              <Sparkles /> Random
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus /> New
            </Button>
          </div>
        </CardHeader>

        <ul className="relative min-h-80 px-2 pb-2">
          {/* popLayout: an item being removed is taken out of the layout immediately,
              so its siblings spring into place WHILE it fades out. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {transactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onRemove={() => remove(transaction.id)}
              />
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {transactions.length === 0 && (
              <motion.li
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
              >
                <p className="font-medium">No transactions</p>
                <p className="text-sm text-muted-foreground">Add one to see the list animate.</p>
              </motion.li>
            )}
          </AnimatePresence>
        </ul>
      </Card>

      <NewTransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={add} />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  emphasis = false,
  className,
}: {
  label: string;
  value: MinorUnits;
  tone?: "positive" | "negative";
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", emphasis && "bg-primary text-primary-foreground", className)}>
      <p className={cn("text-sm", emphasis ? "opacity-80" : "text-muted-foreground")}>{label}</p>
      <AnimatedMoney
        value={value}
        className={cn(
          "mt-1 block text-xl font-semibold tracking-tight sm:text-2xl",
          emphasis && "text-3xl",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      />
    </Card>
  );
}

function TransactionRow({
  transaction,
  onRemove,
}: {
  transaction: Transaction;
  onRemove: () => void;
}) {
  const style = categoryStyle[transaction.category];
  const Icon = style.icon;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15, ease: "easeIn" } }}
      transition={spring.smooth}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          style.className,
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{transaction.description}</p>
        <p className="text-caption text-muted-foreground">{style.label}</p>
      </div>
      <Amount value={transaction.amount} className="text-sm" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${transaction.description}`}
        className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted pointer-coarse:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </motion.li>
  );
}

function NewTransactionDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (transaction: Omit<Transaction, "id">) => void;
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [errors, setErrors] = useState<{ description?: string; amount?: string }>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const description = String(data.get("description") ?? "").trim();
    const amount = parseMoney(String(data.get("amount") ?? ""), "USD");

    const nextErrors = {
      description: description ? undefined : "Add a short description",
      amount: amount && amount > 0 ? undefined : "Enter an amount like 12.50",
    };
    setErrors(nextErrors);
    if (nextErrors.description || nextErrors.amount || !amount) return;

    onCreate({
      description,
      category: kind === "income" ? "income" : "other",
      amount: kind === "income" ? amount : -amount,
    });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setErrors({});
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
          <DialogDescription>
            Focus is trapped in here — try Tab, then Esc to close.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div
            role="radiogroup"
            aria-label="Type"
            className="grid grid-cols-2 rounded-lg bg-muted p-1"
          >
            {(["expense", "income"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                className={cn(
                  "relative rounded-md py-1.5 text-sm font-medium capitalize transition-colors",
                  kind === option
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {kind === option && (
                  <motion.span
                    layoutId="tx-kind-pill"
                    transition={spring.snappy}
                    className="absolute inset-0 rounded-md bg-surface shadow-elevation-1"
                  />
                )}
                <span className="relative">{option}</span>
              </button>
            ))}
          </div>
          <Field label="Description" error={errors.description}>
            <Input
              name="description"
              placeholder="e.g. Farmers market"
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field label="Amount" error={errors.amount}>
            <Input
              name="amount"
              prefix="$"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
            />
          </Field>
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Add {kind}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
