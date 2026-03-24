from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="SomaliGuard ML Engine (Fraud + Reasons)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent.parent
MODELS_PATH = ROOT / "models"


def load_best_model():
    best_path = MODELS_PATH / "best_model.pkl"
    if best_path.exists():
        return joblib.load(best_path)
    return joblib.load(MODELS_PATH / "fraud_model.pkl")


model = load_best_model()


class Transaction(BaseModel):
    amount: float
    old_balance: float
    hour: int
    service: str = ""


def normalize_service(service: str) -> str:
    s = (service or "").strip().lower()
    s = s.replace("-", " ").replace("_", " ")
    s = " ".join(s.split())
    return s


@app.get("/")
def home():
    return {"message": "SomaliGuard ML Engine is running."}


@app.post("/predict")
def predict_fraud(data: Transaction):
    amount = float(data.amount)
    old_balance = float(data.old_balance)
    hour = int(data.hour)
    service_n = normalize_service(data.service)

    features = np.array([[amount, old_balance, hour]])

    pred_label = int(model.predict(features)[0])
    is_fraud = pred_label == 1

    probability = None
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(features)[0]
        probability = float(proba[1])

    reasons: list[str] = []

    # Strict hard rules (override ML when exceeded)
    strict_evc = (service_n in {"evc plus", "evc"} or "evc" in service_n) and amount > 500
    strict_zaad = (service_n == "zaad" or "zaad" in service_n) and amount > 2000
    strict_sahal = (service_n == "sahal" or "sahal" in service_n) and amount > 1000

    if strict_evc:
        reasons.append("Exceeded EVC Limit")
    if strict_zaad:
        reasons.append("Exceeded Zaad Limit")
    if strict_sahal:
        reasons.append("Exceeded Sahal Limit")

    if strict_evc or strict_zaad or strict_sahal:
        is_fraud = True

    if abs(amount - 10_000) < 0.005:
        reasons.append("Common in money laundering")
    if 2 <= hour < 5:
        reasons.append("Night-Time Transaction")

    reason = reasons[0] if reasons else None

    if is_fraud and not reasons:
        reasons = ["Pattern Anomaly"]
        reason = "Pattern Anomaly"

    return {
        "prediction": "SUSPICIOUS" if is_fraud else "SAFE",
        "fraud_probability": f"{probability:.2%}" if probability is not None else None,
        "status": "Success",
        "reasons": reasons if is_fraud else [],
        "reason": reason if is_fraud else None,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)

