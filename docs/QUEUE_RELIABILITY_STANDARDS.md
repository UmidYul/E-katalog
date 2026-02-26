# Queue Reliability Standards

Updated: 2026-02-26

## Scope

Applies to worker Celery queues in `services/worker/app/celery_app.py`.

## Reliability baseline

- [x] Explicit queue routing by domain (`scrape`, `normalize`, `dedupe`, `embedding`, `reindex`, `maintenance`).
- [x] Late acknowledgements enabled (`task_acks_late=true`).
- [x] Reject-on-worker-lost enabled (`task_reject_on_worker_lost=true`).
- [x] Retry/backoff enabled on heavy tasks (`autoretry_for`, `retry_backoff`, `retry_jitter`).
- [x] Broker visibility timeout configured.
- [x] Dead-letter queue reserved (`deadletter`).
- [x] Idempotency baseline exists for critical API write paths.

## Standards to enforce

1. Retry/backoff policy
- Use bounded exponential backoff with jitter.
- Keep per-task retry budgets explicit.
- Route poison workloads to dead-letter flow after retry exhaustion.

2. DLQ policy
- Every business-critical queue must define DLQ transfer condition.
- DLQ events must include task name, payload reference, failure reason, and retry count.

3. Stuck-job monitoring
- Emit queue depth, oldest-message age, and task runtime p95/p99.
- Alert thresholds:
  - warning: oldest message > 10 minutes (critical queues),
  - critical: oldest message > 30 minutes.

4. Idempotent handlers
- Task handlers that mutate DB state must remain idempotent across retries.
- Use deterministic keys/checkpoints (already used for canonical/embedding offset tasks).

## Operational follow-ups

- [ ] Add automated DLQ redrive tooling.
- [ ] Add per-queue stuck-job alerts in monitoring stack.
- [ ] Add periodic reliability drill (simulate worker crash and recover).
