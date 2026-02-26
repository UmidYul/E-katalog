# Profile Future Features

Updated: 2026-02-26

This document keeps only real profile-related future gaps.
Already implemented API blocks were removed from planning sections.

## Implemented baseline

- Profile read/update via `/api/v1/users/me/profile`.
- Password change and active session management.
- 2FA setup/verify/disable.
- Notification preferences sync via API.
- Recently viewed cloud sync via API.
- OAuth login provider flow baseline.

## Real future gaps

1. `PROFILE-01` Security events timeline in account UI  
Scope: user-visible stream for login/password/2FA/session events with risk labels and filtering.
2. `PROFILE-02` Device trust management  
Scope: trusted-device UX, forced re-auth flow for risky devices, and per-device challenge policy.
3. `PROFILE-03` Recovery hardening  
Scope: backup/recovery codes rotation UI, recovery attempt limits, and suspicious recovery alerts.
4. `PROFILE-04` Data export and account privacy controls  
Scope: profile data export request/status/download and granular consent controls.
5. `PROFILE-05` Account deletion/self-service closure workflow  
Scope: multi-step closure flow with cooldown window, export reminder, and restore grace period.

## Notes

- Reviews/Q&A/forum roadmap is tracked separately in `docs/EK_UA_PARITY_MATRIX.md` (`PARITY-*`).
- Security platform controls (headers/CORS/secret rotation) are tracked in prod-readiness backlog docs.
