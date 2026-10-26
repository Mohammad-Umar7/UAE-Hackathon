"""Shared configuration for the SKYPACT OSM geodata pipeline.

Airport reference points (ARP) and elevations come from the UAE GCAA eAIP AD 2.2
(AIRAC AMDT 12/2026), see data/reference/airports.json.  The ARP is the origin of
each airport's local ENU frame (docs/CONVENTIONS.md section 2).
"""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DATA = REPO / "data"
AIRPORTS_DIR = DATA / "airports"
NATIONAL_DIR = DATA / "national"
REFERENCE_DIR = DATA / "reference"
CACHE_DIR = HERE / "cache"  # large downloads (PBF, shapefile zips); git-ignored

USER_AGENT = "SKYPACT-geodata/0.1 (offline airport digital-twin research pipeline; python-requests)"

# Geofabrik GCC-states extract (ODbL).  Overpass was at capacity on the retrieval day,
# so the whole pipeline is driven from one polite bulk download instead of many queries.
PBF_URL = "https://download.geofabrik.de/asia/gcc-states-261025.osm.pbf"
PBF_FILE = CACHE_DIR / "gcc-states-261025.osm.pbf"
PBF_MD5 = "903174491fa477c1dde45ba79a427daa"
PBF_TIMESTAMP = "2026-10-25T21:21:21Z"  # "contains all OSM data up to" (Geofabrik)

# national basemap bbox (lon/lat)
NATIONAL_BBOX = (54.0, 23.9, 56.0, 25.7)  # min_lon, min_lat, max_lon, max_lat

AIRPORTS: dict[str, dict] = {
    "OMAA": {
        "icao": "OMAA",
        "iata": "AUH",
        "name": "Zayed International Airport",
        "city": "Abu Dhabi",
        "arp": {"lat": 24.4330556, "lon": 54.6511111, "elevation_m": 25.3},
        "arp_source": "GCAA eAIP AD 2.2 OMAA: ARP 242559N 0543904E, elevation 83 ft (AIRAC AMDT 12/2026)",
        # generous extraction boxes (min_lon, min_lat, max_lon, max_lat); exact
        # inclusion is decided geometrically in build_layout.py
        "core_bbox": (54.585, 24.385, 54.725, 24.495),
        "context_bbox": (54.555, 24.355, 54.755, 24.525),
        "skyline": None,
    },
    "OMDB": {
        "icao": "OMDB",
        "iata": "DXB",
        "name": "Dubai International Airport",
        "city": "Dubai",
        "arp": {"lat": 25.2527778, "lon": 55.3644444, "elevation_m": 18.9},
        "arp_source": "GCAA eAIP AD 2.2 OMDB: ARP 251510N 0552152E, elevation 62 ft (AIRAC AMDT 12/2026)",
        "core_bbox": (55.320, 25.215, 55.415, 25.285),
        "context_bbox": (55.290, 25.185, 55.445, 25.315),
        # tall buildings for the distant Dubai skyline (Burj Khalifa ~11 km SW)
        "skyline": {"radius_m": 15500.0, "min_height_m": 60.0},
    },
    "OMSJ": {
        "icao": "OMSJ",
        "iata": "SHJ",
        "name": "Sharjah International Airport",
        "city": "Sharjah",
        "arp": {"lat": 25.3291667, "lon": 55.5161111, "elevation_m": 36.3},
        "arp_source": "GCAA eAIP AD 2.2 OMSJ: ARP 251945N 0553058E, elevation 119 ft (AIRAC AMDT 12/2026)",
        "core_bbox": (55.480, 25.300, 55.560, 25.360),
        "context_bbox": (55.450, 25.270, 55.590, 25.390),
        "skyline": None,
    },
}


def projection_string(icao: str) -> str:
    arp = AIRPORTS[icao]["arp"]
    return f"+proj=aeqd +lat_0={arp['lat']} +lon_0={arp['lon']} +datum=WGS84 +units=m"


def skyline_bbox(icao: str) -> tuple[float, float, float, float] | None:
    """lon/lat box enclosing the skyline radius around the ARP."""
    import math

    sk = AIRPORTS[icao].get("skyline")
    if not sk:
        return None
    arp = AIRPORTS[icao]["arp"]
    dlat = sk["radius_m"] / 111_000.0
    dlon = sk["radius_m"] / (111_320.0 * math.cos(math.radians(arp["lat"])))
    return (arp["lon"] - dlon, arp["lat"] - dlat, arp["lon"] + dlon, arp["lat"] + dlat)


def airport_dir(icao: str) -> Path:
    d = AIRPORTS_DIR / icao
    d.mkdir(parents=True, exist_ok=True)
    return d
