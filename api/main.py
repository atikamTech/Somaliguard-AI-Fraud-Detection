from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel


app = FastAPI(title="Somaliguard-AI: Fraud Detection API")

ROOT = Path(__file__).resolve().parent.parent
MODELS_PATH = ROOT / "models"


def load_best_model():
    best_path = MODELS_PATH / "best_model.pkl"
    if best_path.exists():
        return joblib.load(best_path)
    # backwards compatibility
    return joblib.load(MODELS_PATH / "fraud_model.pkl")


model = load_best_model()


def normalize_service(service: str | None) -> str:
    if not service:
        return ""
    return service.strip().lower()


class Transaction(BaseModel):
    amount: float
    old_balance: float
    hour: int
    service: str = ""


@app.get("/")
def home():
    return {"message": "Welcome to Somaliguard-AI. Developed by Atika Isse Ali."}


@app.post("/predict")
def predict_fraud(data: Transaction):
    # Prepare the data for the model (ML uses only amount, old_balance, hour)
    features = np.array([[data.amount, data.old_balance, int(data.hour)]])

    prediction = int(model.predict(features)[0])
    is_fraud = prediction == 1

    # Probability (if supported by the model/pipeline)
    probability = None
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(features)[0]
        probability = float(proba[1])  # probability of class 1

    service_n = normalize_service(data.service)
    amount = float(data.amount)
    hour = int(data.hour)

    # Rule-based "reasons" that we add in addition to the ML prediction.
    reasons: list[str] = []

    # Service limits (from the defense rules)
    if ("evc" in service_n) and amount > 500:
        reasons.append("Exceeded EVC Limit")
    if ("zaad" in service_n) and amount > 2000:
        reasons.append("Exceeded Zaad Limit")

    # Round number anomaly
    if abs(amount - 10_000) < 0.005:
        reasons.append("Common in money laundering")

    # Night-time alert (2:00 AM to 5:00 AM)
    if 2 <= hour < 5:
        reasons.append("Night-Time Transaction")

    reason = reasons[0] if reasons else None

    # If the ML predicts fraud but no specific reasons fired, label it as pattern anomaly.
    if is_fraud and not reasons:
        reasons = ["Pattern Anomaly"]
        reason = "Pattern Anomaly"

    result = "SUSPICIOUS" if is_fraud else "SAFE"

    return {
        "prediction": result,
        "fraud_probability": f"{probability:.2%}" if probability is not None else None,
        "status": "Success",
        "reasons": reasons if is_fraud else [],
        "reason": reason if is_fraud else None,
    }