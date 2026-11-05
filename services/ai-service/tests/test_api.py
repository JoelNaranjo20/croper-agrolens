from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import make_image


def test_health(client: TestClient):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").status_code == 200


def test_not_ready_without_model(tmp_path):
    app = create_app(Settings(model_path=tmp_path / "missing.joblib"))
    with TestClient(app) as c:
        assert c.get("/health/live").status_code == 200
        assert c.get("/health/ready").status_code == 503


def test_predict_yield(client: TestClient):
    res = client.post(
        "/v1/predictions/yield",
        json={"crop": "maize", "areaHa": 10, "rainfallMm": 900, "avgTempC": 24},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["crop"] == "maize"
    assert body["totalT"]["p50"] > body["yieldTHa"]["p50"]
    assert body["modelVersion"] == "1.0.0"
    assert "x-request-id" in res.headers


def test_predict_validation_uses_problem_json(client: TestClient):
    res = client.post("/v1/predictions/yield", json={"crop": "kale", "areaHa": -1})
    assert res.status_code == 422
    assert res.headers["content-type"] == "application/problem+json"
    assert res.json()["title"] == "Validation failed"


def test_model_info(client: TestClient):
    body = client.get("/v1/models/yield").json()
    assert "maize" in body["crops"]
    assert "r2" in body["metrics"]


def test_vegetation_index(client: TestClient):
    files = {"image": ("leaf.jpg", make_image((40, 160, 40), fmt="JPEG"), "image/jpeg")}
    res = client.post("/v1/vision/vegetation-index", files=files)
    assert res.status_code == 200
    assert res.json()["health"] == "healthy"


def test_vegetation_rejects_wrong_type(client: TestClient):
    files = {"image": ("x.txt", b"hello", "text/plain")}
    assert client.post("/v1/vision/vegetation-index", files=files).status_code == 415


def test_vegetation_rejects_oversized(client: TestClient):
    big = make_image((40, 160, 40), size=(1500, 1500), fmt="PNG") + b"0" * 300_000
    files = {"image": ("big.png", big, "image/png")}
    assert client.post("/v1/vision/vegetation-index", files=files).status_code == 413


def test_vegetation_rejects_corrupt(client: TestClient):
    files = {"image": ("x.png", b"\x89PNG broken", "image/png")}
    assert client.post("/v1/vision/vegetation-index", files=files).status_code == 422
