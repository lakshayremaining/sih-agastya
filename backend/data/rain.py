"""
Agastya — Rain Data: Open-Meteo API Integration
================================================
Fetches real hourly rainfall data for Minto Bridge, Delhi
from the Open-Meteo API (free, no API key required).

Includes local JSON caching for offline demo operation.
"""

import json
import os
import time
from pathlib import Path
from datetime import datetime, timedelta

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_FILE = CACHE_DIR / "rain.json"

# Minto Bridge, Delhi
LATITUDE = 28.6280
LONGITUDE = 77.2197

# In-memory TTL cache for live rain data (300 seconds / 5 mins)
_LIVE_RAIN_MEMORY_CACHE: dict = {}
_LIVE_RAIN_CACHE_TIME: float = 0.0
_LIVE_RAIN_CACHE_TTL_SEC: float = 300.0


async def fetch_live_rain() -> dict:
    """
    Fetch real-time rainfall data from Open-Meteo API.
    Uses in-memory TTL cache and falls back to disk cached data if offline.

    Returns:
        Dict with: current_rain_mm, hourly_forecast, location, timestamp.
    """
    global _LIVE_RAIN_MEMORY_CACHE, _LIVE_RAIN_CACHE_TIME

    now = time.time()
    if _LIVE_RAIN_MEMORY_CACHE and (now - _LIVE_RAIN_CACHE_TIME) < _LIVE_RAIN_CACHE_TTL_SEC:
        return _LIVE_RAIN_MEMORY_CACHE

    try:
        import httpx
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={LATITUDE}&longitude={LONGITUDE}"
            f"&hourly=precipitation,rain,weathercode"
            f"&current_weather=true"
            f"&timezone=Asia/Kolkata"
            f"&forecast_days=1"
        )
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            data = response.json()

        result = _parse_open_meteo(data)

        # Update in-memory cache
        _LIVE_RAIN_MEMORY_CACHE = result
        _LIVE_RAIN_CACHE_TIME = now

        # Cache for offline disk use
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump(result, f, indent=2)

        return result

    except Exception as e:
        # Fall back to cached data
        fallback = _load_cached_rain(str(e))
        if fallback:
            _LIVE_RAIN_MEMORY_CACHE = fallback
            _LIVE_RAIN_CACHE_TIME = now
        return fallback



def _parse_open_meteo(data: dict) -> dict:
    """Parse Open-Meteo API response into our format."""
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    rain = hourly.get("rain", [])
    codes = hourly.get("weathercode", [])

    current = data.get("current_weather", {})

    hourly_data = []
    for i in range(len(times)):
        hourly_data.append({
            "time": times[i] if i < len(times) else "",
            "precipitation_mm": precip[i] if i < len(precip) else 0,
            "rain_mm": rain[i] if i < len(rain) else 0,
            "weather_code": codes[i] if i < len(codes) else 0,
        })

    # Current rainfall (from the current hour's data)
    current_hour = datetime.now().hour
    current_rain = rain[current_hour] if current_hour < len(rain) else 0

    return {
        "location": "Minto Bridge, New Delhi",
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "timestamp": datetime.now().isoformat(),
        "current_rain_mm": current_rain,
        "current_temperature_c": current.get("temperature", 0),
        "wind_speed_kmh": current.get("windspeed", 0),
        "hourly_forecast": hourly_data,
        "source": "Open-Meteo API (live)",
    }


def _load_cached_rain(error_msg: str = "") -> dict:
    """Load cached rain data for offline demo."""
    if CACHE_FILE.exists():
        with open(CACHE_FILE) as f:
            data = json.load(f)
        data["source"] = f"Cached data (offline). Last error: {error_msg}"
        return data

    # Generate realistic sample data for demo
    return _generate_demo_rain(error_msg)


def _generate_demo_rain(error_msg: str = "") -> dict:
    """Generate realistic demo rainfall data for Minto Bridge during monsoon."""
    now = datetime.now()
    hourly_data = []

    # Simulate a typical Delhi monsoon day pattern
    # Heavy rain in afternoon/evening (2pm-8pm), moderate morning
    rain_pattern = [
        0, 0, 0, 0, 0, 1,    # 12am-5am: dry/trace
        2, 5, 8, 12, 15, 18,  # 6am-11am: building up
        22, 30, 45, 55, 70, 65,  # 12pm-5pm: heavy afternoon
        50, 35, 20, 10, 5, 2,   # 6pm-11pm: tapering off
    ]

    for hour in range(24):
        hourly_data.append({
            "time": (now.replace(hour=hour, minute=0, second=0)).isoformat(),
            "precipitation_mm": rain_pattern[hour],
            "rain_mm": rain_pattern[hour],
            "weather_code": 61 if rain_pattern[hour] > 10 else (51 if rain_pattern[hour] > 0 else 0),
        })

    current_hour = now.hour
    current_rain = rain_pattern[current_hour] if current_hour < 24 else 0

    return {
        "location": "Minto Bridge, New Delhi",
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "timestamp": now.isoformat(),
        "current_rain_mm": current_rain,
        "current_temperature_c": 32.5,
        "wind_speed_kmh": 12.0,
        "hourly_forecast": hourly_data,
        "source": f"Demo data (monsoon pattern). {error_msg}",
    }
