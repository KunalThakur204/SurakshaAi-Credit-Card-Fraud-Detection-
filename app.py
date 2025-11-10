from flask import Flask, render_template, request, jsonify
import pandas as pd
import numpy as np
import pickle
import os, json

app = Flask(__name__)

# -------- data folder + json files ensure ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
USERS_PATH = os.path.join(DATA_DIR, "users.json")
PREDS_PATH = os.path.join(DATA_DIR, "predictions.json")

def ensure_data_store():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(USERS_PATH):
        with open(USERS_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)
    if not os.path.exists(PREDS_PATH):
        with open(PREDS_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)

ensure_data_store()
# ---------------------------------------------------

# Optional model
MODEL_AVAILABLE = False
model = None
FEATURES = [
    "transaction_time","Amount",
    "transaction_type_score","transaction_pattern_score",
    "transaction_amount_pattern","transaction_context_score",
    "transaction_frequency_score","location_risk_score",
    "merchant_category_score","merchant_trust_score",
    "geo_location_score","customer_profile_score",
    "customer_behavior_score","spending_behavior_score",
    "spending_risk_score","device_risk_score",
    "unusual_device_score","card_usage_pattern",
    "card_risk_score","payment_channel_score",
    "velocity_score","unusual_activity_score",
    "historical_risk_score","anomaly_detection_score",
    "network_activity_score","fraud_suspect_score",
    "fraud_tendency_score","fraud_probability_score",
    "fraud_indicator_score","suspicious_pattern_score"
]

def try_load_model():
    global MODEL_AVAILABLE, model
    try:
        if os.path.exists("fraud_model.pkl"):
            with open("fraud_model.pkl", "rb") as f:
                model = pickle.load(f)
            MODEL_AVAILABLE = True
            print("fraud_model.pkl loaded")
        else:
            print("fraud_model.pkl not found. Using dummy scoring.")
    except Exception as e:
        print("Model load failed:", e)

try_load_model()

def dummy_fraud_model(data):
    try:
        amount = float(data.get('Amount', 0))
        risk_score = min(amount / 1000.0, 0.7)
        fraud_suspect = float(data.get('fraud_suspect_score', 0.5))
        unusual_activity = float(data.get('unusual_activity_score', 0.5))
        device_risk = float(data.get('device_risk_score', 0.5))
        pattern = float(data.get('transaction_amount_pattern', 0.5))
        risk_score += (fraud_suspect + unusual_activity + device_risk + pattern) / 4 * 0.3
        risk_score += np.random.uniform(-0.05, 0.05)
        prob = max(0.0, min(1.0, risk_score))
        pred = "Fraud" if prob >= 0.6 else "Legitimate"
        return {"prediction": pred, "probability": round(prob, 4)}
    except Exception:
        return {"prediction": "Error", "probability": 0.0}

def model_predict(data):
    if not MODEL_AVAILABLE:
        return dummy_fraud_model(data)
    try:
        row = []
        for col in FEATURES:
            val = data.get(col, 0.0)
            try:
                row.append(float(val))
            except:
                row.append(0.0)
        X = pd.DataFrame([row], columns=FEATURES)
        if hasattr(model, "predict_proba"):
            prob = float(model.predict_proba(X)[0][1])
        else:
            yhat = float(model.predict(X)[0])
            prob = max(0.0, min(1.0, yhat))
        pred = "Fraud" if prob >= 0.5 else "Legitimate"
        return {"prediction": pred, "probability": round(prob, 4)}
    except Exception as e:
        print("Model predict failed:", e)
        return dummy_fraud_model(data)

@app.route("/")
def home(): return render_template("index.html")

@app.route("/about")
def about(): return render_template("about.html")

@app.route("/contact")
def contact(): return render_template("contact.html")

@app.route("/login")
def login_page(): return render_template("login.html")

@app.route("/register")
def register_page(): return render_template("register.html")

@app.route("/dashboard")
def user_dashboard(): return render_template("user_dashboard.html")

@app.route("/admin")
def admin_dashboard(): return render_template("admin_dashboard.html")

@app.route("/api/predict", methods=["POST"])
def api_predict():
    data = request.get_json() or {}
    result = model_predict(data)
    return jsonify(result)

# ---- SAVE SNAPSHOT (localStorage -> server JSON) ----
@app.route("/api/save_snapshot", methods=["POST"])
def save_snapshot():
    try:
        # accept both fetch/json and sendBeacon blob
        raw = request.get_data(cache=False, as_text=True)
        payload = {}
        try:
            payload = json.loads(raw) if raw else {}
        except Exception:
            payload = request.get_json(force=True) or {}

        users = payload.get("users", [])
        preds = payload.get("predictions", [])
        ensure_data_store()

        with open(USERS_PATH, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2, ensure_ascii=False)
        with open(PREDS_PATH, "w", encoding="utf-8") as f:
            json.dump(preds, f, indent=2, ensure_ascii=False)

        print(f"[save_snapshot] users={len(users)} preds={len(preds)}")
        return jsonify({"ok": True, "users": len(users), "predictions": len(preds)})
    except Exception as e:
        print("save_snapshot error:", e)
        return jsonify({"ok": False, "error": str(e)}), 500

# Debug helper: see counts and absolute paths
@app.route("/api/debug_files")
def debug_files():
    ensure_data_store()
    try:
        with open(USERS_PATH, "r", encoding="utf-8") as f:
            u = json.load(f)
        with open(PREDS_PATH, "r", encoding="utf-8") as f:
            p = json.load(f)
        return jsonify({
            "users_count": len(u),
            "predictions_count": len(p),
            "paths": {"users": USERS_PATH, "predictions": PREDS_PATH}
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)