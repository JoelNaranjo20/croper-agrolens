"""Train the yield model: synthetic data → SQLite → model artifact.

Usage: python -m scripts.train [--rows 20000]
"""

from __future__ import annotations

import argparse
import json
import logging

from app.config import get_settings
from app.ml.dataset import generate, read_sqlite, write_sqlite
from app.ml.yield_model import YieldModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("train")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=20_000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    settings = get_settings()
    log.info("Generating %d synthetic harvest records → %s", args.rows, settings.dataset_path)
    write_sqlite(settings.dataset_path, generate(args.rows, args.seed))

    X, y = read_sqlite(settings.dataset_path)
    model = YieldModel.train(X, y)
    model.save(settings.model_path)
    log.info("Model saved → %s", settings.model_path)
    log.info("Metadata: %s", json.dumps(model.metadata, indent=2))


if __name__ == "__main__":
    main()
