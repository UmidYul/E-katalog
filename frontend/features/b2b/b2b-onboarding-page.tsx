"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, FileText, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useAcceptB2BContract,
  useB2BMe,
  useCreateB2BOrg,
  useInviteB2BMember,
  useSubmitB2BOnboarding,
  useUploadB2BOnboardingDocument,
} from "@/features/b2b/use-b2b";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function B2BOnboardingPage() {
  const meQuery = useB2BMe();
  const createOrgMutation = useCreateB2BOrg();
  const submitOnboardingMutation = useSubmitB2BOnboarding();
  const uploadDocMutation = useUploadB2BOnboardingDocument();
  const acceptContractMutation = useAcceptB2BContract();

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgLegalName, setOrgLegalName] = useState("");
  const [orgTaxId, setOrgTaxId] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [orgMessage, setOrgMessage] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [websiteDomain, setWebsiteDomain] = useState("");
  const [taxId, setTaxId] = useState("");
  const [payoutDetails, setPayoutDetails] = useState('{"bank_name":"","iban":"","beneficiary":""}');
  const [applicationId, setApplicationId] = useState("");
  const [onboardingMessage, setOnboardingMessage] = useState<string | null>(null);

  const [docType, setDocType] = useState("registration_certificate");
  const [docUrl, setDocUrl] = useState("");
  const [docChecksum, setDocChecksum] = useState("");
  const [docMessage, setDocMessage] = useState<string | null>(null);

  const [contractVersion, setContractVersion] = useState("2026-01");
  const [contractMessage, setContractMessage] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("operator");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState("14");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const organizations = useMemo(() => meQuery.data?.organizations ?? [], [meQuery.data?.organizations]);
  const selectedOrg = useMemo(() => organizations.find((item) => item.id === selectedOrgId) ?? organizations[0], [organizations, selectedOrgId]);
  const inviteMutation = useInviteB2BMember(selectedOrg?.id);

  useEffect(() => {
    if (!selectedOrgId && organizations.length) {
      setSelectedOrgId(organizations[0]?.id ?? "");
    }
  }, [selectedOrgId, organizations]);

  useEffect(() => {
    if (!selectedOrg) return;
    setCompanyName((current) => current || selectedOrg.name || "");
    setWebsiteDomain((current) => current || selectedOrg.website_url || "");
    setTaxId((current) => current || selectedOrg.tax_id || "");
  }, [selectedOrg]);

  if (meQuery.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading onboarding workspace...</div>;
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load onboarding data.
      </div>
    );
  }

  const onboardingStatus = selectedOrg ? meQuery.data.onboarding_status_by_org[selectedOrg.id] ?? "draft" : "draft";
  const billingStatus = selectedOrg ? meQuery.data.billing_status_by_org[selectedOrg.id] ?? "inactive" : "inactive";
  const memberships = selectedOrg ? meQuery.data.memberships.filter((item) => item.org_id === selectedOrg.id) : [];

  const createOrg = () => {
    setOrgMessage(null);
    const slug = slugify(orgSlug || orgName);
    if (!orgName.trim() || !slug) {
      setOrgMessage("Organization name and valid slug are required.");
      return;
    }
    createOrgMutation.mutate(
      {
        name: orgName.trim(),
        slug,
        legal_name: orgLegalName.trim() || undefined,
        tax_id: orgTaxId.trim() || undefined,
        website_url: orgWebsite.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          setSelectedOrgId(result.organization.id);
          setOrgName("");
          setOrgSlug("");
          setOrgLegalName("");
          setOrgTaxId("");
          setOrgWebsite("");
          setOrgMessage("Organization created.");
        },
        onError: () => setOrgMessage("Failed to create organization. Check slug uniqueness."),
      },
    );
  };

  const submitOnboarding = (submit: boolean) => {
    setOnboardingMessage(null);
    if (!selectedOrg) {
      setOnboardingMessage("Select organization first.");
      return;
    }

    let parsedPayout: Record<string, unknown> | undefined;
    try {
      parsedPayout = payoutDetails.trim() ? (JSON.parse(payoutDetails) as Record<string, unknown>) : {};
    } catch {
      setOnboardingMessage("Payout details must be valid JSON.");
      return;
    }

    submitOnboardingMutation.mutate(
      {
        org_id: selectedOrg.id,
        company_name: companyName.trim(),
        legal_address: legalAddress.trim() || undefined,
        billing_email: billingEmail.trim(),
        contact_name: contactName.trim(),
        contact_phone: contactPhone.trim() || undefined,
        website_domain: websiteDomain.trim() || undefined,
        tax_id: taxId.trim() || undefined,
        payout_details: parsedPayout,
        submit,
      },
      {
        onSuccess: (result) => {
          setApplicationId(result.id);
          setOnboardingMessage(submit ? "Application submitted for review." : "Draft saved.");
        },
        onError: () => setOnboardingMessage("Failed to save onboarding application."),
      },
    );
  };

  const uploadDocument = () => {
    setDocMessage(null);
    if (!selectedOrg) {
      setDocMessage("Select organization first.");
      return;
    }
    if (!docType.trim() || !docUrl.trim()) {
      setDocMessage("Document type and URL are required.");
      return;
    }

    uploadDocMutation.mutate(
      {
        org_id: selectedOrg.id,
        application_id: applicationId.trim() || undefined,
        document_type: docType.trim(),
        storage_url: docUrl.trim(),
        checksum: docChecksum.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDocUrl("");
          setDocChecksum("");
          setDocMessage("Document registered.");
        },
        onError: () => setDocMessage("Failed to upload document."),
      },
    );
  };

  const acceptContract = () => {
    setContractMessage(null);
    if (!selectedOrg) {
      setContractMessage("Select organization first.");
      return;
    }
    if (!contractVersion.trim()) {
      setContractMessage("Contract version is required.");
      return;
    }
    acceptContractMutation.mutate(
      { org_id: selectedOrg.id, contract_version: contractVersion.trim() },
      {
        onSuccess: () => setContractMessage("Contract accepted."),
        onError: () => setContractMessage("Failed to accept contract."),
      },
    );
  };

  const inviteMember = () => {
    setInviteMessage(null);
    if (!inviteEmail.trim()) {
      setInviteMessage("Invite email is required.");
      return;
    }
    inviteMutation.mutate(
      {
        email: inviteEmail.trim(),
        role: inviteRole,
        expires_in_days: Math.max(1, Math.min(90, Number(inviteExpiresInDays) || 14)),
      },
      {
        onSuccess: () => {
          setInviteEmail("");
          setInviteMessage("Invitation sent.");
        },
        onError: () => setInviteMessage("Failed to send invite."),
      },
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-sky-200/60 bg-gradient-to-br from-sky-100/60 via-cyan-50/60 to-emerald-100/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-sky-700" />
            Seller onboarding control room
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {organizations.length ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Organization</p>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs">
                onboarding: <span className="font-semibold">{onboardingStatus}</span>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs">
                billing: <span className="font-semibold">{billingStatus}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No organization yet. Create the first one below.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Storefront name" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
            <Input placeholder="Slug (auto if empty)" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
            <Input placeholder="Legal company name" value={orgLegalName} onChange={(event) => setOrgLegalName(event.target.value)} />
            <Input placeholder="Tax ID" value={orgTaxId} onChange={(event) => setOrgTaxId(event.target.value)} />
          </div>
          <Input placeholder="Website URL" value={orgWebsite} onChange={(event) => setOrgWebsite(event.target.value)} />
          {orgMessage ? <p className="text-xs text-muted-foreground">{orgMessage}</p> : null}
          <Button onClick={createOrg} disabled={createOrgMutation.isPending}>
            {createOrgMutation.isPending ? "Creating..." : "Create organization"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application and KYC form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Company name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            <Input placeholder="Billing email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} />
            <Input placeholder="Contact person" value={contactName} onChange={(event) => setContactName(event.target.value)} />
            <Input placeholder="Phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
            <Input placeholder="Website domain" value={websiteDomain} onChange={(event) => setWebsiteDomain(event.target.value)} />
            <Input placeholder="Tax ID" value={taxId} onChange={(event) => setTaxId(event.target.value)} />
          </div>
          <Input placeholder="Legal address" value={legalAddress} onChange={(event) => setLegalAddress(event.target.value)} />
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Payout details JSON</p>
            <Textarea rows={4} value={payoutDetails} onChange={(event) => setPayoutDetails(event.target.value)} />
          </div>
          {onboardingMessage ? <p className="text-xs text-muted-foreground">{onboardingMessage}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => submitOnboarding(false)} disabled={submitOnboardingMutation.isPending}>
              Save draft
            </Button>
            <Button onClick={() => submitOnboarding(true)} disabled={submitOnboardingMutation.isPending}>
              Submit for review
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Documents and contract
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Application ID (optional)" value={applicationId} onChange={(event) => setApplicationId(event.target.value)} />
            <Input placeholder="Document type" value={docType} onChange={(event) => setDocType(event.target.value)} />
            <Input placeholder="Storage URL" value={docUrl} onChange={(event) => setDocUrl(event.target.value)} />
            <Input placeholder="Checksum (optional)" value={docChecksum} onChange={(event) => setDocChecksum(event.target.value)} />
            {docMessage ? <p className="text-xs text-muted-foreground">{docMessage}</p> : null}
            <Button variant="secondary" onClick={uploadDocument} disabled={uploadDocMutation.isPending}>
              {uploadDocMutation.isPending ? "Uploading..." : "Register document"}
            </Button>

            <div className="mt-3 rounded-xl border border-border/70 bg-background/60 p-3">
              <p className="mb-2 text-sm font-semibold">Public offer acceptance</p>
              <Input value={contractVersion} onChange={(event) => setContractVersion(event.target.value)} />
              {contractMessage ? <p className="mt-2 text-xs text-muted-foreground">{contractMessage}</p> : null}
              <Button className="mt-2" onClick={acceptContract} disabled={acceptContractMutation.isPending}>
                {acceptContractMutation.isPending ? "Saving..." : "Accept contract"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              Team access and invites
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="analyst">Analyst</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={90}
                value={inviteExpiresInDays}
                onChange={(event) => setInviteExpiresInDays(event.target.value)}
                placeholder="Expires in days"
              />
            </div>
            {inviteMessage ? <p className="text-xs text-muted-foreground">{inviteMessage}</p> : null}
            <Button onClick={inviteMember} disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Sending..." : "Send invite"}
            </Button>

            <div className="mt-3 space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
              <p className="text-sm font-semibold">Current team</p>
              {memberships.length ? (
                memberships.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs">
                    <span>{member.user_id}</span>
                    <span className="font-semibold">
                      {member.role} / {member.status}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No memberships linked yet.</p>
              )}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Invite links are role-scoped and expire automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
