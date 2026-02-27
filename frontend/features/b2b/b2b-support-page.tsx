"use client";

import { useMemo, useState } from "react";
import { Clock3, LifeBuoy, MessageSquareWarning, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useB2BMe, useB2BTickets, useCreateB2BTicket } from "@/features/b2b/use-b2b";

const statusOptions = ["all", "open", "in_progress", "waiting_merchant", "resolved", "closed"] as const;

export function B2BSupportPage() {
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("all");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("technical");
  const [priority, setPriority] = useState("normal");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const meQuery = useB2BMe();
  const orgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const ticketsQuery = useB2BTickets(orgId, status === "all" ? undefined : status);
  const createTicketMutation = useCreateB2BTicket(orgId);

  if (meQuery.isLoading || ticketsQuery.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading support center...</div>;
  }

  if (meQuery.isError || ticketsQuery.isError || !meQuery.data || !orgId) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load support center.
      </div>
    );
  }

  const tickets = ticketsQuery.data ?? [];
  const openCount = tickets.filter((ticket) => ticket.status === "open").length;
  const inProgressCount = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const waitingMerchantCount = tickets.filter((ticket) => ticket.status === "waiting_merchant").length;
  const criticalCount = tickets.filter((ticket) => ticket.priority === "critical").length;

  const createTicket = () => {
    setMessage(null);
    if (!subject.trim() || !body.trim()) {
      setMessage("Subject and details are required.");
      return;
    }

    createTicketMutation.mutate(
      {
        subject: subject.trim(),
        category,
        priority,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          setSubject("");
          setBody("");
          setMessage("Support ticket created.");
        },
        onError: () => setMessage("Failed to create support ticket."),
      },
    );
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LifeBuoy className="h-4 w-4 text-primary" />
              Open
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-primary" />
              In progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{inProgressCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquareWarning className="h-4 w-4 text-primary" />
              Waiting merchant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{waitingMerchantCount}</p>
          </CardContent>
        </Card>
        <Card className={criticalCount > 0 ? "border-amber-300/70" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Critical tickets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{criticalCount}</p>
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card className="border-sky-300/60 bg-gradient-to-br from-sky-100/55 to-cyan-100/45">
          <CardHeader>
            <CardTitle>Create support ticket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="campaign">Campaign</SelectItem>
                  <SelectItem value="feed">Feed</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe issue details, impacted object IDs, and expected resolution."
            />
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
            <Button onClick={createTicket} disabled={createTicketMutation.isPending}>
              {createTicketMutation.isPending ? "Submitting..." : "Submit ticket"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Ticket queue</CardTitle>
            <div className="w-44">
              <Select value={status} onValueChange={(value) => setStatus(value as (typeof statusOptions)[number])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {tickets.length ? (
              tickets.map((ticket) => (
                <article key={ticket.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{ticket.subject}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{ticket.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/80 px-2 py-0.5">{ticket.category}</span>
                    <span className="rounded-full border border-border/80 px-2 py-0.5">{ticket.priority}</span>
                    <span>{new Date(ticket.updated_at).toLocaleString("ru-RU")}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{ticket.id}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No tickets for selected filter.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
