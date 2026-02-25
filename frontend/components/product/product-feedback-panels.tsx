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
  if (Number.isNaN(date.getTime())) return "Неизвестно";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const renderStars = (rating: number) =>
  Array.from({ length: 5 }).map((_, index) => (
    <Star key={index} className={`h-4 w-4 ${index < rating ? "fill-current text-warning" : "text-muted-foreground/40"}`} />
  ));

const normalizeApiError = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
};

const statusBadgeClass = (status: string) => {
  if (status === "published") return "border-success/40 bg-success/15 text-success";
  if (status === "rejected") return "border-destructive/40 bg-destructive/15 text-destructive";
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
      setStatus("Имя должно быть не короче 2 символов.");
      return;
    }
    if (normalizedComment.length < 10) {
      setStatus("Отзыв должен содержать минимум 10 символов.");
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
      setStatus("Отзыв отправлен на модерацию.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Не удалось отправить отзыв."));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Отзывы пользователей</CardTitle>
          <div className="flex items-center gap-2">
            <Badge>{summary.count} всего</Badge>
            <div className="flex items-center gap-1">
              {renderStars(Math.round(summary.avg))}
              <span className="text-sm font-medium">{summary.count ? summary.avg.toFixed(1) : "0.0"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Ваше имя</label>
              <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Имя" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Оценка (1-5)</label>
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
              <label className="text-xs font-medium text-muted-foreground">Плюсы</label>
              <Input value={pros} onChange={(event) => setPros(event.target.value)} placeholder="Что понравилось" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Минусы</label>
              <Input value={cons} onChange={(event) => setCons(event.target.value)} placeholder="Что можно улучшить" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Отзыв</label>
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Поделитесь опытом использования этого товара..." />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Отзывы синхронизируются с сервером и публикуются после модерации.</p>
            <Button size="sm" onClick={submitReview} disabled={createReview.isPending}>
              {createReview.isPending ? "Отправляем..." : "Отправить отзыв"}
            </Button>
          </div>
          {status ? <p className="text-xs text-primary">{status}</p> : null}
          {reviewsQuery.isError ? <p className="text-xs text-destructive">Не удалось загрузить отзывы.</p> : null}
        </CardContent>
      </Card>

      {reviewsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Загрузка отзывов...</CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Пока нет отзывов. Станьте первым.</CardContent>
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
                {review.pros || review.cons ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {review.pros ? (
                      <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                        <strong>Плюсы:</strong> {review.pros}
                      </p>
                    ) : null}
                    {review.cons ? (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        <strong>Минусы:</strong> {review.cons}
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
  const staffDisplayName = authUser?.full_name || (me.data as { full_name?: string } | undefined)?.full_name || "Сотрудник";

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
      setStatus("Имя должно быть не короче 2 символов.");
      return;
    }
    if (normalizedQuestion.length < 8) {
      setStatus("Вопрос должен содержать минимум 8 символов.");
      return;
    }

    try {
      await createQuestion.mutateAsync({
        author: normalizedAuthor,
        question: normalizedQuestion
      });
      setQuestionText("");
      setStatus("Вопрос отправлен на модерацию.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Не удалось отправить вопрос."));
    }
  };

  const onSubmitAnswer = async (questionId: string) => {
    if (!isStaff) {
      setStatus("Только сотрудники могут публиковать ответы.");
      return;
    }

    const draft = answerDrafts[questionId];
    const normalizedText = draft?.text?.trim() ?? "";
    if (normalizedText.length < 2) {
      setStatus("Ответ должен быть не короче 2 символов.");
      return;
    }

    try {
      await createAnswer.mutateAsync({
        questionId,
        text: normalizedText,
        is_official: Boolean(draft?.isOfficial)
      });
      setAnswerDrafts((prev) => ({ ...prev, [questionId]: { text: "", isOfficial: false } }));
      setStatus("Ответ опубликован.");
    } catch (error) {
      setStatus(normalizeApiError(error, "Не удалось отправить ответ."));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-primary" /> Вопросы и ответы
          </CardTitle>
          <Badge>{questions.length} вопросов</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Ваше имя</label>
            <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Имя" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Вопрос</label>
            <Textarea value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Спросите о батарее, камере, нагреве, доставке, гарантии..." />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Вопросы публикуются после модерации.</p>
            <Button size="sm" onClick={submitQuestion} disabled={createQuestion.isPending}>
              {createQuestion.isPending ? "Отправляем..." : "Отправить вопрос"}
            </Button>
          </div>
          {status ? <p className="text-xs text-primary">{status}</p> : null}
          {questionsQuery.isError ? <p className="text-xs text-destructive">Не удалось загрузить вопросы.</p> : null}
        </CardContent>
      </Card>

      {questionsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Загрузка вопросов...</CardContent>
        </Card>
      ) : questions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">Пока нет вопросов. Задайте первый.</CardContent>
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
                            {answer.is_official ? <Badge className="h-5 bg-primary text-primary-foreground">Официальный</Badge> : null}
                            <Badge className={statusBadgeClass(answer.status)}>{answer.status}</Badge>
                            <p className="text-xs text-muted-foreground">{formatDateTime(answer.created_at)}</p>
                          </div>
                          <p className="mt-1 text-sm">{answer.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Пока нет ответов.</p>
                  )}

                  {isStaff ? (
                    <div className="space-y-2 rounded-xl border border-border/70 bg-background/50 p-3">
                      <p className="text-xs text-muted-foreground">Ответ от {staffDisplayName} ({effectiveRole || "staff"})</p>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                        <Input
                          value={draft.text}
                          onChange={(event) => setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, text: event.target.value } }))}
                          placeholder="Напишите ответ..."
                        />
                        <Button size="sm" onClick={() => onSubmitAnswer(question.id)} disabled={createAnswer.isPending}>
                          {createAnswer.isPending ? "Отправляем..." : "Ответить"}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={draft.isOfficial}
                          onCheckedChange={(checked) => setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, isOfficial: checked } }))}
                        />
                        <span className="text-xs text-muted-foreground">Отметить как официальный ответ</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Ответы публикуются только сотрудниками поддержки.</p>
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
