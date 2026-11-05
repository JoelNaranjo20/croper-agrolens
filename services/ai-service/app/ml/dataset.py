"""Synthetic agronomic dataset, persisted in SQLite.

Real deployments would read historical harvests from the data platform (Fabric / Cosmos DB).
The generator encodes simple agronomic priors so the model learns plausible relationships:
each crop has an optimal rainfall, temperature and soil pH, and yield decays smoothly away
from the optimum (Gaussian response), plus multiplicative noise.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class CropProfile:
    base_yield_t_ha: float
    rain_opt_mm: float
    rain_tol_mm: float
    temp_opt_c: float
    temp_tol_c: float
    ph_opt: float


# Typical Colombian / LATAM references (annual rainfall, mean temperature).
CROP_PROFILES: dict[str, CropProfile] = {
    "maize": CropProfile(6.0, 900, 400, 24, 5, 6.2),
    "coffee": CropProfile(1.6, 1900, 600, 20, 3, 5.5),
    "rice": CropProfile(6.5, 1600, 500, 27, 4, 6.0),
    "potato": CropProfile(22.0, 900, 350, 15, 4, 5.5),
    "avocado": CropProfile(11.0, 1400, 500, 19, 4, 6.0),
    "banana": CropProfile(32.0, 2400, 700, 27, 3, 6.0),
    "cocoa": CropProfile(0.7, 2000, 600, 26, 3, 6.5),
}

FEATURES = ["crop", "rainfall_mm", "avg_temp_c", "soil_ph", "vegetation_coverage"]
TARGET = "yield_t_ha"


def expected_yield(
    crop: str, rainfall_mm: float, avg_temp_c: float, soil_ph: float, vegetation_coverage: float
) -> float:
    p = CROP_PROFILES[crop]
    rain_f = np.exp(-(((rainfall_mm - p.rain_opt_mm) / p.rain_tol_mm) ** 2) / 2)
    temp_f = np.exp(-(((avg_temp_c - p.temp_opt_c) / p.temp_tol_c) ** 2) / 2)
    ph_f = np.exp(-(((soil_ph - p.ph_opt) / 1.2) ** 2) / 2)
    # Canopy coverage (from image analysis) is a strong proxy of crop vigor.
    veg_f = 0.4 + 0.6 * vegetation_coverage
    return float(p.base_yield_t_ha * rain_f * temp_f * ph_f * veg_f)


def generate(n_rows: int, seed: int = 42) -> list[tuple]:
    rng = np.random.default_rng(seed)
    crops = list(CROP_PROFILES)
    rows: list[tuple] = []
    for _ in range(n_rows):
        crop = crops[rng.integers(len(crops))]
        p = CROP_PROFILES[crop]
        rainfall = float(np.clip(rng.normal(p.rain_opt_mm, p.rain_tol_mm * 1.3), 150, 4500))
        temp = float(np.clip(rng.normal(p.temp_opt_c, p.temp_tol_c * 1.4), 5, 38))
        ph = float(np.clip(rng.normal(p.ph_opt, 0.9), 4.0, 8.5))
        coverage = float(np.clip(rng.beta(4, 2), 0, 1))
        y = expected_yield(crop, rainfall, temp, ph, coverage) * rng.lognormal(0, 0.12)
        rows.append((crop, round(rainfall, 1), round(temp, 2), round(ph, 2), round(coverage, 3), y))
    return rows


def write_sqlite(path: Path, rows: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            DROP TABLE IF EXISTS harvests;
            CREATE TABLE harvests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crop TEXT NOT NULL,
                rainfall_mm REAL NOT NULL,
                avg_temp_c REAL NOT NULL,
                soil_ph REAL NOT NULL,
                vegetation_coverage REAL NOT NULL,
                yield_t_ha REAL NOT NULL CHECK (yield_t_ha >= 0)
            );
            CREATE INDEX idx_harvests_crop ON harvests (crop);
            """
        )
        conn.executemany(
            "INSERT INTO harvests (crop, rainfall_mm, avg_temp_c, soil_ph, vegetation_coverage,"
            " yield_t_ha) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )


def read_sqlite(path: Path) -> tuple[list[list], np.ndarray]:
    with sqlite3.connect(path) as conn:
        cur = conn.execute(f"SELECT {', '.join(FEATURES)}, {TARGET} FROM harvests")  # noqa: S608
        data = cur.fetchall()
    X = [list(r[:-1]) for r in data]
    y = np.array([r[-1] for r in data], dtype=float)
    return X, y
