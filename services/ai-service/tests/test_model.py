from app.ml.yield_model import YieldModel


def test_metrics_are_reasonable(model: YieldModel):
    m = model.metadata["metrics"]
    assert m["r2"] > 0.8
    assert 0.6 < m["interval_coverage"] < 0.95


def test_prediction_is_ordered_and_non_negative(model: YieldModel):
    p = model.predict("maize", 900, 24, 6.2, 0.8)
    assert 0 <= p.p10 <= p.p50 <= p.p90


def test_optimal_conditions_beat_drought(model: YieldModel):
    good = model.predict("coffee", 1900, 20, 5.5, 0.85).p50
    drought = model.predict("coffee", 400, 20, 5.5, 0.85).p50
    assert good > drought * 1.5


def test_roundtrip(model: YieldModel, tmp_path):
    path = tmp_path / "m.joblib"
    model.save(path)
    loaded = YieldModel.load(path)
    assert loaded.version == model.version
    assert loaded.predict("rice", 1600, 27, 6, 0.7) == model.predict("rice", 1600, 27, 6, 0.7)
