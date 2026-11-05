"""Yield prediction model.

Design decisions:
- Gradient boosting (HistGradientBoostingRegressor): strong on tabular data, fast, no scaling.
- Three models (median + P10/P90 quantiles) so the API returns a *range*, not a false-precision
  point estimate. Agronomists and farmers plan around risk, not single numbers.
- The artifact is versioned and carries its own metrics + training metadata, so every
  prediction can be traced back to the model that produced it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from app.ml.dataset import CROP_PROFILES, FEATURES

logger = logging.getLogger(__name__)

MODEL_VERSION = "1.0.0"
QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}


def _pipeline(quantile: float) -> Pipeline:
    pre = ColumnTransformer(
        [("crop", OneHotEncoder(categories=[list(CROP_PROFILES)], handle_unknown="error"), [0])],
        remainder="passthrough",
    )
    reg = HistGradientBoostingRegressor(
        loss="quantile", quantile=quantile, max_iter=300, learning_rate=0.08, random_state=7
    )
    return Pipeline([("pre", pre), ("reg", reg)])


@dataclass
class YieldPrediction:
    p10: float
    p50: float
    p90: float


class YieldModel:
    def __init__(self, models: dict[str, Pipeline], metadata: dict[str, Any]):
        self._models = models
        self.metadata = metadata

    @property
    def version(self) -> str:
        return str(self.metadata["version"])

    @classmethod
    def train(cls, X: list[list], y: np.ndarray) -> YieldModel:
        Xa = np.array(X, dtype=object)
        X_tr, X_te, y_tr, y_te = train_test_split(Xa, y, test_size=0.2, random_state=7)
        models = {name: _pipeline(q).fit(X_tr, y_tr) for name, q in QUANTILES.items()}

        pred = models["p50"].predict(X_te)
        lo, hi = models["p10"].predict(X_te), models["p90"].predict(X_te)
        metadata = {
            "version": MODEL_VERSION,
            "trained_at": datetime.now(UTC).isoformat(),
            "features": FEATURES,
            "n_train": len(y_tr),
            "n_test": len(y_te),
            "metrics": {
                "mae_t_ha": round(float(mean_absolute_error(y_te, pred)), 4),
                "r2": round(float(r2_score(y_te, pred)), 4),
                # Share of test samples inside the P10-P90 band (ideal ≈ 0.80).
                "interval_coverage": round(float(np.mean((y_te >= lo) & (y_te <= hi))), 4),
            },
        }
        return cls(models, metadata)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"models": self._models, "metadata": self.metadata}, path)

    @classmethod
    def load(cls, path: Path) -> YieldModel:
        # Only artifacts produced by our own training pipeline are loaded (joblib uses pickle).
        blob = joblib.load(path)
        return cls(blob["models"], blob["metadata"])

    def predict(
        self,
        crop: str,
        rainfall_mm: float,
        avg_temp_c: float,
        soil_ph: float,
        vegetation_coverage: float,
    ) -> YieldPrediction:
        row = np.array(
            [[crop, rainfall_mm, avg_temp_c, soil_ph, vegetation_coverage]], dtype=object
        )
        raw = {name: max(0.0, float(m.predict(row)[0])) for name, m in self._models.items()}
        # Independent quantile models can cross; enforce monotonic ordering.
        p10, p50, p90 = sorted((raw["p10"], raw["p50"], raw["p90"]))
        return YieldPrediction(p10=p10, p50=p50, p90=p90)
