"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Clock3, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useB2BPartnerLeadStatus } from "@/features/b2b/use-b2b";

type Props = {
  initialLeadId?: string;
  initialToken?: string;
};

const statusLabel: Record<string, string> = {
  submitted: "Submitted",
  review: "In review",
  approved: "Approved",
  rejected: "Rejected",
};

export function PartnerStatusPage({ initialLeadId, initialToken }: Props) {
  const [leadIdInput, setLeadIdInput] = useState(initialLeadId ?? "");
  const [tokenInput, setTokenInput] = useState(initialToken ?? "");
  const [lookup, setLookup] = useState<{ leadId: string; token: string } | null>(
    initialLeadId && initialToken ? { leadId: initialLeadId, token: initialToken } : null,
  );

  const statusQuery = useB2BPartnerLeadStatus(lookup?.leadId, lookup?.token);

  const statusTone = useMemo(() => {
    const status = statusQuery.data?.status ?? "";
    if (status === "approved") return "text-emerald-700";
    if (status === "rejected") return "text-rose-700";
    return "text-amber-700";
  }, [statusQuery.data?.status]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const leadId = leadIdInput.trim();
    const token = tokenInput.trim();
    if (!leadId || !token) return;
    setLookup({ leadId, token });
  };

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Partner Application Status</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Lead ID" value={leadIdInput} onChange={(event) => setLeadIdInput(event.target.value)} />
              <Input placeholder="Tracking token" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} />
              <Button type="submit">Check</Button>
            </form>
          </CardContent>
        </Card>

        {statusQuery.isFetching ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Loading application status...
            </CardContent>
          </Card>
        ) : null}

        {statusQuery.isError ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-rose-700">
              <ShieldAlert className="h-4 w-4" />
              Status was not found. Verify lead ID and token.
            </CardContent>
          </Card>
        ) : null}

        {statusQuery.data ? (
          <Card>
            <CardHeader>
              <CardTitle className={statusTone}>
                {statusLabel[statusQuery.data.status] ?? statusQuery.data.status}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Company: {statusQuery.data.company_name}</p>
              <p>Email: {statusQuery.data.email}</p>
              <p>Provisioning: {statusQuery.data.provisioning_status}</p>
              {statusQuery.data.review_note ? <p>Review note: {statusQuery.data.review_note}</p> : null}
              {statusQuery.data.provisioning_error ? <p className="text-rose-700">Provisioning error: {statusQuery.data.provisioning_error}</p> : null}
              {statusQuery.data.seller_login_url ? (
                <a href={statusQuery.data.seller_login_url} className="inline-flex items-center gap-2 rounded-md border border-emerald-300 px-3 py-2 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Login to Seller Panel
                </a>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
