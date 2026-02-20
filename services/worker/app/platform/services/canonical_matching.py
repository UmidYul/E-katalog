from __future__ import annotations

import math
import re
import tracemalloc
import hashlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import perf_counter
from typing import Iterable

from app.platform.services.canonical_aliases import DEFAULT_ALIAS_RULES


@dataclass(frozen=True)
class OfferRecord:
    offer_id: str
    title: str
    expected_canonical_id: str


@dataclass(frozen=True)
class ExtractedAttributes:
    brand: str
    model: str
    storage: str
    variant: str


@dataclass
class CanonicalProduct:
    canonical_id: str
    canonical_key: str
    version: int
    representative_title: str
    attributes: ExtractedAttributes
    embedding: list[float]
    is_active: bool = True
    merged_into: str | None = None
    source_offers: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class MatchDecision:
    canonical_id: str
    confidence_score: float
    match_type: str
    canonical_key: str
    requires_review: bool


@dataclass(frozen=True)
class AuditEvent:
    ts_utc: str
    offer_id: str
    action: str
    canonical_id: str
    match_type: str
    confidence_score: float
    canonical_key: str
    version: int
    dry_run: bool
    details: str
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class ValidationMetrics:
    precision: float
    recall: float
    false_merge_rate: float
    false_split_rate: float
    confidence_distribution: dict[str, int]


_ALIAS_RULES: tuple[tuple[str, str], ...] = DEFAULT_ALIAS_RULES


def _apply_aliases(value: str) -> str:
    text = value
    for pattern, replacement in _ALIAS_RULES:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


def _normalize_text(value: str) -> str:
    normalized = value.lower().strip()
    normalized = _apply_aliases(normalized)
    normalized = normalized.replace("+", " plus ")
    normalized = normalized.replace("/", " ")
    normalized = normalized.replace("-", " ")
    normalized = normalized.replace("(", " ").replace(")", " ")
    normalized = re.sub(r"iphone\s*(\d{1,2})\s*pro\s*max", r"iphone \1 pro max", normalized)
    normalized = re.sub(r"iphone\s*(\d{1,2})\s*promax", r"iphone \1 pro max", normalized)
    normalized = re.sub(r"iphone\s*(\d{1,2})\s*pro", r"iphone \1 pro", normalized)
    normalized = re.sub(r"iphone\s*(\d{1,2})\s*plus", r"iphone \1 plus", normalized)
    normalized = re.sub(r"iphone\s*(\d{1,2})\s*mini", r"iphone \1 mini", normalized)
    normalized = re.sub(r"iphone(\d{1,2})", r"iphone \1", normalized)
    normalized = re.sub(r"([a-z])(\d)", r"\1 \2", normalized)
    normalized = re.sub(r"(\d)([a-z])", r"\1 \2", normalized)
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\bgb\b", " gb", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _parse_brand(text: str) -> str:
    if "iphone" in text or "apple" in text or "iphon" in text:
        return "apple"
    if "samsung" in text or "galaxy" in text:
        return "samsung"
    return "unknown"


def _iphone_model_number(text: str) -> str | None:
    direct = re.search(r"\biphone\s*(\d{1,2})\b", text)
    if direct:
        return direct.group(1)

    tokens = text.split()
    if "iphone" in tokens:
        for token in tokens:
            if token.isdigit():
                value = int(token)
                if 10 <= value <= 20:
                    return str(value)
    return None


