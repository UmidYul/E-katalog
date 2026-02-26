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

from services.worker.app.platform.services.canonical_matching import build_fuzzy_threshold_pr_curve
from services.worker.app.platform.services.synthetic_data import generate_scaled_offers, generate_synthetic_offers


def _threshold_grid(min_value: float, max_value: float, step: float) -> list[float]:
    values: list[float] = []
    cursor = float(min_value)
    while cursor <= float(max_value) + 1e-9:
        values.append(round(cursor, 4))
        cursor += float(step)
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Tune canonical fuzzy_threshold via PR curve.")
    parser.add_argument("--min-threshold", type=float, default=0.90)
    parser.add_argument("--max-threshold", type=float, default=0.99)
    parser.add_argument("--step", type=float, default=0.01)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--size", type=int, default=0, help="If >0, use scaled synthetic dataset with given size.")
    parser.add_argument("--output", type=str, default="", help="Optional output JSON path.")
    args = parser.parse_args()

    if args.min_threshold <= 0 or args.max_threshold >= 1 or args.min_threshold >= args.max_threshold:
        raise SystemExit("invalid threshold range; expected 0 < min < max < 1")
    if args.step <= 0:
        raise SystemExit("step must be > 0")

    offers = generate_scaled_offers(size=int(args.size), seed=int(args.seed)) if int(args.size) > 0 else generate_synthetic_offers(seed=int(args.seed))
    thresholds = _threshold_grid(float(args.min_threshold), float(args.max_threshold), float(args.step))
    report = build_fuzzy_threshold_pr_curve(offers, thresholds=thresholds)
    report["seed"] = int(args.seed)
    report["threshold_grid"] = thresholds

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
