import pytest

from app.vision.vegetation import Health, InvalidImageError, analyze, classify
from tests.conftest import make_image


def test_green_image_is_full_coverage_and_healthy():
    r = analyze(make_image((40, 160, 40)))
    assert r.vegetation_coverage == 1.0
    assert r.health is Health.HEALTHY


def test_soil_image_is_bare():
    r = analyze(make_image((120, 90, 70)))
    assert r.vegetation_coverage == 0.0
    assert r.health is Health.BARE


def test_yellow_foliage_counts_as_stress():
    r = analyze(make_image((200, 190, 60)))
    assert r.stress_ratio > 0.9


def test_large_images_are_downscaled():
    r = analyze(make_image((40, 160, 40), size=(2000, 1000)), max_side=256)
    assert max(r.width, r.height) == 256


def test_invalid_bytes_raise():
    with pytest.raises(InvalidImageError):
        analyze(b"definitely not an image")


@pytest.mark.parametrize(
    ("coverage", "stress", "expected"),
    [
        (0.05, 0, Health.BARE),
        (0.2, 0, Health.STRESSED),
        (0.5, 0.1, Health.MODERATE),
        (0.8, 0.05, Health.HEALTHY),
        (0.8, 0.5, Health.STRESSED),
    ],
)
def test_classify(coverage, stress, expected):
    assert classify(coverage, stress) is expected