def _parse_model(text: str, brand: str) -> tuple[str, str]:
    if brand == "apple":
        tokens = set(text.split())
        num = _iphone_model_number(text)
        if not num:
            for token in text.split():
                if token.isdigit():
                    value = int(token)
                    if 10 <= value <= 20:
                        num = str(value)
                        break
        if num:
            variant_match = re.search(
                rf"\biphone\s*{re.escape(num)}\s*(pro\s*max|promax|pro|max|plus|mini)\b",
                text,
                flags=re.IGNORECASE,
            )
            if not variant_match:
                variant_match = re.search(
                    rf"\b{re.escape(num)}\s*(pro\s*max|promax|pro|max|plus|mini)\b",
                    text,
                    flags=re.IGNORECASE,
                )

            if variant_match:
                raw_variant = re.sub(r"\s+", "", variant_match.group(1).lower())
                if raw_variant == "promax" or (raw_variant in {"pro", "max"} and "pro" in tokens and "max" in tokens):
                    variant = "promax"
                elif raw_variant in {"pro", "plus", "mini", "max"}:
                    variant = raw_variant
                else:
                    variant = "base"
            else:
                if "promax" in tokens:
                    tokens.add("pro")
                    tokens.add("max")
                has_pro = "pro" in tokens
                has_max = "max" in tokens
                has_plus = "plus" in tokens and not ({"nanosim", "esim", "sim"} & tokens)
                has_mini = "mini" in tokens
                if has_pro and has_max:
                    variant = "promax"
                elif has_pro:
                    variant = "pro"
                elif has_plus:
                    variant = "plus"
                elif has_mini:
                    variant = "mini"
                elif has_max:
                    variant = "max"
                else:
                    variant = "base"
            model = f"iphone{num}" if variant == "base" else f"iphone{num}{variant}"
            return model, variant
    if brand == "samsung":
        if "a54" in text or re.search(r"\ba\s*54\b", text):
            return "a54", "base"
        match = re.search(r"\b(?:galaxy|samsung)?\s*a\s*(\d{2})\b", text)
        if match:
            return f"a{match.group(1)}", "base"
    return "unknown", "unknown"


def _parse_storage(text: str) -> str:
    match = re.search(r"\b(64|128|256|512|1024)\s*gb\b", text)
    if match:
        return match.group(1)
    packed = re.search(r"\b(64|128|256|512|1024)\b", text)
    return packed.group(1) if packed else "unknown"


def extract_attributes(title: str) -> ExtractedAttributes:
    normalized = _normalize_text(title)
    brand = _parse_brand(normalized)
    model, variant = _parse_model(normalized, brand)
    storage = _parse_storage(normalized)
    return ExtractedAttributes(brand=brand, model=model, storage=storage, variant=variant)


def canonical_key(attrs: ExtractedAttributes) -> str:
    return f"{attrs.brand}|{attrs.model}|{attrs.storage}"


def levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    prev = list(range(len(right) + 1))
    for i, l_char in enumerate(left, start=1):
        curr = [i]
        for j, r_char in enumerate(right, start=1):
            ins = curr[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if l_char == r_char else 1)
            curr.append(min(ins, delete, sub))
        prev = curr
    return prev[-1]


def token_similarity(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def fuzzy_similarity(left: str, right: str) -> float:
    lev = levenshtein_distance(left, right)
    max_len = max(len(left), len(right), 1)
    lev_sim = 1.0 - lev / max_len
    tok_sim = token_similarity(left, right)
    return 0.6 * lev_sim + 0.4 * tok_sim


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    l_vec = list(left)
    r_vec = list(right)
    if not l_vec or len(l_vec) != len(r_vec):
        return 0.0
    dot = sum(l * r for l, r in zip(l_vec, r_vec, strict=True))
    l_norm = math.sqrt(sum(l * l for l in l_vec))
    r_norm = math.sqrt(sum(r * r for r in r_vec))
    if l_norm == 0 or r_norm == 0:
        return 0.0
    return dot / (l_norm * r_norm)


class HashingEmbedder:
    def __init__(self, dim: int = 192) -> None:
        self.dim = dim

    def encode(self, text: str) -> list[float]:
        base = _normalize_text(text)
        vec = [0.0] * self.dim
        padded = f"  {base}  "
        for idx in range(len(padded) - 2):
            gram = padded[idx : idx + 3]
            digest = hashlib.sha256(gram.encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:4], "big", signed=False) % self.dim
            vec[bucket] += 1.0
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            return vec
        return [x / norm for x in vec]


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name, local_files_only=True)

    def encode(self, text: str) -> list[float]:
        encoded = self.model.encode([text], normalize_embeddings=True)
        return [float(x) for x in encoded[0].tolist()]


