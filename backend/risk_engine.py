"""
TerraSense — Risk Scoring Engine
Implements the weighted geotechnical scoring model (0-100)
incorporating both terrain elevation and actual calculated slope gradient.
"""


def _rainfall_score(rainfall_mm: float) -> int:
    """Score rainfall intensity (0-25)."""
    if rainfall_mm > 10:
        return 25
    elif rainfall_mm > 5:
        return 18
    elif rainfall_mm >= 2:
        return 12
    else:
        return 5


def _slope_elevation_score(elevation_m: float, slope_deg: float) -> int:
    """
    Score terrain vulnerability (0-25) using both elevation and actual slope.
    Flat terrain (slope < 2.0 degrees) is capped at 5 because it cannot slide.
    Otherwise, we take the maximum of the elevation score and slope score.
    """
    if slope_deg < 2.0:
        return 5

    # Elevation component (0-25)
    if elevation_m > 600:
        elev_score = 25
    elif elevation_m > 300:
        elev_score = 18
    elif elevation_m >= 100:
        elev_score = 12
    else:
        elev_score = 5

    # Slope angle component (0-25)
    if slope_deg >= 15.0:
        slope_score = 25
    elif slope_deg >= 8.0:
        slope_score = 18
    elif slope_deg >= 3.0:
        slope_score = 12
    else:
        slope_score = 5

    return max(elev_score, slope_score)


# Mapping tables — keys are lowercase
SOIL_SCORES = {
    "rocky": 4,
    "sandy": 10,
    "loam": 14,
    "clay": 20,
}

VEGETATION_SCORES = {
    "dense": 4,
    "moderate": 10,
    "sparse": 15,
    "bare": 20,
}


def _soil_score(soil_type: str) -> int:
    """Score soil type (0-20)."""
    return SOIL_SCORES.get(soil_type.lower(), 10)


def _vegetation_score(vegetation: str) -> int:
    """Score vegetation cover (0-20)."""
    return VEGETATION_SCORES.get(vegetation.lower(), 10)


def _instability_bonus(rainfall_mm: float, soil_type: str, vegetation: str) -> int:
    """
    Combined instability bonus (0-10).
    Rewards extreme combinations that compound landslide risk.
    """
    soil = soil_type.lower()
    veg = vegetation.lower()

    if rainfall_mm > 10 and soil == "clay" and veg == "bare":
        return 10
    elif rainfall_mm > 5 and soil == "clay":
        return 5
    else:
        return 0


def _classify_risk(total_score: int) -> str:
    """Map total score to risk level string."""
    if total_score >= 70:
        return "High"
    elif total_score >= 40:
        return "Medium"
    else:
        return "Low"


def calculate_risk(
    rainfall_mm: float,
    elevation_m: float,
    slope_deg: float,
    soil_type: str,
    vegetation: str,
) -> dict:
    """
    Run the full risk assessment.

    Returns:
        {
            "total_score": int,
            "risk_level": "Low" | "Medium" | "High",
            "scores": {
                "rainfall": int,
                "elevation": int,
                "soil": int,
                "vegetation": int,
                "bonus": int
            }
        }
    """
    scores = {
        "rainfall": _rainfall_score(rainfall_mm),
        "elevation": _slope_elevation_score(elevation_m, slope_deg),
        "soil": _soil_score(soil_type),
        "vegetation": _vegetation_score(vegetation),
        "bonus": _instability_bonus(rainfall_mm, soil_type, vegetation),
    }

    total = sum(scores.values()) 
    risk_level = _classify_risk(total)

    return {
        "total_score": total,
        "risk_level": risk_level,
        "scores": scores,
    }