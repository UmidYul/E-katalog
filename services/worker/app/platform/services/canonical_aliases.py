from __future__ import annotations

# Keep alias rules in a dedicated module so it can be extended independently
# from matching logic (e.g. with domain/language specific dictionaries).
DEFAULT_ALIAS_RULES: tuple[tuple[str, str], ...] = (
    (r"\b\u0430\u0439\u0444\u043e\u043d\b", "iphone"),
    (r"\b\u0430\u0439\u0444[\u043eo]\u043d\b", "iphone"),
    (r"\b\u0430\u0439\u043f\u0445\u043e\u043d\b", "iphone"),
    (r"\b\u044d\u043f\u043f\u043b\b", "apple"),
    (r"\b\u0441\u0430\u043c\u0441\u0443\u043d\u0433\b", "samsung"),
    (r"\b\u0433\u0430\u043b\u0430\u043a\u0441\u0438\b", "galaxy"),
    (r"\b\u0433\u0431\b", "gb"),
    (r"\b\u043f\u0440\u043e\s*\u043c\u0430\u043a\u0441\b", "pro max"),
    (r"\b\u043f\u0440\u043e\u043c\u0430\u043a\u0441\b", "pro max"),
    (r"\b\u043f\u0440\u043e\b", "pro"),
    (r"\b\u043f\u043b\u044e\u0441\b", "plus"),
    (r"\b\u043c\u0430\u043a\u0441\b", "max"),
    (r"\b\u043c\u0438\u043d\u0438\b", "mini"),
    (r"\biphon\b", "iphone"),
    (r"\biphon(\d{1,2})\b", r"iphone \1"),
    (r"\biphonee\b", "iphone"),
    (r"\bipone\b", "iphone"),
    (r"\bifone\b", "iphone"),
    (r"\baple\b", "apple"),
)
