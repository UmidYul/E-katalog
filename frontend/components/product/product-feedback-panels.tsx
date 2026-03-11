"use client";

import { MessageCircleQuestion, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
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
  usePinProductAnswer,
  useProductQuestions,
  useProductReviews,
  useReportProductQuestion,
  useReportProductReview,
  useVoteProductReview
} from "@/features/product/use-product-feedback";
import { formatDateTime as formatLocalizedDateTime } from "@/lib/utils/format";
import { authStore } from "@/store/auth.store";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatLocalizedDateTime(date);
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
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

  const PAGE_SIZE = 20;
  const authUserStore = authStore((s) => s.user);
  const [reviewsLimit, setReviewsLimit] = useState(PAGE_SIZE);
  const reviewsQuery = useProductReviews(productId, { limit: reviewsLimit, offset: 0 });
  const createReview = useCreateProductReview(productId);
  const voteReview = useVoteProductReview(productId);
  const reportReview = useReportProductReview(productId);
  const reviews = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data]);
  const hasMoreReviews = reviews.length >= reviewsLimit;
  const [mounted, setMounted] = useState(false);
  const [reportedReviewIds, setReportedReviewIds] = useState<Record<string, boolean>>({});

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
      setStatus(tr("Имя должно быть не короче 2 символов.", "Исм камида 2 белгидан иборат бўлиши керак."));
      return;
    }
    if (normalizedComment.length < 10) {
      setStatus(tr("Отзыв должен содержать минимум 10 символов.", "Изоҳ камида 10 белги бўлиши керак."));
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
      setStatus(tr("Отзыв отправлен на модерацию.", "Изоҳ модерацияга юборилди."));
    } catch (error) {
      setStatus(normalizeApiError(error, tr("Не удалось отправить отзыв.", "Изоҳни юбориб бўлмади.")));
    }
  };

  const onVoteReview = async (reviewId: string, helpful: boolean) => {
    try {
      await voteReview.mutateAsync({ reviewId, helpful });
      setStatus(helpful ? tr("Голос за полезность учтён.", "Фойдали деб овоз қабул қилинди.") : tr("Отметка «не полезно» учтена.", "«Фойдали эмас» белгиси қабул қилинди."));
    } catch (error) {
      setStatus(normalizeApiError(error, tr("Не удалось отправить голос.", "Овоз юбориб бўлмади.")));
    }
  };

  const onReportReview = async (reviewId: string) => {
    const reason = window.prompt(
      tr("Причина жалобы на отзыв (минимум 3 символа):", "Изоҳга шикоят сабаби (камида 3 белги):"),
      tr("Нарушение правил", "Қоидалар бузилиши")
    ) ?? "";
    if (!reason.trim()) return;
    setReportedReviewIds((prev) => ({ ...prev, [reviewId]: true }));
    setStatus(tr("Жалоба на отзыв отправлена.", "Изоҳга шикоят юборилди."));
    try {
      await reportReview.mutateAsync({ reviewId, reason });
    } catch (error) {
      setReportedReviewIds((prev) => ({ ...prev, [reviewId]: false }));
      setStatus(normalizeApiError(error, tr("Не удалось отправить жалобу.", "Шикоятни юбориб бўлмади.")));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{tr("Отзывы пользователей", "Фойдаланувчи изоҳлари")}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge>{tr(`${summary.count} всего`, `${summary.count} жами`)}</Badge>
            <div className="flex items-center gap-1">
              {renderStars(Math.round(summary.avg))}
              <span className="text-sm font-medium">{summary.count ? summary.avg.toFixed(1) : "0.0"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{tr("Ваше имя", "Исмингиз")}</label>
              <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={tr("Имя", "Исм")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{tr("Оценка (1-5)", "Баҳо (1-5)")}</label>
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
              <label className="text-xs font-medium text-muted-foreground">{tr("Плюсы", "Афзалликлар")}</label>
              <Input value={pros} onChange={(event) => setPros(event.target.value)} placeholder={tr("Что понравилось", "Нима ёқди")} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{tr("Минусы", "Камчиликлар")}</label>
              <Input value={cons} onChange={(event) => setCons(event.target.value)} placeholder={tr("Что можно улучшить", "Нимани яхшилаш мумкин")} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{tr("Отзыв", "Изоҳ")}</label>
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={tr("Поделитесь опытом использования этого товара...", "Бу товардан фойдаланиш тажрибангиз билан ўртоқлашинг...")} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{tr("Отзывы синхронизируются с сервером и публикуются после модерации.", "Изоҳлар сервер билан синхронланади ва модерациядан кейин чиқарилади.")}</p>
            <Button size="sm" onClick={submitReview} disabled={createReview.isPending}>
              {createReview.isPending ? tr("Отправляем...", "Юборилмоқда...") : tr("Отправить отзыв", "Изоҳ юбориш")}
            </Button>
          </div>
          {status ? <p className="text-xs text-accent">{status}</p> : null}
          {reviewsQuery.isError ? <p className="text-xs text-destructive">{tr("Не удалось загрузить отзывы.", "Изоҳларни юклаб бўлмади.")}</p> : null}
        </CardContent>
      </Card>

      {reviewsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">{tr("Загрузка отзывов...", "Изоҳлар юкланмоқда...")}</CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">{tr("Пока нет отзывов. Станьте первым.", "Ҳозирча изоҳлар йўқ. Биринчи бўлиб ёзинг.")}</CardContent>
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
                    {review.is_verified_purchase ? <Badge className="border-accent/30 bg-accent/10 text-accent">{tr("Покупка подтверждена", "Харид тасдиқланган")}</Badge> : null}
                    <Badge className={statusBadgeClass(review.status)}>{review.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(review.created_at)}</p>
                </div>
                <p className="text-sm">{review.comment}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => onVoteReview(review.id, true)} disabled={voteReview.isPending}>
                    {tr("Полезно", "Фойдали")} ({review.helpful_votes ?? 0})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onVoteReview(review.id, false)} disabled={voteReview.isPending}>
                    {tr("Не полезно", "Фойдали эмас")} ({review.not_helpful_votes ?? 0})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onReportReview(review.id)}
                    disabled={reportReview.isPending || Boolean(reportedReviewIds[review.id])}
                  >
                    {reportedReviewIds[review.id] ? tr("Жалоба отправлена", "Шикоят юборилди") : tr("Пожаловаться", "Шикоят қилиш")}
                  </Button>
                </div>
                {review.pros || review.cons ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {review.pros ? (
                      <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                        <strong>{tr("Плюсы", "Афзалликлар")}:</strong> {review.pros}
                      </p>
                    ) : null}
                    {review.cons ? (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        <strong>{tr("Минусы", "Камчиликлар")}:</strong> {review.cons}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {reviews.length > 0 && hasMoreReviews ? (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => setReviewsLimit((prev) => prev + PAGE_SIZE)} disabled={reviewsQuery.isFetching}>
            {reviewsQuery.isFetching ? tr("Загрузка...", "Юкланмоқда...") : tr("Загрузить ещё отзывы", "Яна изоҳларни юклаш")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProductQuestionsPanel({ productId }: { productId: string }) {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

  const PAGE_SIZE = 20;
  const authUserStore = authStore((s) => s.user);
  const me = useAuthMe();
  const [questionsLimit, setQuestionsLimit] = useState(PAGE_SIZE);
  const questionsQuery = useProductQuestions(productId, { limit: questionsLimit, offset: 0 });
  const createQuestion = useCreateProductQuestion(productId);
  const createAnswer = useCreateQuestionAnswer(productId);
  const reportQuestion = useReportProductQuestion(productId);
  const pinAnswer = usePinProductAnswer(productId);
  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const hasMoreQuestions = questions.length >= questionsLimit;
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
  const staffDisplayName = authUser?.full_name || (me.data as { full_name?: string } | undefined)?.full_name || tr("Сотрудник", "Ходим");

  const [author, setAuthor] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, { text: string; isOfficial: boolean }>>({});
  const [reportedQuestionIds, setReportedQuestionIds] = useState<Record<string, boolean>>({});

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
      setStatus(tr("Имя должно быть не короче 2 символов.", "Исм камида 2 белгидан иборат бўлиши керак."));
      return;
    }
    if (normalizedQuestion.length < 8) {
      setStatus(tr("Вопрос должен содержать минимум 8 символов.", "Савол камида 8 белгидан иборат бўлиши керак."));
      return;
    }

    try {
      await createQuestion.mutateAsync({
        author: normalizedAuthor,
        question: normalizedQuestion
      });
      setQuestionText("");
      setStatus(tr("Вопрос отправлен на модерацию.", "Савол модерацияга юборилди."));
    } catch (error) {
      setStatus(normalizeApiError(error, tr("Не удалось отправить вопрос.", "Саволни юбориб бўлмади.")));
    }
  };

  const onSubmitAnswer = async (questionId: string) => {
    if (!isStaff) {
      setStatus(tr("Только сотрудники могут публиковать ответы.", "Фақат ходимлар жавоб жойлаши мумкин."));
      return;
    }

    const draft = answerDrafts[questionId];
    const normalizedText = draft?.text?.trim() ?? "";
    if (normalizedText.length < 2) {
      setStatus(tr("Ответ должен быть не короче 2 символов.", "Жавоб камида 2 белгидан иборат бўлиши керак."));
      return;
    }

    try {
      await createAnswer.mutateAsync({
        questionId,
        text: normalizedText,
        is_official: Boolean(draft?.isOfficial)
      });
      setAnswerDrafts((prev) => ({ ...prev, [questionId]: { text: "", isOfficial: false } }));
      setStatus(tr("Ответ опубликован.", "Жавоб чоп этилди."));
    } catch (error) {
      setStatus(normalizeApiError(error, tr("Не удалось отправить ответ.", "Жавобни юбориб бўлмади.")));
    }
  };

  const onReportQuestion = async (questionId: string) => {
    const reason = window.prompt(
      tr("Причина жалобы на вопрос (минимум 3 символа):", "Саволга шикоят сабаби (камида 3 белги):"),
      tr("Нарушение правил", "Қоидалар бузилиши")
    ) ?? "";
    if (!reason.trim()) return;
    setReportedQuestionIds((prev) => ({ ...prev, [questionId]: true }));
    setStatus(tr("Жалоба на вопрос отправлена.", "Саволга шикоят юборилди."));
    try {
      await reportQuestion.mutateAsync({ questionId, reason });
    } catch (error) {
      setReportedQuestionIds((prev) => ({ ...prev, [questionId]: false }));
      setStatus(normalizeApiError(error, tr("Не удалось отправить жалобу.", "Шикоятни юбориб бўлмади.")));
    }
  };

  const onTogglePinAnswer = async (answerId: string, pinned: boolean) => {
    if (!isStaff) {
      setStatus(tr("Только сотрудники могут закреплять ответы.", "Фақат ходимлар жавобни мустаҳкамлаши мумкин."));
      return;
    }
    try {
      await pinAnswer.mutateAsync({ answerId, pinned });
      setStatus(pinned ? tr("Ответ закреплён.", "Жавоб мустаҳкамланди.") : tr("Закрепление ответа снято.", "Жавобни мустаҳкамлаш бекор қилинди."));
    } catch (error) {
      setStatus(normalizeApiError(error, tr("Не удалось изменить закрепление ответа.", "Жавоб мустаҳкамлаш ҳолатини ўзгартириб бўлмади.")));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-accent" /> {tr("Вопросы и ответы", "Савол ва жавоблар")}
          </CardTitle>
          <Badge>{tr(`${questions.length} вопросов`, `${questions.length} та савол`)}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{tr("Ваше имя", "Исмингиз")}</label>
            <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={tr("Имя", "Исм")} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{tr("Вопрос", "Савол")}</label>
            <Textarea
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              placeholder={tr("Спросите о батарее, камере, нагреве, доставке, гарантии...", "Батарея, камера, қизиш, етказиб бериш, кафолат ҳақида сўранг...")}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{tr("Вопросы публикуются после модерации.", "Саволлар модерациядан кейин чоп этилади.")}</p>
            <Button size="sm" onClick={submitQuestion} disabled={createQuestion.isPending}>
              {createQuestion.isPending ? tr("Отправляем...", "Юборилмоқда...") : tr("Отправить вопрос", "Савол юбориш")}
            </Button>
          </div>
          {status ? <p className="text-xs text-accent">{status}</p> : null}
          {questionsQuery.isError ? <p className="text-xs text-destructive">{tr("Не удалось загрузить вопросы.", "Саволларни юклаб бўлмади.")}</p> : null}
        </CardContent>
      </Card>

      {questionsQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">{tr("Загрузка вопросов...", "Саволлар юкланмоқда...")}</CardContent>
        </Card>
      ) : questions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">{tr("Пока нет вопросов. Задайте первый.", "Ҳозирча саволлар йўқ. Биринчи саволни беринг.")}</CardContent>
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
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{formatDateTime(question.created_at)}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onReportQuestion(question.id)}
                        disabled={reportQuestion.isPending || Boolean(reportedQuestionIds[question.id])}
                      >
                        {reportedQuestionIds[question.id] ? tr("Жалоба отправлена", "Шикоят юборилди") : tr("Пожаловаться", "Шикоят қилиш")}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm">{question.question}</p>

                  {question.answers.length ? (
                    <div className="space-y-2">
                      {question.answers.map((answer) => (
                        <div key={answer.id} className="rounded-xl border border-border bg-card px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold">{answer.author}</p>
                            {answer.is_official ? <Badge className="h-5 bg-accent text-white">{tr("Официальный", "Расмий")}</Badge> : null}
                            {answer.is_pinned ? <Badge className="h-5 border-warning/40 bg-warning/15 text-warning">{tr("Закреплён", "Мустаҳкамланган")}</Badge> : null}
                            <Badge className={statusBadgeClass(answer.status)}>{answer.status}</Badge>
                            <p className="text-xs text-muted-foreground">{formatDateTime(answer.created_at)}</p>
                            {isStaff ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onTogglePinAnswer(answer.id, !Boolean(answer.is_pinned))}
                                disabled={pinAnswer.isPending}
                              >
                                {answer.is_pinned ? tr("Открепить", "Ечиш") : tr("Закрепить", "Мустаҳкамлаш")}
                              </Button>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm">{answer.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr("Пока нет ответов.", "Ҳозирча жавоблар йўқ.")}</p>
                  )}

                  {isStaff ? (
                    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                      <p className="text-xs text-muted-foreground">
                        {tr("Ответ от", "Жавоб")} {staffDisplayName} ({effectiveRole || tr("staff", "ходим")})
                      </p>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                        <Input
                          value={draft.text}
                          onChange={(event) => setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, text: event.target.value } }))}
                          placeholder={tr("Напишите ответ...", "Жавоб ёзинг...")}
                        />
                        <Button size="sm" onClick={() => onSubmitAnswer(question.id)} disabled={createAnswer.isPending}>
                          {createAnswer.isPending ? tr("Отправляем...", "Юборилмоқда...") : tr("Ответить", "Жавоб бериш")}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={draft.isOfficial}
                          onCheckedChange={(checked) => setAnswerDrafts((prev) => ({ ...prev, [question.id]: { ...draft, isOfficial: checked } }))}
                        />
                        <span className="text-xs text-muted-foreground">{tr("Отметить как официальный ответ", "Расмий жавоб деб белгилаш")}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tr("Ответы публикуются только сотрудниками поддержки.", "Жавоблар фақат қўллаб-қувватлаш ходимлари томонидан чоп этилади.")}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {questions.length > 0 && hasMoreQuestions ? (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => setQuestionsLimit((prev) => prev + PAGE_SIZE)} disabled={questionsQuery.isFetching}>
            {questionsQuery.isFetching ? tr("Загрузка...", "Юкланмоқда...") : tr("Загрузить ещё вопросы", "Яна саволларни юклаш")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
