# Product Feedback Future Features

This document tracks post-MVP roadmap for product feedback after base server sync was implemented.

## Implemented (February 23, 2026)

- Product page now includes tabs:
  - Offers
  - Specifications
  - Reviews
  - Q&A
- Reviews and Q&A are functional in UI and synced via API:
  - `GET /api/v1/products/{product_id}/reviews`
  - `POST /api/v1/products/{product_id}/reviews`
  - `GET /api/v1/products/{product_id}/questions`
  - `POST /api/v1/products/{product_id}/questions`
  - `POST /api/v1/products/questions/{question_id}/answers`
  - `POST /api/v1/products/reviews/{review_id}/moderation`
  - `POST /api/v1/products/questions/{question_id}/moderation`
- Admin moderation queue API and dashboard page:
  - `GET /api/v1/products/moderation/queue?status=...&kind=...&limit=...&offset=...`
  - Frontend page: `/dashboard/feedback` with status/type filters and moderation actions.

## Current Behavior Notes

- New reviews and questions are created with `pending` status and require moderation to become visible on product page.
- Answers can be created only by staff roles (`admin`, `moderator`, `seller_support`) and are currently created with `published` status.
- `is_official` flag is staff-only.
- New registrations use role `user` by default; `seller_support` can be assigned from admin user details page.
- Moderation endpoints are available for admin role.
- Frontend reads and writes feedback through backend and invalidates queries on mutation.

## Planned Next API

- `POST /api/v1/products/reviews/{review_id}/votes` (helpful/not helpful)
- `POST /api/v1/products/reviews/{review_id}/report`
- `POST /api/v1/products/questions/{question_id}/report`
- `POST /api/v1/products/answers/{answer_id}/pin`

## Planned Extended Review Model

```json
{
  "id": "rev_123",
  "product_id": 101,
  "user_id": 42,
  "author": "John",
  "rating": 5,
  "comment": "Great battery life and camera.",
  "pros": "Battery, display",
  "cons": "Heats under load",
  "is_verified_purchase": true,
  "status": "published",
  "helpful_votes": 0,
  "not_helpful_votes": 0,
  "created_at": "2026-02-23T14:00:00Z",
  "updated_at": "2026-02-23T14:00:00Z"
}
```

## Planned Question Model

```json
{
  "id": "q_456",
  "product_id": 101,
  "user_id": 44,
  "author": "Anna",
  "question": "Does it support eSIM?",
  "status": "published",
  "created_at": "2026-02-23T15:10:00Z",
  "answers": [
    {
      "id": "a_789",
      "author": "Support Team",
      "text": "Yes, one eSIM profile is supported.",
      "is_official": true,
      "created_at": "2026-02-23T15:30:00Z"
    }
  ]
}
```

## Next Client Tasks

1. Add helpful-vote UI for reviews.
2. Add report actions for reviews and questions.
3. Add pin/unpin actions for official answers.
4. Add optimistic updates for votes/reports.
5. Add pagination for high-volume products.
