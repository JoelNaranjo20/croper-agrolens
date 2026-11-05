"""RGB crop-image analysis.

Uses the Excess Green index (ExG = 2g - r - b on chromatic coordinates), a well-established
index for segmenting vegetation in plain RGB photos (Woebbecke et al., 1995). It works with
any phone camera — no multispectral sensor required, which matters for smallholder farms.

Output:
- vegetation_coverage: share of pixels classified as green vegetation.
- stress_ratio: among plant-like pixels, share that look yellow/brown (chlorosis, drought).
- health: coarse label for UX; the numbers are the real signal.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from PIL import Image, UnidentifiedImageError

# Guard against decompression bombs (a tiny file that expands to gigapixels).
Image.MAX_IMAGE_PIXELS = 40_000_000

EXG_THRESHOLD = 0.05


class InvalidImageError(ValueError):
    pass


class Health(StrEnum):
    HEALTHY = "healthy"
    MODERATE = "moderate"
    STRESSED = "stressed"
    BARE = "bare"


@dataclass(frozen=True)
class VegetationAnalysis:
    vegetation_coverage: float
    stress_ratio: float
    exg_mean: float
    health: Health
    width: int
    height: int


def _load_rgb(data: bytes, max_side: int) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()  # cheap structural check
        img = Image.open(io.BytesIO(data))  # verify() invalidates the handle
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("File is not a valid image") from exc
    img.thumbnail((max_side, max_side))
    return np.asarray(img, dtype=np.float32)


def classify(coverage: float, stress: float) -> Health:
    if coverage < 0.10:
        return Health.BARE
    if stress > 0.35 or coverage < 0.30:
        return Health.STRESSED
    if stress > 0.15 or coverage < 0.55:
        return Health.MODERATE
    return Health.HEALTHY


def analyze(data: bytes, max_side: int = 512) -> VegetationAnalysis:
    rgb = _load_rgb(data, max_side)
    total = rgb.sum(axis=2) + 1e-6
    r, g, b = (rgb[..., i] / total for i in range(3))
    exg = 2 * g - r - b

    red_c, green_c, blue_c = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # ExG alone also fires on yellow (high r+g, low b); require green to dominate red.
    green = (exg > EXG_THRESHOLD) & (green_c > red_c)
    # Yellow/brown foliage: red >= green, strongly blue-depleted (excludes greyish soil).
    brightness = rgb.mean(axis=2)
    yellowish = (~green) & (red_c >= green_c * 0.9) & (blue_c < green_c * 0.6) & (brightness > 40)

    n = green.size
    coverage = float(green.sum() / n)
    plant_like = green.sum() + yellowish.sum()
    stress = float(yellowish.sum() / plant_like) if plant_like else 0.0
    exg_mean = float(exg[green].mean()) if green.any() else 0.0

    return VegetationAnalysis(
        vegetation_coverage=round(coverage, 4),
        stress_ratio=round(stress, 4),
        exg_mean=round(exg_mean, 4),
        health=classify(coverage, stress),
        width=int(rgb.shape[1]),
        height=int(rgb.shape[0]),
    )
