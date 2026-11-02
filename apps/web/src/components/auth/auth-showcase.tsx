"use client";

import { ArrowDownLeft, ArrowUpRight, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { AnimatedMoney } from "@/components/money";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * The decorative right-hand panel on auth pages: a soft gradient with floating
 * "preview" cards. Purely visual, so it's hidden from screen readers and from
 * small screens (where it would push the form below the fold).
 */
export function AuthShowcase() {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden bg-primary lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,oklch(1_0_0/0.18),transparent_45%),radial-gradient(circle_at_80%_70%,oklch(0.75_0.15_175/0.45),transparent_50%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(oklch(1_0_0)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0)_1px,transparent_1px)] [background-size:40px_40px]" />

      <motion.div
        variants={stagger(0.12, 0.2)}
        initial="hidden"
        animate="visible"
        className="relative flex h-full flex-col justify-center gap-5 px-16 text-primary-foreground"
      >
        <motion.p variants={fadeUp} className="max-w-md text-display text-balance">
          Your money, beautifully organised.
        </motion.p>
        <motion.p variants={fadeUp} className="max-w-md text-lg opacity-80">
          Track every account, every budget and every goal — together with the people you share a
          home with.
        </motion.p>

        <div className="relative mt-8 h-64 max-w-lg">
          <motion.div
            variants={fadeUp}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 left-0 w-72 rounded-2xl bg-white/12 p-5 shadow-2xl ring-1 ring-white/20 backdrop-blur-xl"
          >
            <p className="text-sm opacity-75">Net worth</p>
            <AnimatedMoney value={3_198_247} className="text-3xl font-semibold tracking-tight" />
            <p className="mt-2 text-sm opacity-75">+4.2% this month</p>
          </motion.div>
          <motion.div
            variants={fadeUp}
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            className="absolute top-28 left-48 w-72 space-y-3 rounded-2xl bg-white/12 p-5 shadow-2xl ring-1 ring-white/20 backdrop-blur-xl"
          >
            {[
              { icon: ArrowDownLeft, label: "Salary — Acme Inc.", amount: "+$4,250.00" },
              { icon: ArrowUpRight, label: "Whole Foods Market", amount: "−$86.42" },
            ].map(({ icon: Icon, label, amount }) => (
              <div key={label} className="flex items-center gap-3 text-sm">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                <span className="flex-1">{label}</span>
                <span className="font-medium tabular-nums">{amount}</span>
              </div>
            ))}
          </motion.div>
          <motion.div
            variants={fadeUp}
            className="absolute bottom-0 left-8 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm ring-1 ring-white/20 backdrop-blur-xl"
          >
            <ShieldCheck className="size-4" /> Two-factor authentication on
          </motion.div>
        </div>
      </motion.div>
    </aside>
  );
}
