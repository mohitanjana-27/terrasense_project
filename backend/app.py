"""
TerraSense — Flask API Server
Main entry point for the landslide risk assessment backend.
"""

import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

from risk_engine import calculate_risk
from api_helpers import (
    get_elevation,
    get_explanation,
    get_rainfall,
    get_rainfall_for_coordinates,
)

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()
# load_dotenv()

app = Flask(__name__)
CORS(app)

# Valid input options
VALID_SOILS = {"clay", "loam", "sandy", "rocky"}
VALID_VEGETATION = {"dense", "moderate", "sparse", "bare"}


@app.route("/assess", methods=["POST"])
def assess():
    """
    POST /assess
    Body: { "city": str, "soil": str, "vegetation": str }
    Returns: full risk assessment JSON.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    city = (data.get("city") or "").strip()
    soil = (data.get("soil") or "").strip().lower()
    vegetation = (data.get("vegetation") or "").strip().lower()

    # --- Input Validation ---
    errors = []
    if not city:
        errors.append("'city' is required.")
    if soil not in VALID_SOILS:
        errors.append(f"'soil' must be one of: {', '.join(sorted(VALID_SOILS))}.")
    if vegetation not in VALID_VEGETATION:
        errors.append(
            f"'vegetation' must be one of: {', '.join(sorted(VALID_VEGETATION))}."
        )
    if errors:
        return jsonify({"error": " ".join(errors)}), 400

    # --- Fetch external data ---
    try:
        rainfall_mm, lat, lon = get_rainfall(city)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except ConnectionError as exc:
        return jsonify({"error": str(exc)}), 502

    elevation_m, slope_deg, elevation_is_fallback = get_elevation(lat, lon)

    # --- Run scoring engine ---
    result = calculate_risk(rainfall_mm, elevation_m, slope_deg, soil, vegetation)

    # --- Get AI explanation ---
    explanation = get_explanation(city, result["scores"], result["risk_level"])

    # --- Build response ---
    response = {
        "city": city,
        "risk_level": result["risk_level"],
        "total_score": result["total_score"],
        "scores": result["scores"],
        "explanation": explanation,
        "raw": {
            "rainfall_mm": round(rainfall_mm, 2),
            "elevation_m": round(elevation_m, 1),
            "slope_deg": round(slope_deg, 2),
            "latitude": lat,
            "longitude": lon,
        },
        "warnings": [],
    }

    if elevation_is_fallback:
        response["warnings"].append(
            "Elevation API unavailable — using fallback value of 100m."
        )

    return jsonify(response)


@app.route("/assess-coordinate", methods=["POST"])
def assess_coordinate():
    """
    POST /assess-coordinate
    Body: { "lat": number, "lon": number, "soil": str, "vegetation": str }
    Returns: risk assessment JSON for an exact map point.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    soil = (data.get("soil") or "").strip().lower()
    vegetation = (data.get("vegetation") or "").strip().lower()

    errors = []
    try:
        lat = float(data.get("lat"))
        lon = float(data.get("lon"))
    except (TypeError, ValueError):
        lat = None
        lon = None
        errors.append("'lat' and 'lon' must be valid numbers.")

    if lat is not None and not -90 <= lat <= 90:
        errors.append("'lat' must be between -90 and 90.")
    if lon is not None and not -180 <= lon <= 180:
        errors.append("'lon' must be between -180 and 180.")
    if soil not in VALID_SOILS:
        errors.append(f"'soil' must be one of: {', '.join(sorted(VALID_SOILS))}.")
    if vegetation not in VALID_VEGETATION:
        errors.append(
            f"'vegetation' must be one of: {', '.join(sorted(VALID_VEGETATION))}."
        )
    if errors:
        return jsonify({"error": " ".join(errors)}), 400

    try:
        rainfall_mm = get_rainfall_for_coordinates(lat, lon)
    except ConnectionError as exc:
        return jsonify({"error": str(exc)}), 502

    elevation_m, slope_deg, elevation_is_fallback = get_elevation(lat, lon)
    result = calculate_risk(rainfall_mm, elevation_m, slope_deg, soil, vegetation)
    location_label = f"the selected coordinate ({lat:.4f}, {lon:.4f})"
    explanation = get_explanation(
        location_label,
        result["scores"],
        result["risk_level"],
    )

    response = {
        "city": f"{lat:.4f}, {lon:.4f}",
        "risk_level": result["risk_level"],
        "total_score": result["total_score"],
        "scores": result["scores"],
        "explanation": explanation,
        "raw": {
            "rainfall_mm": round(rainfall_mm, 2),
            "elevation_m": round(elevation_m, 1),
            "slope_deg": round(slope_deg, 2),
            "latitude": lat,
            "longitude": lon,
        },
        "warnings": [],
    }

    if elevation_is_fallback:
        response["warnings"].append(
            "Elevation API unavailable — using fallback value of 100m."
        )

    return jsonify(response)


@app.route("/health", methods=["GET"])
def health():
    """Simple health-check endpoint."""
    return jsonify({"status": "ok"})


# --- Global error handler ---
@app.errorhandler(Exception)
def handle_exception(exc):
    """Catch-all for unhandled exceptions."""
    app.logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return jsonify({"error": "An unexpected error occurred. Please try again."}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5001))
    app.run(debug=True, port=port)