class EmbeddingService:
    def __init__(self) -> None:
        self.backend = HashingEmbedder()
        self.backend_name = "hashing"
        try:
            self.backend = SentenceTransformerEmbedder()
            self.backend_name = "sentence_transformers"
        except Exception:
            self.backend = HashingEmbedder()
            self.backend_name = "hashing"

    def embed(self, text: str) -> list[float]:
        return self.backend.encode(_normalize_text(text))


class CanonicalMatchingEngine:
    def __init__(
        self,
        *,
        embedding_high_threshold: float = 0.92,
        embedding_low_threshold: float = 0.85,
        fuzzy_threshold: float = 0.95,
        dry_run: bool = False,
        version: int = 1,
    ) -> None:
        self.embedding_service = EmbeddingService()
        self.embedding_high_threshold = embedding_high_threshold
        self.embedding_low_threshold = embedding_low_threshold
        self.fuzzy_threshold = fuzzy_threshold
        self.dry_run = dry_run
        self.version = version
        self._sequence = 0
        self.canonicals: dict[str, CanonicalProduct] = {}
        self.key_index: dict[str, str] = {}
        self.audit_log: list[AuditEvent] = []

    @staticmethod
    def _is_model_compatible(incoming: ExtractedAttributes, candidate: ExtractedAttributes) -> bool:
        if incoming.model == "unknown" or candidate.model == "unknown":
            return False
        return incoming.model == candidate.model

    @staticmethod
    def _is_storage_compatible(incoming: ExtractedAttributes, candidate: ExtractedAttributes) -> bool:
        if incoming.storage != "unknown" and candidate.storage != "unknown":
            return incoming.storage == candidate.storage
        if incoming.storage != "unknown" and candidate.storage == "unknown":
            return False
        return True

    def _is_merge_compatible(self, incoming: ExtractedAttributes, candidate: ExtractedAttributes) -> bool:
        if incoming.brand != candidate.brand:
            return False
        if not self._is_model_compatible(incoming, candidate):
            return False
        if not self._is_storage_compatible(incoming, candidate):
            return False
        return True

    def _storage_is_ambiguous(self, attrs: ExtractedAttributes) -> bool:
        if attrs.storage != "unknown" or attrs.brand == "unknown" or attrs.model == "unknown":
            return False
        storages = {
            item.attributes.storage
            for item in self.canonicals.values()
            if item.is_active
            and item.attributes.brand == attrs.brand
            and item.attributes.model == attrs.model
            and item.attributes.storage != "unknown"
        }
        return len(storages) > 1

    def _next_id(self) -> str:
        self._sequence += 1
        return f"canon_{self.version}_{self._sequence:06d}"

    @staticmethod
    def _index_key(attrs: ExtractedAttributes, title: str, key: str) -> str:
        if attrs.model == "unknown":
            return f"{key}|title:{_normalize_text(title)}"
        return key

    def _create_canonical(self, offer: OfferRecord, attrs: ExtractedAttributes, key: str, index_key: str) -> CanonicalProduct:
        canonical_id = self._next_id()
        canonical = CanonicalProduct(
            canonical_id=canonical_id,
            canonical_key=key,
            version=self.version,
            representative_title=offer.title,
            attributes=attrs,
            embedding=self.embedding_service.embed(offer.title),
            source_offers=[offer.offer_id],
        )
        if not self.dry_run:
            self.canonicals[canonical_id] = canonical
            self.key_index[index_key] = canonical_id
        return canonical

    def _log(
        self,
        *,
        offer_id: str,
        action: str,
        canonical_id: str,
        match_type: str,
        confidence_score: float,
        canonical_key: str,
        details: str,
        flags: tuple[str, ...] = (),
    ) -> None:
        self.audit_log.append(
            AuditEvent(
                ts_utc=datetime.now(UTC).isoformat(),
                offer_id=offer_id,
                action=action,
                canonical_id=canonical_id,
                match_type=match_type,
                confidence_score=round(confidence_score, 4),
                canonical_key=canonical_key,
                version=self.version,
                dry_run=self.dry_run,
                details=details,
                flags=flags,
            )
        )

    def _best_similarity(self, offer: OfferRecord, attrs: ExtractedAttributes) -> tuple[CanonicalProduct | None, float, float]:
        offer_key = canonical_key(attrs)
        normalized_title = _normalize_text(offer.title)
        offer_embedding = self.embedding_service.embed(offer.title)

        best_canonical: CanonicalProduct | None = None
        best_fuzzy = 0.0
        best_embedding = 0.0
        for canonical in self.canonicals.values():
            if not canonical.is_active:
                continue
            if not self._is_merge_compatible(attrs, canonical.attributes):
                continue
            candidate_key = canonical.canonical_key
            fuzzy = fuzzy_similarity(offer_key, candidate_key)
            if fuzzy > best_fuzzy:
                best_fuzzy = fuzzy
                best_canonical = canonical

            emb = cosine_similarity(offer_embedding, canonical.embedding)
            if emb > best_embedding:
                best_embedding = emb
                if best_canonical is None:
                    best_canonical = canonical

            # Lightweight tie-breaker: token overlap of representative titles.
            title_tok = token_similarity(normalized_title, _normalize_text(canonical.representative_title))
            if title_tok > 0.98 and canonical.attributes.storage == attrs.storage:
                if best_canonical is None:
                    best_canonical = canonical
                best_fuzzy = max(best_fuzzy, title_tok)
        return best_canonical, best_fuzzy, best_embedding

    def process_offer(self, offer: OfferRecord) -> MatchDecision:
        attrs = extract_attributes(offer.title)
        key = canonical_key(attrs)
        index_key = self._index_key(attrs, offer.title, key)

        exact_id = self.key_index.get(index_key)
        if exact_id:
            canonical = self.canonicals[exact_id]
            if not self.dry_run:
                canonical.source_offers.append(offer.offer_id)
            self._log(
                offer_id=offer.offer_id,
                action="merge",
                canonical_id=canonical.canonical_id,
                match_type="exact",
                confidence_score=1.0,
                canonical_key=key,
                details="exact_canonical_key_match",
            )
            return MatchDecision(canonical.canonical_id, 1.0, "exact", key, False)

        best_canonical, fuzzy_score, embedding_score = self._best_similarity(offer, attrs)
        ambiguous_storage = bool(best_canonical and self._storage_is_ambiguous(attrs))
        if ambiguous_storage:
            best_canonical = None

        if best_canonical and fuzzy_score >= self.fuzzy_threshold:
            if not self.dry_run:
                best_canonical.source_offers.append(offer.offer_id)
                self.key_index[index_key] = best_canonical.canonical_id
            self._log(
                offer_id=offer.offer_id,
                action="merge",
                canonical_id=best_canonical.canonical_id,
                match_type="fuzzy",
                confidence_score=fuzzy_score,
                canonical_key=key,
                details="fuzzy_key_match",
            )
            return MatchDecision(best_canonical.canonical_id, fuzzy_score, "fuzzy", key, False)

        if best_canonical and embedding_score > self.embedding_high_threshold:
            if not self.dry_run:
                best_canonical.source_offers.append(offer.offer_id)
                self.key_index[index_key] = best_canonical.canonical_id
            self._log(
                offer_id=offer.offer_id,
                action="merge",
                canonical_id=best_canonical.canonical_id,
                match_type="embedding",
                confidence_score=embedding_score,
                canonical_key=key,
                details=f"embedding_high_confidence:{self.embedding_service.backend_name}",
            )
            return MatchDecision(best_canonical.canonical_id, embedding_score, "embedding", key, False)

        low_confidence = bool(best_canonical and self.embedding_low_threshold <= embedding_score <= self.embedding_high_threshold)
        needs_review = low_confidence or ambiguous_storage
        flags: tuple[str, ...] = ()
        if low_confidence and ambiguous_storage:
            flags = ("low_confidence", "ambiguous_storage")
        elif low_confidence:
            flags = ("low_confidence",)
        elif ambiguous_storage:
            flags = ("ambiguous_storage",)
        created = self._create_canonical(offer, attrs, key, index_key)
        self._log(
            offer_id=offer.offer_id,
            action="create",
            canonical_id=created.canonical_id,
            match_type="new",
            confidence_score=embedding_score if low_confidence else 0.0,
            canonical_key=key,
            details="low_confidence_review" if low_confidence else "new_canonical",
            flags=flags,
        )
        return MatchDecision(created.canonical_id, embedding_score if low_confidence else 0.0, "new", key, needs_review)

    def canonicalize(self, *, offer_id: str, title: str, expected_canonical_id: str = "unknown") -> MatchDecision:
        return self.process_offer(
            OfferRecord(
                offer_id=offer_id,
                title=title,
                expected_canonical_id=expected_canonical_id,
            )
        )

    def process_batch(self, offers: list[OfferRecord]) -> list[MatchDecision]:
        return [self.process_offer(offer) for offer in offers]

    def recompute(self, offers: list[OfferRecord], *, new_version: int, dry_run: bool | None = None) -> list[MatchDecision]:
        engine = CanonicalMatchingEngine(
            embedding_high_threshold=self.embedding_high_threshold,
            embedding_low_threshold=self.embedding_low_threshold,
            fuzzy_threshold=self.fuzzy_threshold,
            dry_run=self.dry_run if dry_run is None else dry_run,
            version=new_version,
        )
        decisions = engine.process_batch(offers)
        self.audit_log.append(
            AuditEvent(
                ts_utc=datetime.now(UTC).isoformat(),
                offer_id="system",
                action="recompute",
                canonical_id="version_switch",
                match_type="new",
                confidence_score=1.0,
                canonical_key="versioning",
                version=new_version,
                dry_run=engine.dry_run,
                details=f"recompute_completed_with_{len(decisions)}_offers",
            )
        )
        return decisions


