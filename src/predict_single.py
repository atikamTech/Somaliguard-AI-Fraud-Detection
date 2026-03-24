import sys
import joblib
import numpy as np
import os

def predict():
    try:
        # 1. Get data sent from NestJS
        amount = float(sys.argv[1])
        balance = float(sys.argv[2])
        hour = int(sys.argv[3])

        # 2. Load the trained model
        # This path goes out of 'src' and into 'models'
        model_path = os.path.join(os.path.dirname(__file__), '..', 'models', 'best_model.pkl')
        if not os.path.exists(model_path):
            # Backwards compatibility
            model_path = os.path.join(os.path.dirname(__file__), '..', 'models', 'fraud_model.pkl')
        
        if not os.path.exists(model_path):
            print("Error: Model file not found")
            return

        model = joblib.load(model_path)

        # 3. Perform Prediction
        features = np.array([[amount, balance, hour]])
        prediction = model.predict(features)[0]
        
        # 4. Return plain text for the terminal to understand
        if prediction == 1:
            print("FRAUD")
        else:
            print("SAFE")

    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    predict()