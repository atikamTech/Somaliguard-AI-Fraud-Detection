from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator


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


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class HistoricalTransaction(BaseModel):
    """A minimal past transaction used to compute behavioural context."""
    amount: float = Field(..., gt=0, description="Transaction amount (must be positive)")
    timestamp: float = Field(..., description="Unix epoch seconds of the transaction")


class Transaction(BaseModel):
    """The current transaction being evaluated, plus recent history."""

    # Core transaction fields
    amount: float = Field(..., gt=0)
    old_balance: float
    hour: int = Field(..., ge=0, le=23)
    service: str = ""

    # Timestamp of the current transaction (Unix epoch seconds)
    timestamp: float = Field(..., description="Unix epoch seconds of this transaction")

    # Up to 2 most-recent historical transactions (oldest first)
    history: List[HistoricalTransaction] = Field(
        default=[],
        max_length=2,
        description="Last 1-2 transactions (oldest first). Used for behavioural features.",
    )

    @model_validator(mode="after")
    def history_timestamps_must_precede_current(self) -> "Transaction":
        for i, h in enumerate(self.history):
            if h.timestamp >= self.timestamp:
                raise ValueError(
                    f"history[{i}].timestamp ({h.timestamp}) must be before "
                    f"current timestamp ({self.timestamp})"
                )
        return self


class PredictionResponse(BaseModel):
    prediction: str
    risk_score: int = Field(..., ge=0, le=100, description="0 = definitely safe, 100 = definitely fraud")
    fraud_probability: Optional[str]
    status: str
    reasons: List[str]
    reason: Optional[str]
    behavioral_features: dict


# ---------------------------------------------------------------------------
# Behavioural feature helpers
# ---------------------------------------------------------------------------

def compute_behavioral_features(
    current_amount: float,
    current_timestamp: float,
    current_hour: int,
    history: List[HistoricalTransaction],
) -> dict:
    """
    Compute three behavioural features from transaction history.

    Returns:
        time_delta      – seconds between the current and the immediately preceding transaction.
                          None when no history is provided.
        amount_scaling  – ratio of current amount vs average amount of the history window.
                          None when no history is provided.
        is_night_burst  – True when time_delta < 300 s AND hour ∈ [0, 5].
    """
    time_delta: Optional[float] = None
    amount_scaling: Optional[float] = None
    is_night_burst: bool = False

    if history:
        # The last (most recent) historical transaction
        last_txn = history[-1]
        time_delta = current_timestamp - last_txn.timestamp

        avg_history_amount = sum(h.amount for h in history) / len(history)
        if avg_history_amount > 0:
            amount_scaling = current_amount / avg_history_amount

        if time_delta is not None and time_delta < 300 and 0 <= current_hour <= 5:
            is_night_burst = True

    return {
        "time_delta": time_delta,
        "amount_scaling": amount_scaling,
        "is_night_burst": is_night_burst,
    }


# Threshold constants — centralised so they are easy to tune.
_RAPID_BURST_SECONDS    = 60       # sub-60 s gap triggers velocity multiplier
_BURST_MULTIPLIER       = 1.5      # base score is scaled up by this factor
_MODERATE_DELTA_SECONDS = 300      # 1-5 min gap → smaller additive boost
_EXTREME_SPIKE_RATIO    = 10.0     # 10× avg history amount → hard override
_EXTREME_SPIKE_SCORE    = 95       # score forced to this value on extreme spike
_MODERATE_SPIKE_RATIO   = 3.0      # 3× avg → meaningful additive boost


