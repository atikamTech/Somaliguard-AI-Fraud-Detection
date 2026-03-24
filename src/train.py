from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "dataset" / "somaliguard_transactions.csv"
MODELS_PATH = ROOT / "models"
MODELS_PATH.mkdir(parents=True, exist_ok=True)


def augment_until_target_rows(df: pd.DataFrame, target_rows: int = 1500) -> pd.DataFrame:
    """
    If the CSV has fewer than 1,000 rows, generate enough new rows to hit 1,500.
    We synthesize by sampling existing rows and adding small noise to numeric features.
    """

    if len(df) >= 1000:
        return df

    n_to_add = target_rows - len(df)
    if n_to_add <= 0:
        return df

    rng = np.random.default_rng(42)
    sampled = df.sample(n=n_to_add, replace=True, random_state=42).reset_index(drop=True)

    # New unique sender IDs for the synthetic rows
    if "sender_id" in sampled.columns:
        sampled["sender_id"] = [f"USER_SYN_{i}_{rng.integers(100000, 999999)}" for i in range(n_to_add)]

    # Perturb numeric features
    if "amount" in sampled.columns:
        base = sampled["amount"].astype(float).to_numpy()
        noise = rng.normal(loc=0.0, scale=0.05, size=n_to_add)  # 5% relative noise
        sampled["amount"] = np.round(np.clip(base * (1.0 + noise), 0.01, None), 2)

    if "old_balance" in sampled.columns:
        base = sampled["old_balance"].astype(float).to_numpy()
        noise = rng.normal(loc=0.0, scale=0.05, size=n_to_add)
        sampled["old_balance"] = np.round(np.clip(base * (1.0 + noise), 0.01, None), 2)

    if "hour" in sampled.columns:
        sampled["hour"] = rng.integers(0, 24, size=n_to_add)

    # Keep labels consistent with the dataset logic:
    # dataset generation used "amount > old_balance => is_fraud = 1"
    if "amount" in sampled.columns and "old_balance" in sampled.columns and "is_fraud" in sampled.columns:
        sampled["is_fraud"] = (sampled["amount"].astype(float) > sampled["old_balance"].astype(float)).astype(int)

    return pd.concat([df, sampled], ignore_index=True)


def main() -> None:
    df = pd.read_csv(DATA_PATH)
    df = augment_until_target_rows(df, target_rows=1500)

    print("Training starting (SomaliGuard ML)…")
    print(f"Dataset rows: {len(df)}")

    X = df[["amount", "old_balance", "hour"]]
    y = df["is_fraud"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y if len(set(y)) > 1 else None
    )

    # Logistic Regression (scaled)
    lr_model = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            ("lr", LogisticRegression(max_iter=1000, random_state=42)),
        ]
    )
    lr_model.fit(X_train, y_train)
    pred_lr = lr_model.predict(X_test)
    acc_lr = accuracy_score(y_test, pred_lr)

    # Random Forest
    rf_model = RandomForestClassifier(n_estimators=200, random_state=42)
    rf_model.fit(X_train, y_train)
    pred_rf = rf_model.predict(X_test)
    acc_rf = accuracy_score(y_test, pred_rf)

    print("\nRESULTS (holdout accuracy):")
    print(f"Logistic Regression: {acc_lr:.4f} ({acc_lr:.2%})")
    print(f"Random Forest:       {acc_rf:.4f} ({acc_rf:.2%})")

    if acc_rf >= acc_lr:
        best_model = rf_model
        best_name = "RandomForestClassifier"
    else:
        best_model = lr_model
        best_name = "LogisticRegression (scaled pipeline)"

    best_path = MODELS_PATH / "best_model.pkl"
    joblib.dump(best_model, best_path)

    # Backwards compatibility (existing code loads fraud_model.pkl)
    joblib.dump(best_model, MODELS_PATH / "fraud_model.pkl")

    print(f"\nBest model: {best_name}")
    print(f"Saved to: {best_path}")


if __name__ == "__main__":
    main()