def evaluate_predictions(offers: list[OfferRecord], decisions: list[MatchDecision]) -> ValidationMetrics:
    if len(offers) != len(decisions):
        raise ValueError("offers and decisions must have same size")

    true_labels = [offer.expected_canonical_id for offer in offers]
    pred_labels = [decision.canonical_id for decision in decisions]

    tp = fp = fn = tn = 0
    total_merges = 0
    incorrect_merges = 0
    total_same_products = 0
    incorrect_splits = 0

    for i in range(len(offers)):
        for j in range(i + 1, len(offers)):
            same_true = true_labels[i] == true_labels[j]
            same_pred = pred_labels[i] == pred_labels[j]
            if same_pred:
                total_merges += 1
            if same_true:
                total_same_products += 1
            if same_true and same_pred:
                tp += 1
            elif (not same_true) and same_pred:
                fp += 1
                incorrect_merges += 1
            elif same_true and (not same_pred):
                fn += 1
                incorrect_splits += 1
            else:
                tn += 1

    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    false_merge_rate = incorrect_merges / total_merges if total_merges else 0.0
    false_split_rate = incorrect_splits / total_same_products if total_same_products else 0.0

    bins = Counter()
    for decision in decisions:
        score = decision.confidence_score
        if score >= 0.92:
            bins[">=0.92"] += 1
        elif score >= 0.85:
            bins["0.85-0.92"] += 1
        else:
            bins["<0.85"] += 1

    return ValidationMetrics(
        precision=precision,
        recall=recall,
        false_merge_rate=false_merge_rate,
        false_split_rate=false_split_rate,
        confidence_distribution=dict(bins),
    )


def benchmark_engine(offers: list[OfferRecord]) -> dict[str, float]:
    tracemalloc.start()
    started = perf_counter()
    engine = CanonicalMatchingEngine()
    engine.process_batch(offers)
    elapsed = perf_counter() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "offers": float(len(offers)),
        "processing_time_sec": elapsed,
        "peak_memory_mb": peak / (1024 * 1024),
        "canonical_count": float(len(engine.canonicals)),
    }
