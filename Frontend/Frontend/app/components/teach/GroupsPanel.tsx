/**
 * Groups panel — manages student groups within a course.
 *
 * STUDENTs are listed by username. The backend's add-member endpoint
 * resolves usernames to user ids, so the form here only ever sends
 * `{ username }` (per `groups/schemas.js#AddMemberSchema`).
 *
 * Selecting a group from the left rail lazily fetches its detail
 * (`GET /api/courses/:courseSlug/groups/:groupSlug`) so we don't pull
 * every member list at once.
 */
import { useEffect, useRef, useState } from "react";
import {
  Plus, Trash2, Users, UserMinus, UserPlus, Pencil, AlertCircle,
  Ticket, Copy, RotateCw, Power, PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router";
import { api, ApiError } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Empty } from "~/components/common/Empty";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { GroupSummary, GroupDetail, GroupInviteInfo } from "~/lib/teaching-types";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

export function GroupsPanel({ courseSlug }: { courseSlug: string }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<GroupSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GroupSummary | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const list = await api<GroupSummary[]>(`/courses/${courseSlug}/groups`);
      setGroups(list);
      if (list.length && !list.some(g => g.slug === selected)) setSelected(list[0].slug);
      else if (!list.length) setSelected(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load groups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [courseSlug]);

  async function deleteGroup(g: GroupSummary) {
    setPendingDelete(null);
    try {
      await api(`/courses/${courseSlug}/groups/${g.slug}`, { method: "DELETE" });
      toast.success(`Deleted "${g.title}"`);
      if (selected === g.slug) setSelected(null);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete group");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Students see only the courses they belong to via groups, so add students here to give them access.
        </p>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="size-4 mr-1.5" /> New group
        </Button>
      </div>

      {loading ? (
        <div className="h-72 rounded-xl border border-border bg-card animate-pulse" />
      ) : groups.length === 0 ? (
        <Empty
          icon={Users}
          title="No groups yet"
          description="Create a group to enroll students into this course."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4 mr-1.5" />Create group</Button>}
        />
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Group list rail */}
          <div className="lg:col-span-1 rounded-xl border border-border bg-card overflow-hidden">
            <ul className="divide-y divide-border">
              {groups.map(g => (
                <li
                  key={g.slug}
                  className={`p-3 cursor-pointer transition-colors ${
                    selected === g.slug ? "bg-primary/10" : "hover:bg-accent/30"
                  }`}
                  onClick={() => setSelected(g.slug)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{g.title}</div>
                      <code className="text-xs text-muted-foreground">{g.slug}</code>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1">
                      <Users className="size-3" /> {g.memberCount}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-data-[active]:opacity-100"
                    style={{ opacity: selected === g.slug ? 1 : 0 }}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setRenameTarget(g); }}
                    >
                      <Pencil className="size-3.5 mr-1" /> Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
                      onClick={(e) => { e.stopPropagation(); setPendingDelete(g); }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Members detail */}
          <div className="lg:col-span-2">
            {selected ? (
              <GroupDetailPanel
                courseSlug={courseSlug}
                groupSlug={selected}
                onMembershipChanged={reload}
              />
            ) : (
              <div className="h-full min-h-[12rem] rounded-xl border border-dashed border-border flex items-center justify-center text-sm text-muted-foreground">
                Select a group on the left to manage its members.
              </div>
            )}
          </div>
        </div>
      )}

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        courseSlug={courseSlug}
        onCreated={(slug) => { reload(); setSelected(slug); }}
      />

      <RenameGroupDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        courseSlug={courseSlug}
        onUpdated={reload}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this group?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  The group <strong>{pendingDelete.title}</strong> and all its memberships
                  will be removed. Students in this group will lose access to this course
                  unless they belong to another group in it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteGroup(pendingDelete)}
              className="bg-rose-500 hover:bg-rose-500/90 text-white"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Group detail (members) ─────────────────────────────────────────────── */

function GroupDetailPanel({
  courseSlug, groupSlug, onMembershipChanged,
}: {
  courseSlug: string;
  groupSlug: string;
  onMembershipChanged: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [adding, setAdding] = useState(false);  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api<GroupDetail>(`/courses/${courseSlug}/groups/${groupSlug}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load group");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [courseSlug, groupSlug]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await api(`/courses/${courseSlug}/groups/${groupSlug}/members`, {
        method: "POST",
        body: { username: username.trim() },
      });
      toast.success(`Added @${username}`);
      setUsername("");
      reload();
      onMembershipChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not add member");
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(memberUsername: string) {
    try {
      await api(`/courses/${courseSlug}/groups/${groupSlug}/members/${memberUsername}`, {
        method: "DELETE",
      });
      toast.success(`Removed @${memberUsername}`);
      reload();
      onMembershipChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not remove member");
    }
  }

  if (loading) return <div className="h-72 rounded-xl border border-border bg-card animate-pulse" />;
  if (error || !detail) return (
    <Empty icon={AlertCircle} title="Could not load this group" description={error ?? undefined} />
  );

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="font-semibold">{detail.title}</h3>
        <p className="text-xs text-muted-foreground">
          <code>{detail.slug}</code> · {detail.memberCount} member{detail.memberCount === 1 ? "" : "s"}
        </p>
      </div>

      <form onSubmit={addMember} className="px-5 py-4 border-b border-border flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Label htmlFor="add-member" className="sr-only">Username</Label>
          <Input
            id="add-member"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username (case-sensitive)"
          />
        </div>
        <Button type="submit" disabled={adding}>
          <UserPlus className="size-4 mr-1.5" />
          {adding ? "Adding…" : "Add member"}
        </Button>
      </form>

      <InviteCodeSection courseSlug={courseSlug} groupSlug={groupSlug} />

      {detail.members.length === 0 ? (
        <div className="px-5 py-8 text-sm text-center text-muted-foreground">
          No members yet — add one above.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {detail.members.map(m => (
            <li key={m.id} className="px-5 py-3 flex items-center gap-3">
              <Avatar className="size-8">
                <AvatarImage src={m.avatarUrl ?? undefined} alt={m.username} />
                <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{m.fullName || m.username}</div>
                <code className="text-[11px] text-muted-foreground">@{m.username}</code>
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{m.role}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeMember(m.username)}
                className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
              >
                <UserMinus className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Invite code panel (self-enrolment) ─────────────────────────────────── */

function InviteCodeSection({
  courseSlug, groupSlug,
}: {
  courseSlug: string;
  groupSlug: string;
}) {
  const [info, setInfo] = useState<GroupInviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "disable" | null>(null);
  const [searchParams] = useSearchParams();
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const joinBase = typeof window !== "undefined" ? window.location.origin : "";

  // Course-detail's "Invite code" button deep-links here with
  // `?focus=invite`. Defer the scroll one tick so the panel is mounted
  // and measurable; smooth scroll + `block: 'center'` avoids
  // half-hidden sections behind the sticky header.
  useEffect(() => {
    if (searchParams.get("focus") !== "invite") return;
    const t = setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(t);
  }, [searchParams, groupSlug]);

  async function load() {
    setLoading(true);
    try {
      const raw = await api<{ code: string | null; enabled: boolean }>(
        `/courses/${courseSlug}/groups/${groupSlug}/invite`,
      );
      setInfo(toInviteInfo(raw, joinBase));
    } catch (e) {
      // Treat as "no invite" rather than a blocking error — the rest of
      // the panel is still useful without this section.
      setInfo({ code: null, enabled: false, joinUrl: null });
      if (e instanceof ApiError && e.status !== 404) {
        toast.error(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // Lazy-load on panel mount / group change so we don't pay this round
  // trip for instructors just browsing member lists.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [courseSlug, groupSlug]);

  async function generate() {
    setBusy("generate");
    try {
      const raw = await api<{ code: string; enabled: boolean }>(
        `/courses/${courseSlug}/groups/${groupSlug}/invite`,
        { method: "POST" },
      );
      const next = toInviteInfo(raw, joinBase);
      setInfo(next);
      toast.success(info?.code ? "Regenerated invite code" : "Invite code generated");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not generate code");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("disable");
    try {
      const raw = await api<{ code: string | null; enabled: boolean }>(
        `/courses/${courseSlug}/groups/${groupSlug}/invite`,
        { method: "DELETE" },
      );
      setInfo(toInviteInfo(raw, joinBase));
      toast.success("Invite code disabled");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not disable code");
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Clipboard not available");
    }
  }

  return (
    <div ref={sectionRef} className="px-5 py-4 border-b border-border space-y-3">
      <div className="flex items-center gap-2">
        <Ticket className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Invite code</h4>
        {info?.code && info.enabled && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            Active
          </span>
        )}
        {info?.code && !info.enabled && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            Disabled
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-10 rounded bg-muted animate-pulse" />
      ) : !info?.code ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Generate a code and share it with students so they can self-enroll.
          </p>
          <Button size="sm" onClick={generate} disabled={busy !== null}>
            <Ticket className="size-3.5 mr-1.5" />
            {busy === "generate" ? "Generating…" : "Generate invite"}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-lg tracking-widest px-3 py-1.5 rounded-md bg-muted border border-border">
              {info.code}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(info.code!, "code")}
              aria-label="Copy code"
            >
              <Copy className="size-3.5 mr-1" /> Code
            </Button>
            {info.joinUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copy(info.joinUrl!, "join link")}
                aria-label="Copy join link"
              >
                <Copy className="size-3.5 mr-1" /> Link
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={generate}
              disabled={busy !== null}
            >
              <RotateCw className="size-3.5 mr-1.5" />
              {busy === "generate" ? "Regenerating…" : "Regenerate"}
            </Button>
            {info.enabled ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={disable}
                disabled={busy !== null}
                className="text-rose-500 hover:text-rose-500 hover:bg-rose-500/10"
              >
                <PowerOff className="size-3.5 mr-1.5" />
                {busy === "disable" ? "Disabling…" : "Disable"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={generate}
                disabled={busy !== null}
              >
                <Power className="size-3.5 mr-1.5" />
                Enable
              </Button>
            )}
          </div>
          {info.joinUrl && (
            <p className="text-[11px] text-muted-foreground break-all">
              Share: <code className="text-xs">{info.joinUrl}</code>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The server returns `{code, enabled}`; we compose the full join URL on
 * the client so we don't have to teach the backend where the SPA is
 * hosted (can vary per on-prem install).
 */
function toInviteInfo(
  raw: { code: string | null; enabled: boolean },
  origin: string,
): GroupInviteInfo {
  return {
    code: raw.code,
    enabled: raw.enabled,
    joinUrl: raw.code && origin
      ? `${origin}/join?code=${encodeURIComponent(raw.code)}`
      : null,
  };
}

/* ─── Dialogs ────────────────────────────────────────────────────────────── */

function CreateGroupDialog({
  open, onOpenChange, courseSlug, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseSlug: string;
  onCreated: (slug: string) => void;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api(`/courses/${courseSlug}/groups`, {
        method: "POST",
        body: { slug: slug.trim(), title: title.trim() },
      });
      toast.success(`Created group "${title}"`);
      const created = slug.trim();
      setSlug(""); setTitle("");
      onOpenChange(false);
      onCreated(created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create group");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 my-3">
            <div>
              <Label htmlFor="group-slug">Slug</Label>
              <Input
                id="group-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="bse-2406"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="group-title">Title</Label>
              <Input
                id="group-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="BSE-2406 (Spring 2026)"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameGroupDialog({
  target, onClose, courseSlug, onUpdated,
}: {
  target: GroupSummary | null;
  onClose: () => void;
  courseSlug: string;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setTitle(target?.title ?? ""); }, [target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSubmitting(true);
    try {
      await api(`/courses/${courseSlug}/groups/${target.slug}`, {
        method: "PUT",
        body: { title: title.trim() },
      });
      toast.success(`Renamed to "${title}"`);
      onClose();
      onUpdated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not rename");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <div className="my-3">
            <Label htmlFor="rename-group">Title</Label>
            <Input
              id="rename-group"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
