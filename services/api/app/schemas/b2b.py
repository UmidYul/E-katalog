from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

UUID_REF_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
UUIDRef = Annotated[str, StringConstraints(pattern=UUID_REF_PATTERN)]

B2BRole = Literal["owner", "admin", "marketing", "analyst", "finance", "operator"]
B2BMembershipStatus = Literal["active", "invited", "disabled"]
B2BOnboardingStatus = Literal["draft", "submitted", "review", "approved", "rejected"]
B2BFeedStatus = Literal["active", "paused", "error"]
B2BCampaignStatus = Literal["draft", "active", "paused", "archived"]
B2BInvoiceStatus = Literal["draft", "issued", "partially_paid", "paid", "overdue", "void"]
B2BPaymentStatus = Literal["pending", "succeeded", "failed", "refunded"]
B2BTicketStatus = Literal["open", "in_progress", "waiting_merchant", "resolved", "closed"]
B2BPartnerLeadStatus = Literal["submitted", "review", "approved", "rejected"]
B2BPartnerLeadProvisioningStatus = Literal["pending", "ready", "failed"]


class B2BOrganizationOut(BaseModel):
    id: str
    slug: str
    name: str
    legal_name: str | None = None
    tax_id: str | None = None
    status: str
    country_code: str
    default_currency: str
    website_url: str | None = None
    created_at: str
    updated_at: str


class B2BMembershipOut(BaseModel):
    id: str
    org_id: str
    user_id: str
    role: B2BRole
    status: B2BMembershipStatus
    created_at: str
    updated_at: str


class B2BMeOut(BaseModel):
    user_id: str
    memberships: list[B2BMembershipOut]
    organizations: list[B2BOrganizationOut]
    onboarding_status_by_org: dict[str, str]
    billing_status_by_org: dict[str, str]


class B2BOrganizationCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    legal_name: str | None = Field(default=None, max_length=255)
    tax_id: str | None = Field(default=None, max_length=64)
    website_url: str | None = Field(default=None, max_length=1024)


class B2BOrganizationCreateOut(BaseModel):
    organization: B2BOrganizationOut
    membership: B2BMembershipOut