def compute_risk_score(
    base_probability: Optional[float],
    behavioral: dict,
    is_fraud: bool,
) -> int:
    """
    Derive a dynamic 0-100 risk score that escalates with behavioural signals.

    Priority order (highest wins / applies first):
      1. HARD OVERRIDE – amount_scaling > 10× → score pinned at 95.
      2. VELOCITY MULTIPLIER – time_delta < 60 s → base × 1.5 before boosts.
      3. ADDITIVE BOOSTS – moderate signals increase the score further.
      4. NIGHT BURST compound – extra penalty when both conditions hold.

    The final score is clamped to [0, 100].
    """
    time_delta     = behavioral["time_delta"]
    amount_scaling = behavioral["amount_scaling"]
    is_night_burst = behavioral["is_night_burst"]

    # ------------------------------------------------------------------
    # 1. Hard override: extreme amount spike relative to history
    # ------------------------------------------------------------------
    if amount_scaling is not None and amount_scaling > _EXTREME_SPIKE_RATIO:
        return _EXTREME_SPIKE_SCORE

    # ------------------------------------------------------------------
    # 2. Base score from the ML model's fraud probability
    # ------------------------------------------------------------------
    base: float
    if base_probability is not None:
        base = base_probability * 100
    else:
        # No probability available – fall back to hard heuristic.
        base = 85.0 if is_fraud else 15.0

    # ------------------------------------------------------------------
    # 3. Velocity multiplier: rapid-fire transactions inflate base score
    # ------------------------------------------------------------------
    if time_delta is not None and time_delta < _RAPID_BURST_SECONDS:
        base = base * _BURST_MULTIPLIER

    # ------------------------------------------------------------------
    # 4. Additive boosts for moderate behavioural signals
    # ------------------------------------------------------------------
    boost = 0.0

    # Moderate time gap (1-5 min) — still suspicious but not a burst
    if time_delta is not None and _RAPID_BURST_SECONDS <= time_delta < _MODERATE_DELTA_SECONDS:
        boost += 8.0

    # Moderate amount spike (3-10×)
    if amount_scaling is not None and amount_scaling >= _MODERATE_SPIKE_RATIO:
        boost += 14.0
    elif amount_scaling is not None and amount_scaling > 2.0:
        boost += 6.0

    # Night burst compound signal
    if is_night_burst:
        boost += 10.0

    raw = base + boost
    return int(min(max(round(raw), 0), 100))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return {"message": "Welcome to Somaliguard-AI. Developed by Atika Isse Ali."}


@app.post("/predict", response_model=PredictionResponse)
def predict_fraud(data: Transaction):
    amount = float(data.amount)
    old_balance = float(data.old_balance)
    hour = int(data.hour)
    service_n = normalize_service(data.service)

    # ------------------------------------------------------------------
    # 1. Compute behavioural features from history
    # ------------------------------------------------------------------
    behavioral = compute_behavioral_features(
        current_amount=amount,
        current_timestamp=data.timestamp,
        current_hour=hour,
        history=data.history,
    )

    # ------------------------------------------------------------------
    # 2. ML prediction (uses core transaction features only)
    # ------------------------------------------------------------------
    features = np.array([[amount, old_balance, hour]])

    prediction = int(model.predict(features)[0])
    is_fraud = prediction == 1

    probability: Optional[float] = None
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(features)[0]
        probability = float(proba[1])  # P(fraud)

    # ------------------------------------------------------------------
    # 3. Rule-based reason generation
    # ------------------------------------------------------------------
    reasons: list[str] = []

    if ("evc" in service_n) and amount > 500:
        reasons.append("Exceeded EVC Limit")
    if ("zaad" in service_n) and amount > 2000:
        reasons.append("Exceeded Zaad Limit")

    if abs(amount - 10_000) < 0.005:
        reasons.append("Common in money laundering")

    # Night-time alert (2:00 AM – 4:59 AM)
    if 2 <= hour < 5:
        reasons.append("Night-Time Transaction")

    # Behavioural alerts
    if behavioral["is_night_burst"]:
        reasons.append("Night Burst Detected (rapid transaction in night hours)")
    if behavioral["amount_scaling"] is not None and behavioral["amount_scaling"] > 3:
        reasons.append(f"Abnormal Amount Spike (×{behavioral['amount_scaling']:.1f} vs recent avg)")
    if behavioral["time_delta"] is not None and behavioral["time_delta"] < 60:
        reasons.append(f"Rapid Succession Transaction ({behavioral['time_delta']:.0f}s gap)")

    reason = reasons[0] if reasons else None

    if is_fraud and not reasons:
        reasons = ["Pattern Anomaly"]
        reason = "Pattern Anomaly"

    # ------------------------------------------------------------------
    # 4. Risk score (0-100)
    # ------------------------------------------------------------------
    risk_score = compute_risk_score(probability, behavioral, is_fraud)

    result = "SUSPICIOUS" if is_fraud else "SAFE"

    return PredictionResponse(
        prediction=result,
        risk_score=risk_score,
        fraud_probability=f"{probability:.2%}" if probability is not None else None,
        status="Success",
        reasons=reasons if is_fraud else [],
        reason=reason if is_fraud else None,
        behavioral_features={
            "time_delta_seconds": behavioral["time_delta"],
            "amount_scaling": round(behavioral["amount_scaling"], 4) if behavioral["amount_scaling"] is not None else None,
            "is_night_burst": behavioral["is_night_burst"],
        },
    )