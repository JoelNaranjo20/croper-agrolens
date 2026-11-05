import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.ml.dataset import generate
from app.ml.yield_model import YieldModel


@pytest.fixture(scope="session")
def model() -> YieldModel:
    rows = generate(3000, seed=1)
    X = [list(r[:-1]) for r in rows]
    y = np.array([r[-1] for r in rows])
    return YieldModel.train(X, y)


@pytest.fixture
def client(model: YieldModel, tmp_path) -> TestClient:
    settings = Settings(model_path=tmp_path / "none.joblib", max_image_bytes=200_000)
    with TestClient(create_app(settings, model=model)) as c:
        yield c


def make_image(rgb: tuple[int, int, int], size=(64, 64), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, rgb).save(buf, format=fmt)
    return buf.getvalue()
