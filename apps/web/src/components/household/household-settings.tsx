"use client";

import type { HouseholdRole, MemberDto } from "@ledgerly/shared";
import { LogOut, MailPlus, UserMinus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentHousehold } from "@/components/app-shell/household-context";
import { timeAgo } from "@/components/app-shell/notification-bell";
import { Page } from "@/components/app-shell/page";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { Select, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
import { spring } from "@/lib/motion";
import {
  useChangeRole,
  useInvitations,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateHousehold,
} from "@/lib/query/household";
import { useMe } from "@/lib/query/hooks";
import { useRealtime } from "@/lib/realtime";
import { InviteDialog } from "./invite-dialog";

const ROLE_HINT: Record<HouseholdRole, string> = {
  owner: "Everything, including members and settings",
  editor: "Adds and edits money, budgets and goals",
  viewer: "Sees everything, changes nothing",
};

/*
 * Every IANA zone the browser knows — plus "UTC", which supportedValuesOf()
 * leaves out (it lists geographic zones only). Without it, a household in UTC
 * (the default) showed "Africa/Abidjan", the first option: a <select> whose
 * value isn't among its options displays the first one. Found by an e2e
 * screenshot in Stage 13.
 */
const zones = (() => {
  try {
    return ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
  } catch {
    return ["UTC"];
  }
})();

export function HouseholdSettings({ householdId }: { householdId: string }) {
  const household = useCurrentHousehold();
  const isOwner = household?.role === "owner";
  const members = useMembers(householdId);
  const invitations = useInvitations(householdId, { enabled: isOwner });
  const [inviting, setInviting] = useState(false);
  const { online, status } = useRealtime();
  const { data: me } = useMe();
  // "Here now" means OTHER people. While disconnected we can't know, so we don't claim.
  const here = new Set(
    status === "live" ? (online[householdId] ?? []).filter((id) => id !== me?.id) : [],
  );
  const owners = members.data?.filter((m) => m.role === "owner").length ?? 0;

  return (
    <Page
      title="Household"
      description={`Who shares ${household?.name ?? "this household"}, and what they can do.`}
      actions={
        isOwner && (
          <Button onClick={() => setInviting(true)}>
            <MailPlus /> Invite someone
          </Button>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold">Members</h2>
              <p className="text-sm text-muted-foreground">
                {members.data ? `${members.data.length} people` : " "}
                {here.size > 0 && ` · ${here.size} here now`}
              </p>
            </div>
            {members.isPending ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                <AnimatePresence initial={false}>
                  {members.data?.map((member) => (
                    <motion.li
                      key={member.userId}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring.smooth}
                    >
                      <MemberRow
                        householdId={householdId}
                        member={member}
                        online={member.isYou || here.has(member.userId)}
                        canManage={isOwner}
                        lastOwner={member.role === "owner" && owners === 1}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Card>

          {isOwner && (invitations.data?.length ?? 0) > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-semibold">Pending invitations</h2>
              </div>
              <ul className="divide-y divide-border">
                <AnimatePresence initial={false}>
                  {invitations.data?.map((invitation) => (
                    <motion.li
                      key={invitation.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring.smooth}
                      className="flex flex-wrap items-center gap-3 px-5 py-3"
                    >
                      <Avatar name={invitation.email} className="bg-muted text-muted-foreground" />
                      <div className="min-w-[12rem] flex-1">
                        <p className="truncate text-sm font-medium">{invitation.email}</p>
                        <p className="text-caption text-muted-foreground">
                          Invited {timeAgo(invitation.createdAt)}
                          {invitation.invitedByName && ` by ${invitation.invitedByName}`}
                          {invitation.expired
                            ? " · expired"
                            : ` · expires ${timeAgo(invitation.expiresAt)}`}
                        </p>
                      </div>
                      <Badge
                        tone={invitation.expired ? "neutral" : "primary"}
                        className="capitalize"
                      >
                        {invitation.role}
                      </Badge>
                      <RevokeButton
                        householdId={householdId}
                        invitationId={invitation.id}
                        email={invitation.email}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          <GeneralCard householdId={householdId} editable={isOwner} />
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Roles</h2>
            <dl className="space-y-2.5 text-sm">
              {(Object.keys(ROLE_HINT) as HouseholdRole[]).map((role) => (
                <div key={role}>
                  <dt className="font-medium capitalize">{role}</dt>
                  <dd className="text-muted-foreground">{ROLE_HINT[role]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>

      {household && (
        <InviteDialog
          open={inviting}
          onOpenChange={setInviting}
          householdId={householdId}
          householdName={household.name}
        />
      )}
    </Page>
  );
}

function MemberRow({
  householdId,
  member,
  online,
  canManage,
  lastOwner,
}: {
  householdId: string;
  member: MemberDto;
  online: boolean;
  canManage: boolean;
  lastOwner: boolean;
}) {
  const router = useRouter();
  const changeRole = useChangeRole(householdId);
  const remove = useRemoveMember(householdId);
  const [armed, setArmed] = useState(false);
  const leaving = member.isYou;
  const canRemove = !lastOwner && (leaving || canManage);

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <span className="relative">
        <Avatar name={member.displayName} />
        {online && (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-positive ring-2 ring-surface"
            title="Here now"
          />
        )}
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm font-medium">
          {member.displayName}
          {member.isYou && <span className="font-normal text-muted-foreground"> (you)</span>}
        </p>
        <p className="truncate text-caption text-muted-foreground">
          {member.email}
          {online && !member.isYou && <span className="text-positive"> · here now</span>}
        </p>
      </div>
      {canManage && !lastOwner ? (
        <div className="w-32">
          <Select
            value={member.role}
            aria-label={`Role for ${member.displayName}`}
            onValueChange={(role) =>
              changeRole.mutate(
                { userId: member.userId, role: role as HouseholdRole },
                {
                  onSuccess: () =>
                    toast.success(
                      `${member.displayName.split(" ")[0]} is now ${role === "owner" ? "an owner" : `a ${role}`}`,
                    ),
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
            }
          >
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </Select>
        </div>
      ) : (
        <Badge
          tone={member.role === "owner" ? "primary" : "neutral"}
          className="capitalize"
          title={lastOwner ? "The last owner can't step down" : undefined}
        >
          {member.role}
        </Badge>
      )}
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="text-negative hover:bg-negative-subtle"
          disabled={remove.isPending}
          onBlur={() => setArmed(false)}
          onClick={() => {
            if (!armed) return setArmed(true);
            remove.mutate(member.userId, {
              onSuccess: () => {
                if (leaving) {
                  toast.success("You left the household");
                  router.push("/app");
                } else toast.success(`${member.displayName} was removed`);
              },
              onError: (error) => toast.error(errorMessage(error)),
            });
          }}
        >
          {leaving ? <LogOut /> : <UserMinus />}
          {armed ? "Click to confirm" : leaving ? "Leave" : "Remove"}
        </Button>
      )}
    </div>
  );
}

function RevokeButton({
  householdId,
  invitationId,
  email,
}: {
  householdId: string;
  invitationId: string;
  email: string;
}) {
  const revoke = useRevokeInvitation(householdId);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Revoke the invitation for ${email}`}
      disabled={revoke.isPending}
      onClick={() =>
        revoke.mutate(invitationId, {
          onSuccess: () => toast.success(`Invitation for ${email} revoked`),
          onError: (error) => toast.error(errorMessage(error)),
        })
      }
    >
      <X /> Revoke
    </Button>
  );
}

function GeneralCard({ householdId, editable }: { householdId: string; editable: boolean }) {
  const household = useCurrentHousehold();
  const update = useUpdateHousehold(householdId);
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? household?.name ?? "";

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">General</h2>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!shownName.trim() || shownName === household?.name) return;
          update.mutate(
            { name: shownName.trim() },
            {
              onSuccess: () => {
                setName(null);
                toast.success("Household renamed");
              },
              onError: (error) => toast.error(errorMessage(error)),
            },
          );
        }}
      >
        <Field label="Name" className="flex-1">
          <Input
            value={shownName}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            maxLength={100}
          />
        </Field>
        {editable && name !== null && name !== household?.name && (
          <Button type="submit" size="md" disabled={update.isPending}>
            Save
          </Button>
        )}
      </form>
      <Field
        label="Time zone"
        description="Decides when “today” starts for scheduled transactions and monthly budgets."
      >
        <NativeSelect
          value={household?.timeZone ?? "UTC"}
          disabled={!editable}
          onChange={(e) =>
            update.mutate(
              { timeZone: e.target.value },
              {
                onSuccess: () => toast.success("Time zone updated"),
                onError: (error) => toast.error(errorMessage(error)),
              },
            )
          }
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </Card>
  );
}
