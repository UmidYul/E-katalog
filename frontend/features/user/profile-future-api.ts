type PlannedNotificationPreferences = {
  price_drop_alerts: boolean;
  stock_alerts: boolean;
  weekly_digest: boolean;
  marketing_emails: boolean;
  channels: {
    email: boolean;
    telegram: boolean;
  };
};

type PlannedSecuritySession = {
  id: string;
  device: string;
  ip_address: string;
  location: string;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};

const futureFeatureError = (feature: string) =>
  new Error(`${feature} is planned but not implemented because backend endpoints are unavailable.`);

export const plannedProfileApi = {
  async changePassword(_: { current_password: string; new_password: string }): Promise<{ ok: boolean }> {
    throw futureFeatureError("POST /auth/change-password");
  },
  async listSessions(): Promise<PlannedSecuritySession[]> {
    throw futureFeatureError("GET /auth/sessions");
  },
  async revokeSession(_: { session_id: string }): Promise<{ ok: boolean }> {
    throw futureFeatureError("DELETE /auth/sessions/{session_id}");
  },
  async getNotificationPreferences(): Promise<PlannedNotificationPreferences> {
    throw futureFeatureError("GET /users/me/notification-preferences");
  },
  async updateNotificationPreferences(_: PlannedNotificationPreferences): Promise<PlannedNotificationPreferences> {
    throw futureFeatureError("PATCH /users/me/notification-preferences");
  },
  async setupTwoFactor(): Promise<{ secret: string; qr_svg: string; recovery_codes: string[] }> {
    throw futureFeatureError("POST /auth/2fa/setup");
  }
};

export type { PlannedNotificationPreferences, PlannedSecuritySession };
