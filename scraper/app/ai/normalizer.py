import re


class NormalizerService:
    def normalize_name(self, text: str) -> str:
        normalized = re.sub(r"\s+", " ", text.lower()).strip()
        return normalized

    def normalize_specs(self, specs: dict[str, str]) -> dict[str, str]:
        return {self.normalize_name(k): self.normalize_name(v) for k, v in specs.items()}
