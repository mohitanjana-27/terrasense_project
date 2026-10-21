"""
TerraSense — External API Helpers
Integrates Open-Meteo (weather/rainfall), Open-Elevation (with slope calculation),
and Groq LLM APIs (with LLaMA 3.1) with proper error handling and fallbacks.
"""

import math
import os
import requests
from groq import Groq


# ---------------------------------------------------------------------------
# Open-Meteo — live rainfall + coordinates (FREE, no API key needed)
# Geocoding: https://geocoding-api.open-meteo.com
# Weather:   https://api.open-meteo.com
# ---------------------------------------------------------------------------

def _geocode_city(city: str) -> tuple:
    """
    Resolve a city name to (latitude, longitude) using Open-Meteo Geocoding.

    Raises:
        ValueError: if city is not found.
        ConnectionError: if the API is unreachable.
    """
    url = "https://geocoding-api.open-meteo.com/v1/search"
    params = {"name": city, "count": 1, "language": "en", "format": "json"}

    try:
        res = requests.get(url, params=params, timeout=10)
        res.raise_for_status()
    except requests.RequestException as exc:
        raise ConnectionError(f"Geocoding request failed: {exc}")

    data = res.json()
    results = data.get("results")

    if not results:
        raise ValueError(f"City '{city}' not found. Please check the spelling.")

    return results[0]["latitude"], results[0]["longitude"]


def get_rainfall(city: str) -> tuple:
    """
    Fetch rainfall and coordinates for a city using Open-Meteo.
    Queries both past 24h and next 24h hourly forecast, returning the maximum
    hourly precipitation to provide a more reliable indicator of active threat.

    Returns:
        (rainfall_mm: float, lat: float, lon: float)

    Raises:
        ValueError: if city is not found.
        ConnectionError: if the API is unreachable.
    """
    lat, lon = _geocode_city(city)

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "past_days": 1,
        "timezone": "auto",
    }

    try:
        res = requests.get(url, params=params, timeout=10)
        res.raise_for_status()
    except requests.RequestException as exc:
        raise ConnectionError(f"Open-Meteo weather request failed: {exc}")

    data = res.json()
    hourly_precip = data.get("hourly", {}).get("precipitation", [])

    # We check the past 24 hours (index 0-24) and the next 24 hours (index 24-48)
    if len(hourly_precip) >= 48:
        rainfall_mm = max(hourly_precip[:48])
    elif hourly_precip:
        rainfall_mm = max(hourly_precip)
    else:
        rainfall_mm = 20

    return rainfall_mm, lat, lon


def get_rainfall_for_coordinates(lat: float, lon: float) -> float:
    """
    Fetch rainfall directly for a latitude/longitude point using Open-Meteo.

    Returns:
        rainfall_mm: float

    Raises:
        ConnectionError: if the API is unreachable.
    """
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "past_days": 1,
        "timezone": "auto",
    }

    try:
        res = requests.get(url, params=params, timeout=10)
        res.raise_for_status()
    except requests.RequestException as exc:
        raise ConnectionError(f"Open-Meteo weather request failed: {exc}")

    data = res.json()
    hourly_precip = data.get("hourly", {}).get("precipitation", [])

    if len(hourly_precip) >= 48:
        return max(hourly_precip[:48])
    if hourly_precip:
        return max(hourly_precip)
    return 0.0


# ---------------------------------------------------------------------------
# Open-Elevation — elevation + regional slope in degrees
# ---------------------------------------------------------------------------

DEFAULT_ELEVATION = 100.0  # fallback when API is unavailable
DEFAULT_SLOPE = 0.0

