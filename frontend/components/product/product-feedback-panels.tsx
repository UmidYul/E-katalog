"use client";

import { MessageCircleQuestion, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthMe } from "@/features/auth/use-auth";
import {
  useCreateProductQuestion,
  useCreateProductReview,
  useCreateQuestionAnswer,
  useProductQuestions,
  useProductReviews
} from "@/features/product/use-product-feedback";
import { authStore } from "@/store/auth.store";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const renderStars = (rating: number) =>
  Array.from({ length: 5 }).map((_, index) => (
    <Star key={index} className={`h-4 w-4 ${index < rating ? "fill-current text-amber-500" : "text-muted-foreground/40"}`} />
  ));

const normalizeApiError = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
};

const statusBadgeClass = (status: string) => {
  if (status === "published") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  return "bg-secondary/80";
};

export function ProductReviewsPanel({ productId }: { productId: string }) {
  const authUserStore = authStore((s) => s.user);
  const reviewsQuery = useProductReviews(productId);
  const createReview = useCreateProductReview(productId);
  const reviews = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data]);
  const [mounted, setMounted] = useState(false);

  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const authUser = mounted ? authUserStore : null;

  useEffect(() => {
    if (authUser?.full_name && !author.trim()) {
      setAuthor(authUser.full_name);
    }
  }, [authUser?.full_name, author]);

  const summary = useMemo(() => {
    if (!reviews.length) return { avg: 0, count: 0 };
    const avg = reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length;
    return { avg, count: reviews.length };
  }, [reviews]);

  const submitReview = async () => {
    const normalizedAuthor = author.trim();
    const normalizedComment = comment.trim();
    if (normalizedAuthor.length < 2) {
      setStatus("Name must be at least 2 characters.");
      return;
    }
    if (normalizedComment.length < 10) {
      setStatus("Review should be at least 10 characters.");
      return;
    }

    try {
      await createReview.mutateAsync({
        author: normalizedAuthor,
        rating,
        comment: normalizedComment,
        pros: pros.trim() || undefined,
        cons: cons.trim() || undefined
      });
      setPros("");
      setCons("");
      setComment("");
      setRating(5);
      setStatus("Review sent for moderation.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Failed to submit review."));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User reviews</CardTitle>
          <div className="flex items-center gap-2">
            <Badge>{summary.count} total</Badge>
            <div className="flex items-center gap-1">
              {renderStars(Math.round(summary.avg))}
              <span className="text-sm font-medium">{summary.count ? summary.avg.toFixed(1) : "0.0"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Your name</label>
              <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Name" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Rating (1-5)</label>
              <Input
                type="number"
                min={1}
                max={5}
                value={rating}
                onChange={(event) => setRating(Math.min(5, Math.max(1, Number(event.target.value) || 1)))}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Pros</label>
              <Input value={pros} onChange={(event) => setPros(event.target.value)} placeholder="What you liked" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cons</label>
              <Input value={cons} onChange={(event) => setCons(event.target.value)} placeholder="What can be better" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Review</label>
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Share your experience with this product..." />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Reviews are synced with backend and published after moderation.</p>
            <Button size="sm" onClick={submitReview} disabled={createReview.isPending}>
              {createReview.isPending ? "Submitting..." : "Submit review"}
            </Button>
          </div>
          {status ? <p className="text-xs text-primary">{status}</p> : null}
          {reviewsQuery.isError ? <p className="text-xs text-rose-600">Failed to load reviews.</p> : null}
        </CardContent>
      </Card>

      {reviewsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Loading reviews...</CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">No reviews yet. Be the first to leave feedback.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <Card key={review.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{review.author}</p>
                    <div className="flex items-center gap-1">{renderStars(review.rating)}</div>
                    <Badge className={statusBadgeClass(review.status)}>{review.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(review.created_at)}</p>
                </div>
                <p className="text-sm">{review.comment}</p>
                {(review.pros || review.cons) ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {review.pros ? (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        <strong>Pros:</strong> {review.pros}
                      </p>
                    ) : null}
                    {review.cons ? (
                      <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        <strong>Cons:</strong> {review.cons}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductQuestionsPanel({ productId }: { productId: string }) {
  const authUserStore = authStore((s) => s.user);
  const me = useAuthMe();
  const questionsQuery = useProductQuestions(productId);
  const createQuestion = useCreateProductQuestion(productId);
  const createAnswer = useCreateQuestionAnswer(productId);
  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const authUser = mounted ? authUserStore : null;

  const normalizeRole = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase().replace("-", "_");
  const roleFromStore = normalizeRole(authUser?.role);
  const roleFromMe = normalizeRole((me.data as { role?: string } | undefined)?.role);
  const effectiveRole = roleFromStore || roleFromMe;
  const isStaff = effectiveRole === "admin" || effectiveRole === "moderator" || effectiveRole === "seller_support";
  const staffDisplayName = authUser?.full_name || (me.data as { full_name?: string } | undefined)?.full_name || "Staff";

  const [author, setAuthor] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, { text: string; isOfficial: boolean }>>({});

  useEffect(() => {
    const fallbackName = authUser?.full_name || (me.data as { full_name?: string } | undefined)?.full_name;
    if (fallbackName && !author.trim()) {
      setAuthor(fallbackName);
    }
  }, [authUser?.full_name, me.data, author]);

  const submitQuestion = async () => {
    const normalizedAuthor = author.trim();
    const normalizedQuestion = questionText.trim();
    if (normalizedAuthor.length < 2) {
      setStatus("Name must be at least 2 characters.");
      return;
    }
    if (normalizedQuestion.length < 8) {
      setStatus("Question should be at least 8 characters.");
      return;
    }

    try {
      await createQuestion.mutateAsync({
        author: normalizedAuthor,
        question: normalizedQuestion
      });
      setQuestionText("");
      setStatus("Question sent for moderation.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Failed to submit question."));
    }
  };

  const onSubmitAnswer = async (questionId: string) => {
    if (!isStaff) {
      setStatus("Only staff can post answers.");
      return;
    }

    const draft = answerDrafts[questionId];
    const normalizedText = draft?.text?.trim() ?? "";
    if (normalizedText.length < 2) {
      setStatus("Answer should be at least 2 characters.");
      return;
    }

    try {
      await createAnswer.mutateAsync({
        questionId,
        text: normalizedText,
        is_official: Boolean(draft?.isOfficial)
      });
      setAnswerDrafts((prev) => ({ ...prev, [questionId]: { text: "", isOfficial: false } }));
      setStatus("Answer published.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Failed to submit answer."));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-primary" /> Ask a question
          </CardTitle>
          <Badge>{questions.length} questions</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Your name</label>
            <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Name" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Question</label>
            <Textarea value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Ask about battery life, camera, heat, delivery, warranty..." />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Questions are published after moderation.</p>
            <Button size="sm" onClick={submitQuestion} disabled={createQuestion.isPending}>
              {createQuestion.isPending ? "Submitting..." : "Submit question"}
            </Button>
          </div>
          {status ? <p className="text-xs text-primary">{status}</p> : null}
          {questionsQuery.isError ? <p className="text-xs text-rose-600">Failed to load questions.</p> : null}
        </CardContent>
      </Card>

      {questionsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Loading questions...</CardContent>
        </Card>
      ) : questions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">No questions yet. Ask the first one.</CardContent>
        </Card>
        ) : (
          <div className="space-y-3">
            {questions.map((question) => {
              const draft = answerDrafts[question.id] ?? { text: "", isOfficial: false };
              return (
                <Card key={question.id}>
                  <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{question.author}</p>
                      <Badge className={statusBadgeClass(question.status)}>{question.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(question.created_at)}</p>
                  </div>
                  <p className="text-sm">{question.question}</p>

                  {question.answers.length ? (
                    <div className="space-y-2">
                      {question.answers.map((answer) => (
                        <div key={answer.id} className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold">{answer.author}</p>
                            {answer.is_official ? <Badge className="h-5 bg-primary text-primary-foreground">Official</Badge> : null}
                            <Badge className={statusBadgeClass(answer.status)}>{answer.status}</Badge>
                            <p className="text-xs text-muted-foreground">{formatDateTime(answer.created_at)}</p>
                          </div>
                          <p className="mt-1 text-sm">{answer.text}</p>
                        </div>
                      ))}
                    </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No answers yet.</p>
                    )}

                    {isStaff ? (
                      <div className="space-y-2 rounded-xl border border-border/70 bg-background/50 p-3">
                        <p className="text-xs text-muted-foreground">Reply as {staffDisplayName} ({effectiveRole || "staff"})</p>
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Input
                            value={draft.text}
                            onChange={(event) =>
                              setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, text: event.target.value } }))
                            }
                            placeholder="Write an answer..."
                          />
                          <Button size="sm" onClick={() => onSubmitAnswer(question.id)} disabled={createAnswer.isPending}>
                            {createAnswer.isPending ? "Sending..." : "Answer"}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={draft.isOfficial}
                            onCheckedChange={(checked) =>
                              setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, isOfficial: checked } }))
                            }
                          />
                          <span className="text-xs text-muted-foreground">Mark as official answer</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Answers are published by support staff only.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}