class B2BOrgInviteIn(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    role: B2BRole = "operator"
    expires_in_days: int = Field(default=14, ge=1, le=90)


class B2BOrgInviteOut(BaseModel):
    id: str
    org_id: str
    email: str
    role: B2BRole
    status: str
    expires_at: str
    invite_token: str | None = None


class B2BOrgMemberPatchIn(BaseModel):
    role: B2BRole | None = None
    status: B2BMembershipStatus | None = None


class B2BOnboardingApplicationIn(BaseModel):
    org_id: UUIDRef
    company_name: str = Field(min_length=2, max_length=255)
    legal_address: str | None = Field(default=None, max_length=400)
    billing_email: str = Field(min_length=5, max_length=255)
    contact_name: str = Field(min_length=2, max_length=160)
    contact_phone: str | None = Field(default=None, max_length=64)
    website_domain: str | None = Field(default=None, max_length=255)
    tax_id: str | None = Field(default=None, max_length=64)
    payout_details: dict = Field(default_factory=dict)
    submit: bool = False


class B2BOnboardingApplicationOut(BaseModel):
    id: str
    org_id: str
    status: B2BOnboardingStatus
    company_name: str
    billing_email: str
    contact_name: str
    tax_id: str | None = None
    rejection_reason: str | None = None
    submitted_at: str | None = None
    reviewed_at: str | None = None
    created_at: str
    updated_at: str


class B2BKycDocumentIn(BaseModel):
    org_id: UUIDRef
    application_id: UUIDRef | None = None
    document_type: str = Field(min_length=2, max_length=64)
    storage_url: str = Field(min_length=8, max_length=2000)
    checksum: str | None = Field(default=None, max_length=128)


class B2BKycDocumentOut(BaseModel):
    id: str
    org_id: str
    application_id: str | None = None
    document_type: str
    storage_url: str
    status: str
    created_at: str


class B2BContractAcceptanceIn(BaseModel):
    org_id: UUIDRef
    contract_version: str = Field(min_length=1, max_length=64)


class B2BContractAcceptanceOut(BaseModel):
    id: str
    org_id: str
    contract_version: str
    accepted_by_user_id: str
    accepted_at: str


class B2BFeedCreateIn(BaseModel):
    org_id: UUIDRef
    store_id: UUIDRef
    source_type: str = Field(default="xml", min_length=2, max_length=32)
    source_url: str = Field(min_length=8, max_length=2000)
    schedule_cron: str = Field(default="0 */6 * * *", max_length=64)
    auth_config: dict = Field(default_factory=dict)
    is_active: bool = True


class B2BFeedOut(BaseModel):
    id: str
    org_id: str
    store_id: str
    source_type: str
    source_url: str
    schedule_cron: str
    status: str
    is_active: bool
    last_validated_at: str | None = None
    created_at: str
    updated_at: str


class B2BFeedValidateOut(BaseModel):
    feed_id: str
    run_id: str
    status: str
    quality_snapshot: dict


class B2BFeedRunOut(BaseModel):
    id: str
    feed_id: str
    status: str
    started_at: str | None = None
    finished_at: str | None = None
    total_items: int
    processed_items: int
    rejected_items: int
    error_summary: str | None = None


class B2BCampaignCreateIn(BaseModel):
    org_id: UUIDRef
    store_id: UUIDRef
    name: str = Field(min_length=2, max_length=180)
    daily_budget: float = Field(ge=0)
    monthly_budget: float = Field(ge=0)
    bid_default: float = Field(ge=0)
    bid_cap: float = Field(ge=0)
    pacing_mode: str = Field(default="even", pattern=r"^(even|aggressive)$")
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    targets: list[dict] = Field(default_factory=list)


class B2BCampaignPatchIn(BaseModel):
    status: B2BCampaignStatus | None = None
    daily_budget: float | None = Field(default=None, ge=0)
    monthly_budget: float | None = Field(default=None, ge=0)
    bid_default: float | None = Field(default=None, ge=0)
    bid_cap: float | None = Field(default=None, ge=0)
    pacing_mode: str | None = Field(default=None, pattern=r"^(even|aggressive)$")
    ends_at: datetime | None = None


class B2BCampaignOut(BaseModel):
    id: str
    org_id: str
    store_id: str
    name: str
    status: B2BCampaignStatus
    strategy: str
    daily_budget: float
    monthly_budget: float
    bid_default: float
    bid_cap: float
    pacing_mode: str
    starts_at: str | None = None
    ends_at: str | None = None
    created_at: str
    updated_at: str


class B2BAnalyticsOverviewOut(BaseModel):
    org_id: str
    period_days: int
    summary: dict
    series: list[dict]
    generated_at: str


class B2BAnalyticsOfferOut(BaseModel):
    offer_id: str
    clicks: int
    billable_clicks: int
    spend: float


class B2BAnalyticsAttributionOut(BaseModel):
    source_page: str
    placement: str
    clicks: int
    billable_clicks: int
    spend: float


class B2BBillingPlanOut(BaseModel):
    id: str
    code: str
    name: str
    monthly_fee: float
    included_clicks: int
    click_price: float
    currency: str
    limits: dict


class B2BBillingSubscribeIn(BaseModel):
    org_id: UUIDRef
    plan_code: str = Field(min_length=2, max_length=64)


class B2BSubscriptionOut(BaseModel):
    id: str
    org_id: str
    plan_id: str
    status: str
    starts_at: str
    renews_at: str | None = None
    created_at: str


class B2BInvoiceOut(BaseModel):
    id: str
    org_id: str
    invoice_number: str
    status: B2BInvoiceStatus
    currency: str
    total_amount: float
    paid_amount: float
    due_at: str | None = None
    issued_at: str | None = None
    paid_at: str | None = None
    created_at: str


class B2BInvoicePayIn(BaseModel):
    provider: str = Field(default="manual", min_length=2, max_length=32)
    amount: float | None = Field(default=None, ge=0)


class B2BInvoicePayOut(BaseModel):
    invoice_id: str
    payment_id: str
    status: B2BPaymentStatus
    redirect_url: str | None = None


class B2BActOut(BaseModel):
    id: str
    org_id: str
    invoice_id: str
    act_number: str
    status: str
    document_url: str | None = None
    issued_at: str | None = None
    signed_at: str | None = None
    created_at: str


class B2BSupportTicketCreateIn(BaseModel):
    org_id: UUIDRef
    subject: str = Field(min_length=3, max_length=200)
    category: str = Field(default="technical", min_length=2, max_length=64)
    priority: str = Field(default="normal", pattern=r"^(low|normal|high|critical)$")
    body: str = Field(min_length=3, max_length=5000)


class B2BSupportTicketOut(BaseModel):
    id: str
    org_id: str
    subject: str
    category: str
    priority: str
    status: B2BTicketStatus
    created_by_user_id: str
    created_at: str
    updated_at: str


class B2BPartnerLeadCreateIn(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
    legal_name: str | None = Field(default=None, max_length=255)
    brand_name: str | None = Field(default=None, max_length=255)
    tax_id: str | None = Field(default=None, max_length=64)
    website_url: str | None = Field(default=None, max_length=2000)
    contact_name: str = Field(min_length=2, max_length=160)
    contact_role: str | None = Field(default=None, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    phone: str = Field(min_length=5, max_length=64)
    telegram: str | None = Field(default=None, max_length=64)
    country_code: str = Field(default="UZ", min_length=2, max_length=2)
    city: str | None = Field(default=None, max_length=120)
    categories: list[str] = Field(default_factory=list)
    monthly_orders: int | None = Field(default=None, ge=0, le=100000000)
    avg_order_value: float | None = Field(default=None, ge=0)
    feed_url: str | None = Field(default=None, max_length=2000)
    logistics_model: str = Field(
        default="own_warehouse",
        pattern=r"^(own_warehouse|dropshipping|marketplace_fulfillment|hybrid)$",
    )
    warehouses_count: int | None = Field(default=None, ge=0, le=10000)
    marketplaces: list[str] = Field(default_factory=list)
    returns_policy: str | None = Field(default=None, max_length=2000)
    goals: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    accepts_terms: bool = Field(default=False)

    @field_validator("accepts_terms")
    @classmethod
    def validate_accepts_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("terms must be accepted")
        return value


class B2BPartnerLeadOut(BaseModel):
    id: str
    status: B2BPartnerLeadStatus
    company_name: str
    legal_name: str | None = None
    brand_name: str | None = None
    tax_id: str | None = None
    website_url: str | None = None
    contact_name: str
    contact_role: str | None = None
    email: str
    phone: str
    telegram: str | None = None
    country_code: str
    city: str | None = None
    categories: list[str]
    monthly_orders: int | None = None
    avg_order_value: float | None = None
    feed_url: str | None = None
    logistics_model: str
    warehouses_count: int | None = None
    marketplaces: list[str]
    returns_policy: str | None = None
    goals: str | None = None
    notes: str | None = None
    review_note: str | None = None
    reviewed_at: str | None = None
    tracking_token: str | None = None
    status_url: str | None = None
    provisioning_status: B2BPartnerLeadProvisioningStatus = "pending"
    provisioned_user_id: str | None = None
    provisioned_org_id: str | None = None
    onboarding_application_id: str | None = None
    provisioned_at: str | None = None
    provisioning_error: str | None = None
    welcome_email_sent_at: str | None = None
    created_at: str
    updated_at: str


class B2BGoRedirectOut(BaseModel):
    click_event_id: str
    destination_url: str
    billable: bool
    status: str


class AdminB2BOnboardingPatchIn(BaseModel):
    status: B2BOnboardingStatus
    rejection_reason: str | None = Field(default=None, max_length=500)


class AdminB2BDisputePatchIn(BaseModel):
    status: str = Field(pattern=r"^(open|review|accepted|rejected)$")
    resolution_note: str | None = Field(default=None, max_length=500)


class AdminB2BPlanUpsertIn(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]{1,63}$")
    name: str = Field(min_length=2, max_length=120)
    monthly_fee: float = Field(ge=0)
    included_clicks: int = Field(ge=0)
    click_price: float = Field(ge=0)
    limits: dict = Field(default_factory=dict)


class AdminB2BPartnerLeadPatchIn(BaseModel):
    status: B2BPartnerLeadStatus
    review_note: str | None = Field(default=None, max_length=2000)


class B2BPartnerLeadStatusOut(BaseModel):
    id: str
    status: B2BPartnerLeadStatus
    company_name: str
    email: str
    review_note: str | None = None
    reviewed_at: str | None = None
    provisioning_status: B2BPartnerLeadProvisioningStatus = "pending"
    provisioned_user_id: str | None = None
    provisioned_org_id: str | None = None
    onboarding_application_id: str | None = None
    provisioned_at: str | None = None
    provisioning_error: str | None = None
    welcome_email_sent_at: str | None = None
    seller_login_url: str | None = None
    seller_panel_url: str | None = None
    created_at: str
    updated_at: str