def get_elevation(lat: float, lon: float) -> tuple:
    """
    Fetch elevation and calculate regional slope in degrees by batch querying
    the center and 4 surrounding cardinal coordinates (offset by 0.01 degrees, ~1.1km).

    Returns:
        (elevation_m: float, slope_deg: float, is_fallback: bool)
    """
    url = "https://api.open-elevation.com/api/v1/lookup"
    offset = 0.01  # ~1.1km offset to capture terrain gradient

    payload = {
        "locations": [
            {"latitude": lat, "longitude": lon},           # Center [0]
            {"latitude": lat + offset, "longitude": lon},   # North  [1]
            {"latitude": lat - offset, "longitude": lon},   # South  [2]
            {"latitude": lat, "longitude": lon + offset},   # East   [3]
            {"latitude": lat, "longitude": lon - offset}    # West   [4]
        ]
    }

    try:
        res = requests.post(url, json=payload, timeout=10)
        res.raise_for_status()
        results = res.json()["results"]
        elevations = [float(r["elevation"]) for r in results]

        center = elevations[0]
        run = 1110.0  # ~1.1km run distance in meters

        # Calculate absolute height differences
        slope_n = abs(elevations[1] - center) / run
        slope_s = abs(elevations[2] - center) / run
        slope_e = abs(elevations[3] - center) / run
        slope_w = abs(elevations[4] - center) / run

        # Take the maximum gradient of the four directions
        max_gradient = max(slope_n, slope_s, slope_e, slope_w)
        slope_deg = math.degrees(math.atan(max_gradient))

        return center, slope_deg, False

    except Exception:
        # Fallback to 100m, 0.0 deg slope with warning flag
        return DEFAULT_ELEVATION, DEFAULT_SLOPE, True


# ---------------------------------------------------------------------------
# Groq LLM — AI-powered risk explanation (using LLaMA 3.1)
# ---------------------------------------------------------------------------

def get_explanation(city: str, scores: dict, risk_level: str) -> str:
    """
    Generate a geotechnical explanation using Groq's LLaMA 3.1 model.

    Returns:
        A concise but detailed human-readable explanation string.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return (
            "AI explanation unavailable — GROQ_API_KEY not configured. "
            "The risk score is based on the weighted combination of rainfall, "
            "elevation, slope, soil type, and vegetation cover."
        )

    score_lines = "\n".join(
        [
            f"- Rainfall intensity: {scores['rainfall']}/25",
            f"- Terrain slope/elevation: {scores['elevation']}/25",
            f"- Soil susceptibility: {scores['soil']}/20",
            f"- Vegetation protection: {scores['vegetation']}/20",
            f"- Compound instability bonus: {scores['bonus']}/10",
        ]
    )

    system_prompt = (
        "You are a senior geotechnical engineer writing for disaster-risk "
        "planners. Be specific, practical, and easy to understand. Do not "
        "overstate certainty; explain that this is a screening-level estimate "
        "based on the provided scoring inputs."
    )

    prompt = f"""
Write a richer landslide-risk explanation for {city}.

Risk classification: {risk_level}
Component scores:
{score_lines}

Structure the response in 2 short paragraphs:
1. Explain the main drivers of the {risk_level.lower()} risk classification, linking the highest scores to slope stability, runoff, soil saturation, and root reinforcement where relevant.
2. Give practical interpretation for local planning: what conditions could worsen risk, what signs should be monitored, and what mitigation or caution is appropriate.

Keep it between 130 and 190 words. Use domain-specific but understandable language. Avoid bullet points.
""".strip()

    try:
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
        model="llama-3.1-70b-versatile",
        messages=[...],
        temperature=0.7,
        max_tokens=300,
)
        return response.choices[0].message.content.strip()
    except Exception as exc:
        total_score = sum(scores.values())
        dominant_factors = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        top_factors = ", ".join(name.replace("_", " ") for name, _ in dominant_factors[:3])

        return (
            f"AI explanation temporarily unavailable ({type(exc).__name__}). "
            f"The system classified {city} as {risk_level} risk with a total score "
            f"of {total_score}/100. The strongest contributors in this screening "
            f"assessment are {top_factors}, which can influence landslide likelihood "
            f"through rainfall-driven saturation, terrain instability, soil strength, "
            f"and the degree of root reinforcement from vegetation. Local teams should "
            f"treat this as a planning-level indicator, monitor cracks, seepage, "
            f"fresh erosion, leaning trees or poles, and blocked drainage paths, and "
            f"prioritize field verification before making site-specific decisions."
        )