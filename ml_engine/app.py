from __future__ import annotations

import time as _time
from collections import defaultdict, deque
from pathlib import Path
from typing import Deque, Dict, List, Optional, Tuple

import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator


app = FastAPI(title="SomaliGuard ML Engine (Fraud + Reasons)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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


# ---------------------------------------------------------------------------
# Stateful cache  —  stores the last 3 transactions per user_id
# Each entry is a tuple of (timestamp, amount, service_normalised)
# ---------------------------------------------------------------------------
_CACHE_MAX  = 3          # keep last N entries per user
_CACHE_TTL  = 3600       # evict entries older than 1 hour (seconds)

# user_id → deque of (timestamp, amount, service)
_tx_cache: Dict[str, Deque[Tuple[float, float, str]]] = defaultdict(
    lambda: deque(maxlen=_CACHE_MAX)
)

# Global dictionary for Hormuud demo tracking
user_memory: Dict[str, dict] = {}


def _evict_stale(user_id: str, now: float) -> None:
    """Remove cache entries older than _CACHE_TTL for a given user."""
    q = _tx_cache[user_id]
    while q and (now - q[0][0]) > _CACHE_TTL:
        q.popleft()


def _push_to_cache(user_id: str, timestamp: float, amount: float, service: str) -> None:
    _evict_stale(user_id, timestamp)
    _tx_cache[user_id].append((timestamp, amount, service))


def _get_cache(user_id: str, now: float) -> List[Tuple[float, float, str]]:
    _evict_stale(user_id, now)
    return list(_tx_cache[user_id])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class HistoricalTransaction(BaseModel):
    """A minimal past transaction used to compute behavioural context."""
    amount: float = Field(..., gt=0)
    timestamp: float = Field(..., description="Unix epoch seconds")


class Transaction(BaseModel):
    """Current transaction being evaluated, plus optional recent history."""

    amount: float = Field(..., gt=0)
    old_balance: float
    hour: int = Field(..., ge=0, le=23)
    service: str = ""
    timestamp: float = Field(..., description="Unix epoch seconds of this transaction")

    # Optional: client-supplied history (2 most recent, oldest first).
    # When provided it is merged with the server-side cache.
    history: List[HistoricalTransaction] = Field(default=[], max_length=2)

    # Optional stable user/session identifier used for the stateful cache.
    # Defaults to "default" so single-user deployments work without changes.
    user_id: str = Field(default="default", description="Stable user/session identifier")

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
    risk_score: int = Field(..., ge=0, le=100)
    fraud_probability: Optional[str]
    status: str
    reasons: List[str]
    reason: Optional[str]
    behavioral_features: dict
    # Narrative: human-readable AI "thought" explaining the scoring decision
    narrative: str
    # Stateful computed metrics
    velocity_multiplier: float
    value_jump: Optional[float]
    channel_hop_blocked: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_service(service: str) -> str:
    s = (service or "").strip().lower()
    s = s.replace("-", " ").replace("_", " ")
    return " ".join(s.split())


# Threshold constants — centralised for easy tuning
_RAPID_BURST_SECS    = 60        # < 1 min → velocity_multiplier = 5.0
_FAST_BURST_SECS     = 600       # < 10 min → intermediate multiplier
_SLOW_FLOOR_SECS     = 600       # ≥ 10 min → velocity_multiplier = 1.0
_NIGHT_HOP_RATIO     = 3.0       # value_jump > 3 AND night hour → score 98
_EXTREME_JUMP_RATIO  = 5.0       # value_jump > 5  → risk ceiling (100)
_CHANNEL_HOP_WINDOW  = 300       # 5 minutes for channel-hop detection
_CHANNEL_HOP_SCORE   = 100       # Block score on channel hop


def compute_velocity_multiplier(time_delta_seconds: Optional[float]) -> float:
    """
    Returns:
        5.0  if gap < 60 s   (immediate re-fire — extreme risk)
        2.5  if gap < 600 s  (fast re-fire — elevated risk)
        1.0  if gap ≥ 600 s or no history
    """
    if time_delta_seconds is None:
        return 1.0
    if time_delta_seconds < _RAPID_BURST_SECS:
        return 5.0
    if time_delta_seconds < _FAST_BURST_SECS:
        return 2.5
    return 1.0


def detect_channel_hop(
    cache_history: List[Tuple[float, float, str]],
    current_service: str,
    current_timestamp: float,
) -> bool:
    """
    Returns True if EVC Plus, Sahal, AND Zaad all appear within the last
    _CHANNEL_HOP_WINDOW seconds (including the current transaction).
    """
    cutoff = current_timestamp - _CHANNEL_HOP_WINDOW
    recent_services = {current_service}
    for ts, _amt, svc in cache_history:
        if ts >= cutoff:
            recent_services.add(svc)
    required = {"evc plus", "evc", "sahal", "zaad"}
    # Check if we have all three channel types represented
    has_evc   = any("evc" in s for s in recent_services)
    has_sahal = any("sahal" in s for s in recent_services)
    has_zaad  = any("zaad" in s for s in recent_services)
    return has_evc and has_sahal and has_zaad


def compute_behavioral_features(
    current_amount: float,
    current_timestamp: float,
    current_hour: int,
    history: List[HistoricalTransaction],
    cache_history: List[Tuple[float, float, str]],
) -> dict:
    """
    Merges client-supplied history with the server-side cache to compute:
        time_delta      – seconds to the most recent preceding transaction
        amount_scaling  – current / avg(all history amounts)
        is_night_burst  – time_delta < 300 s AND hour ∈ [0, 5]
    """
    # Build a unified list of (timestamp, amount) from both sources
    all_hist: List[Tuple[float, float]] = []
    for h in history:
        all_hist.append((h.timestamp, h.amount))
    for ts, amt, _ in cache_history:
        all_hist.append((ts, amt))
    # Sort oldest-first and deduplicate approximate duplicates (±1 s)
    all_hist.sort()
    deduped: List[Tuple[float, float]] = []
    for entry in all_hist:
        if not deduped or abs(entry[0] - deduped[-1][0]) > 1.0:
            deduped.append(entry)
    # Keep only those before current_timestamp
    prior = [(ts, amt) for ts, amt in deduped if ts < current_timestamp]
    # Use up to _CACHE_MAX most recent
    prior = prior[-_CACHE_MAX:]

    time_delta: Optional[float] = None
    amount_scaling: Optional[float] = None
    is_night_burst: bool = False

    if prior:
        last_ts, _ = prior[-1]
        time_delta = current_timestamp - last_ts

        avg_amt = sum(amt for _, amt in prior) / len(prior)
        if avg_amt > 0:
            amount_scaling = current_amount / avg_amt

        if time_delta < 300 and 0 <= current_hour <= 5:
            is_night_burst = True

    return {
        "time_delta": time_delta,
        "amount_scaling": amount_scaling,
        "is_night_burst": is_night_burst,
    }


def compute_risk_score(
    base_probability: Optional[float],
    behavioral: dict,
    is_fraud: bool,
    velocity_multiplier: float,
    value_jump: Optional[float],
    channel_hop_blocked: bool,
) -> Tuple[int, str]:
    """
    Stateful, priority-layered risk engine.
    Returns (score 0-100, narrative string).

    Priority order:
      1.  Channel hop  → 100, immediate block
      2.  value_jump > 5×  → 100, ceiling
      3.  value_jump > 3 AND night hour  → 98
      4.  Base × velocity_multiplier, then additive boosts
    """
    time_delta     = behavioral["time_delta"]
    amount_scaling = behavioral["amount_scaling"]
    is_night_burst = behavioral["is_night_burst"]

    # ------------------------------------------------------------------
    # 1. Channel hop — all three payment rails hit within 5 minutes
    # ------------------------------------------------------------------
    if channel_hop_blocked:
        return 100, (
            "[CRITICAL] Channel Hopping Signature — EVC Plus, Sahal, and Zaad "
            "accessed within 5 minutes. Account flagged for immediate block."
        )

    # ------------------------------------------------------------------
    # 2. Extreme value jump (> 5×)
    # ------------------------------------------------------------------
    if value_jump is not None and value_jump > _EXTREME_JUMP_RATIO:
        return 100, (
            f"[ALERT] Catastrophic value escalation detected — current amount is "
            f"{value_jump:.1f}× the recent average. Risk ceiling engaged."
        )

    # ------------------------------------------------------------------
    # 3. Night-hour high-value jump (> 3× AND hour 0–4)
    # ------------------------------------------------------------------
    if value_jump is not None and value_jump > _NIGHT_HOP_RATIO and is_night_burst:
        return 98, (
            f"[ACTION] High-speed value escalation at anomalous hour — "
            f"amount is {value_jump:.1f}× recent average during night window. "
            "Intercepting transfer to unverified gateway."
        )

    # ------------------------------------------------------------------
    # 4. Dynamic base × velocity multiplier
    # ------------------------------------------------------------------
    base: float
    if base_probability is not None:
        base = base_probability * 100
    else:
        base = 85.0 if is_fraud else 15.0

    # Apply velocity multiplier BEFORE additive boosts
    scaled_base = base * velocity_multiplier

    boost = 0.0

    # Moderate time gap (1–10 min)
    if time_delta is not None and _RAPID_BURST_SECS <= time_delta < _FAST_BURST_SECS:
        boost += 8.0

    # Moderate value spike (3–5×)
    if value_jump is not None and value_jump >= 3.0:
        boost += 14.0
    elif value_jump is not None and value_jump > 2.0:
        boost += 6.0

    # Night burst compound signal
    if is_night_burst:
        boost += 10.0

    raw = scaled_base + boost
    score = int(min(max(round(raw), 0), 100))

    # Build narrative
    if score >= 70:
        if velocity_multiplier >= 5.0:
            narrative = (
                f"[ANALYSIS] Pattern matches 'Escalated Probe' signature — "
                f"velocity multiplier {velocity_multiplier:.1f}× applied. "
                "Rapid-fire transaction sequence detected."
            )
        elif value_jump and value_jump > 2.0:
            narrative = (
                f"[ANALYSIS] Value jump of {value_jump:.1f}× vs recent average "
                "raises high-confidence fraud signal."
            )
        else:
            narrative = (
                "[ANALYSIS] ML model indicates high fraud probability. "
                "Pattern Anomaly — escalating for review."
            )
    elif score >= 40:
        narrative = (
            "[MONITORING] Elevated risk trajectory detected. "
            "Transaction queued for secondary verification."
        )
    else:
        narrative = (
            f"[CLEAR] Transaction behavioural profile within normal bounds. "
            f"Risk score: {score}/100."
        )

    return score, narrative


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return {"message": "SomaliGuard ML Engine is running."}


@app.post("/predict", response_model=PredictionResponse)
def predict_fraud(data: Transaction):
    now        = data.timestamp
    amount     = float(data.amount)
    old_balance = float(data.old_balance)
    hour       = int(data.hour)
    service_n  = normalize_service(data.service)

    # ------------------------------------------------------------------
    # Hormuud Demo: user_memory state tracking
    # ------------------------------------------------------------------
    time_delta = None
    last_amount = None
    if data.user_id in user_memory:
        last_tx = user_memory[data.user_id]
        time_delta = now - last_tx['timestamp']
        last_amount = last_tx['amount']
    
    user_memory[data.user_id] = {'timestamp': now, 'amount': amount}


    # ------------------------------------------------------------------
    # 1. Retrieve stateful cache for this user and compute features
    # ------------------------------------------------------------------
    cache_history = _get_cache(data.user_id, now)

    behavioral = compute_behavioral_features(
        current_amount=amount,
        current_timestamp=now,
        current_hour=hour,
        history=data.history,
        cache_history=cache_history,
    )

    # ------------------------------------------------------------------
    # 2. Velocity multiplier and value jump
    # ------------------------------------------------------------------
    velocity_mult = compute_velocity_multiplier(behavioral["time_delta"])

    value_jump: Optional[float] = behavioral["amount_scaling"]

    # ------------------------------------------------------------------
    # 3. Channel-hop detection (uses cache + current service)
    # ------------------------------------------------------------------
    channel_hop = detect_channel_hop(cache_history, service_n, now)

    # ------------------------------------------------------------------
    # 4. Push current transaction to cache AFTER reading (so this tx
    #    is available for the NEXT request's cache lookup)
    # ------------------------------------------------------------------
    _push_to_cache(data.user_id, now, amount, service_n)

    # ------------------------------------------------------------------
    # 5. ML prediction (core features only)
    # ------------------------------------------------------------------
    features = np.array([[amount, old_balance, hour]])

    pred_label = int(model.predict(features)[0])
    is_fraud   = pred_label == 1

    probability: Optional[float] = None
    if hasattr(model, "predict_proba"):
        proba       = model.predict_proba(features)[0]
        probability = float(proba[1])

    # ------------------------------------------------------------------
    # 6. Hard rule overrides + reason generation
    # ------------------------------------------------------------------
    reasons: List[str] = []

    if channel_hop:
        reasons.append("Channel Hopping Detected (EVC → Sahal → Zaad within 5 min)")
        is_fraud = True

    strict_evc   = ("evc" in service_n) and amount > 500
    strict_zaad  = ("zaad" in service_n) and amount > 2000
    strict_sahal = ("sahal" in service_n) and amount > 1000

    if strict_evc:   reasons.append("Exceeded EVC Limit")
    if strict_zaad:  reasons.append("Exceeded Zaad Limit")
    if strict_sahal: reasons.append("Exceeded Sahal Limit")

    if strict_evc or strict_zaad or strict_sahal:
        is_fraud = True

    if abs(amount - 10_000) < 0.005:
        reasons.append("Common in money laundering")
    if 2 <= hour < 5:
        reasons.append("Night-Time Transaction")

    if behavioral["is_night_burst"]:
        reasons.append("Night Burst Detected (rapid transaction in night hours)")
    if value_jump is not None and value_jump > 3:
        reasons.append(f"Abnormal Amount Spike (×{value_jump:.1f} vs recent avg)")
    if behavioral["time_delta"] is not None and behavioral["time_delta"] < _RAPID_BURST_SECS:
        reasons.append(f"Rapid Succession ({behavioral['time_delta']:.0f}s gap, ×{velocity_mult:.1f} velocity)")

    reason = reasons[0] if reasons else None

    if is_fraud and not reasons:
        reasons = ["Pattern Anomaly"]
        reason  = "Pattern Anomaly"

    # ------------------------------------------------------------------
    # 7. Risk score + narrative
    # ------------------------------------------------------------------
    risk_score, narrative = compute_risk_score(
        base_probability=probability,
        behavioral=behavioral,
        is_fraud=is_fraud,
        velocity_multiplier=velocity_mult,
        value_jump=value_jump,
        channel_hop_blocked=channel_hop,
    )

    result_prediction = "SUSPICIOUS" if is_fraud else "SAFE"
    
    # ------------------------------------------------------------------
    # 8. Hormuud Demo Business Rules Overrides
    # ------------------------------------------------------------------
    if time_delta is not None and time_delta < 60 and last_amount is not None and amount > (last_amount * 5):
        risk_score = 98
        reason = "High-Velocity Value Escalation"
        if reason not in reasons:
            reasons.insert(0, reason)
        result_prediction = "SUSPICIOUS"
        narrative = f"[HORMUUD AI ALERT] High-Velocity Value Escalation detected! Sequence interval: {int(time_delta)}s. Amount spiked from {last_amount} to {amount}."
    
    if 0 <= hour <= 5:
        risk_score = min(risk_score + 20, 100)
        narrative += f" [NIGHT PENALTY] Adding 20% risk penalty for anomalous processing hour ({hour}:00)."
        if risk_score > 50:
            result_prediction = "SUSPICIOUS"

    # Bakara Market normal business override
    if hour == 14 and 10 <= amount <= 150:
        risk_score = min(risk_score, 19)
        result_prediction = "SAFE"
        narrative = f"[CLEAR] Normal business flow. Amount within acceptable bounds. Risk score capped at {risk_score}%."

    return PredictionResponse(
        prediction=result_prediction,
        risk_score=risk_score,
        fraud_probability=f"{probability:.2%}" if probability is not None else None,
        status="Success",
        reasons=reasons if result_prediction == "SUSPICIOUS" else [],
        reason=reason if result_prediction == "SUSPICIOUS" else None,
        behavioral_features={
            "time_delta_seconds": behavioral["time_delta"],
            "amount_scaling": round(value_jump, 4) if value_jump is not None else None,
            "is_night_burst": behavioral["is_night_burst"],
        },
        narrative=narrative,
        velocity_multiplier=velocity_mult,
        value_jump=round(value_jump, 4) if value_jump is not None else None,
        channel_hop_blocked=channel_hop,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
