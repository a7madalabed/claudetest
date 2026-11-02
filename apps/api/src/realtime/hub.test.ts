import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { PRESENCE_TTL_MS, RealtimeHub, type ClientEvent, type Subscriber } from "./hub.js";

const hub = () => new RealtimeHub({} as never, pino({ level: "silent" }));

function subscriber(userId: string, households: string[]) {
  const received: ClientEvent[] = [];
  const s: Subscriber = {
    id: `${userId}-conn`,
    userId,
    households: new Set(households),
    send: (event) => void received.push(event),
    refreshHouseholds: async () => {},
  };
  return { s, received };
}

describe("RealtimeHub routing", () => {
  it("delivers household changes only to that household's members", () => {
    const h = hub();
    const alex = subscriber("alex", ["home"]);
    const otto = subscriber("otto", ["other"]);
    h.add(alex.s);
    h.add(otto.s);
    h.dispatch({ t: "transactions", op: "insert", h: "home", n: 2, a: ["jamie"] });
    expect(alex.received).toEqual([
      { type: "transactions", householdId: "home", op: "insert", count: 2, actors: ["jamie"] },
    ]);
    expect(otto.received).toEqual([]);
  });

  it("delivers notifications only to their user", () => {
    const h = hub();
    const alex = subscriber("alex", ["home"]);
    const jamie = subscriber("jamie", ["home"]);
    h.add(alex.s);
    h.add(jamie.s);
    h.dispatch({ t: "notifications", u: "jamie" });
    expect(alex.received).toEqual([]);
    expect(jamie.received).toEqual([{ type: "notifications" }]);
  });

  it("re-reads memberships for the affected user before telling them", async () => {
    const h = hub();
    const sam = subscriber("sam", ["home"]);
    sam.s.refreshHouseholds = async () => {
      sam.s.households = new Set();
    };
    h.add(sam.s);
    h.dispatch({ t: "household_members", op: "delete", h: "home", u: ["sam"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sam.received).toEqual([{ type: "membership", householdId: "home", users: ["sam"] }]);
    h.dispatch({ t: "transactions", op: "insert", h: "home", n: 1 });
    expect(sam.received).toHaveLength(1); // no longer sees the household
  });

  it("announces presence changes, not every heartbeat or extra tab", () => {
    const h = hub();
    const alex = subscriber("alex", ["home"]);
    h.add(alex.s);
    const jamieOnline = (c: string) =>
      h.dispatch({ t: "presence", u: "jamie", c, hs: ["home"], s: "online" }, 1_000);
    jamieOnline("tab-1");
    jamieOnline("tab-1"); // heartbeat
    jamieOnline("tab-2"); // second tab
    expect(alex.received).toEqual([
      { type: "presence", householdId: "home", userId: "jamie", online: true },
    ]);
    expect(h.onlineIn("home", 1_000)).toEqual(["jamie"]);

    h.dispatch({ t: "presence", u: "jamie", c: "tab-1", hs: ["home"], s: "offline" }, 1_000);
    expect(alex.received).toHaveLength(1); // still online in tab 2
    h.dispatch({ t: "presence", u: "jamie", c: "tab-2", hs: ["home"], s: "offline" }, 1_000);
    expect(alex.received.at(-1)).toEqual({
      type: "presence",
      householdId: "home",
      userId: "jamie",
      online: false,
    });
  });

  it("expires presence whose instance stopped heartbeating", () => {
    const h = hub();
    const alex = subscriber("alex", ["home"]);
    h.add(alex.s);
    h.dispatch({ t: "presence", u: "jamie", c: "tab", hs: ["home"], s: "online" }, 0);
    h.sweep(PRESENCE_TTL_MS + 1);
    expect(h.onlineIn("home", PRESENCE_TTL_MS + 1)).toEqual([]);
    expect(alex.received.at(-1)).toMatchObject({ userId: "jamie", online: false });
  });
});
