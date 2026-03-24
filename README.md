# 🛡️ Somaliguard: AI-Powered Fraud Detection
**Lead Systems Architect:** Atika Ali | **Status:** Enterprise Ready

Somaliguard is a high-performance cybersecurity suite designed to detect and mitigate mobile money fraud (EVC Plus, Sahal, Zaad) using real-time machine learning.

---

## 🚀 Key Features
* **Biometric Security Gate**: Advanced identity verification layer for authorized personnel.
* **AI Fraud Engine**: Real-time transaction analysis powered by a Random Forest Classifier.
* **Live Monitoring**: Visual radar and status ticker for instant threat detection.
* **Instant Mitigation**: One-click account freezing with encrypted protocol execution.

## 🛠️ Technology Stack
* **Frontend**: Next.js (React), Tailwind CSS, Framer Motion.
* **Backend**: NestJS (Node.js) & FastAPI (Python).
* **Machine Learning**: Scikit-Learn (Random Forest).
* **Infrastructure**: Git-based version control and modular microservices.

## 📂 Project Structure
* `/ml_engine`: Python FastAPI service running the AI model.
* `/somaliguard-frontend`: Next.js web application.
* `/notebooks`: Technical research and model training documentation.
* `/docs`: Confidential system specifications.

## Deployment Instructions
### Run the ML API
From the `ml_engine` folder:

```bash
python app.py
```

The API runs on `http://127.0.0.1:8000`.

### Test `/predict` with curl
```bash
curl -X POST "http://127.0.0.1:8000/predict" ^
  -H "Content-Type: application/json" ^
  -d "{\"amount\":1200,\"old_balance\":900,\"hour\":3,\"service\":\"EVC_Plus\"}"
```

---
**© 2026 Somaliguard Security Solutions. All Rights Reserved.**