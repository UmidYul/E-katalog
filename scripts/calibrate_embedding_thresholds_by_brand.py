from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
WORKER_ROOT = ROOT / "services" / "worker"
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

from services.worker.app.platform.services.canonical_matching import calibrate_embedding_thresholds_by_brand
from services.worker.app.platform.services.synthetic_data import generate_scaled_offers, generate_synthetic_offers


def _threshold_grid(min_value: float, max_value: float, step: float) -> list[float]:
    values: list[float] = []
    cursor = float(min_value)
    while cursor <= float(max_value) + 1e-9:
        values.append(round(cursor, 4))
        cursor += float(step)
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Calibrate embedding thresholds by brand family.")
    parser.add_argument("--min-high", type=float, default=0.88)
    parser.add_argument("--max-high", type=float, default=0.96)
    parser.add_argument("--step", type=float, default=0.01)
    parser.add_argument("--low-gap", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--size", type=int, default=0)
    parser.add_argument("--min-samples", type=int, default=20)
    parser.add_argument("--output", type=str, default="")
    args = parser.parse_args()

    if args.min_high <= 0 or args.max_high >= 1 or args.min_high >= args.max_high:
        raise SystemExit("invalid high-threshold range; expected 0 < min < max < 1")
    if args.step <= 0:
        raise SystemExit("step must be > 0")
    if args.low_gap <= 0:
        raise SystemExit("low-gap must be > 0")

    offers = generate_scaled_offers(size=int(args.size), seed=int(args.seed)) if int(args.size) > 0 else generate_synthetic_offers(seed=int(args.seed))
    highs = _threshold_grid(float(args.min_high), float(args.max_high), float(args.step))
    report = calibrate_embedding_thresholds_by_brand(
        offers,
        high_thresholds=highs,
        low_gap=float(args.low_gap),
        min_samples_per_brand=int(args.min_samples),
    )
    report["seed"] = int(args.seed)
    report["high_threshold_grid"] = highs

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
