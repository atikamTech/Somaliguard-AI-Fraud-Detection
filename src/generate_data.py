import pandas as pd
import numpy as np
import os

# Create exactly 1,250 samples for the teacher
n_rows = 1250

data = {
    'sender_id': [f"USER_{np.random.randint(100, 999)}" for _ in range(n_rows)],
    'service': np.random.choice(['EVC_Plus', 'Sahal', 'Zaad'], n_rows),
    'amount': np.random.uniform(1, 1000, n_rows).round(2),
    'old_balance': np.random.uniform(5, 2000, n_rows).round(2),
    'hour': np.random.randint(0, 24, n_rows),
    'is_fraud': np.random.choice([0, 1], n_rows, p=[0.90, 0.10])
}

df = pd.DataFrame(data)

# Modern Logic: If amount > balance, it's a suspicious 'Is_Fraud' case
df.loc[df['amount'] > df['old_balance'], 'is_fraud'] = 1

# Save it to your dataset folder
output_path = 'dataset/somaliguard_transactions.csv'
df.to_csv(output_path, index=False)

print(f"✅ Success! Dataset created at: {output_path}")