# TerraSense --- Landslide Risk Intelligence

TerraSense is a web application for **screening-level landslide-risk
assessment**. It combines environmental data with a weighted scoring
engine and presents the result in a dashboard with an interactive map.
An optional Groq-hosted language model generates a natural-language
explanation of the assessment.

> **Important:** TerraSense is a prototype and planning aid, not a
> validated landslide prediction system. Do not use its score as the
> sole basis for emergency response, engineering, or public-safety
> decisions. Verify conditions with qualified professionals and
> authoritative local sources.

## Features

-   **City-based assessment** using a city name.
-   **Interactive map assessment** by dropping a pin at a coordinate.
-   **Risk score and classification** produced by the application's
    weighted scoring engine.
-   **Environmental inputs** including rainfall, elevation/slope, soil
    type, and vegetation cover.
-   **AI-generated explanation** through the Groq API, when configured
    and available.
-   **Fallback behavior** when the AI explanation service is not
    configured or unavailable.
-   **Charts and dashboard** for component scores and raw environmental
    values.
-   **Heatmap mode** for sampling a local area around a selected point.
-   **PDF report export** from the dashboard.

Features depend on the available source code, network connectivity, and
third-party API availability.

## Technology stack

-   **Frontend:** HTML, CSS, JavaScript
-   **Maps:** Leaflet with OpenStreetMap-based tiles from CARTO
-   **Backend:** Python and Flask
-   **Environmental data:** Open-Meteo and Open-Elevation
-   **AI explanations:** Groq API using a chat-completion model
    configured in the backend
-   **Charts and PDF export:** Chart.js and jsPDF (loaded by the
    frontend)
