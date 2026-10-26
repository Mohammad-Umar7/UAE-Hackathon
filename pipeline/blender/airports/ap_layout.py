"""Read data/airports/<ICAO>/layout.json and data/reference/airports.json.

Positions are in each airport's ENU frame (aeqd about the ARP, x east, y north, metres).
`to_enu(icao, lat, lon)` implements the ellipsoidal azimuthal-equidistant projection of the
layout (`+proj=aeqd +lat_0=ARP +lon_0=ARP +datum=WGS84`): geodesic distance and azimuth from the
ARP (Vincenty inverse on WGS-84), x = s sin(az), y = s cos(az).
"""
import json
import math
import os

import numpy as np

from ap_poly import as_ring

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
_cache = {}


def layout(icao):
    if icao not in _cache:
        with open(os.path.join(REPO, 'data', 'airports', icao, 'layout.json'), encoding='utf-8') as f:
            _cache[icao] = json.load(f)
    return _cache[icao]


def reference(icao=None):
    key = '__ref__'
    if key not in _cache:
        with open(os.path.join(REPO, 'data', 'reference', 'airports.json'), encoding='utf-8') as f:
            _cache[key] = json.load(f)
    ref = _cache[key]
    return ref['airports'][icao] if icao else ref


def building(icao, bid):
    for b in layout(icao)['buildings']:
        if b['id'] == bid:
            return b
    raise KeyError(f'{icao}: building {bid} not in layout.json')


def footprint(icao, bid):
    """(outer ring, [hole rings]) as numpy arrays."""
    b = building(icao, bid)
    return as_ring(b['footprint']), [as_ring(h) for h in (b.get('holes') or [])]


# ------------------------------------------------------------------ geodesy
_A = 6378137.0
_F = 1 / 298.257223563
_B = _A * (1 - _F)


def vincenty_inverse(lat1, lon1, lat2, lon2):
    """Geodesic distance (m) and forward azimuth (deg) on WGS-84."""
    if abs(lat1 - lat2) < 1e-12 and abs(lon1 - lon2) < 1e-12:
        return 0.0, 0.0
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - _F) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - _F) * math.tan(math.radians(lat2)))
    sinU1, cosU1 = math.sin(U1), math.cos(U1)
    sinU2, cosU2 = math.sin(U2), math.cos(U2)
    lam = L
    for _ in range(200):
        sinl, cosl = math.sin(lam), math.cos(lam)
        sin_sig = math.hypot(cosU2 * sinl, cosU1 * sinU2 - sinU1 * cosU2 * cosl)
        cos_sig = sinU1 * sinU2 + cosU1 * cosU2 * cosl
        sig = math.atan2(sin_sig, cos_sig)
        sin_al = cosU1 * cosU2 * sinl / sin_sig
        cos2_al = 1 - sin_al ** 2
        cos2sm = cos_sig - 2 * sinU1 * sinU2 / cos2_al if cos2_al else 0.0
        C = _F / 16 * cos2_al * (4 + _F * (4 - 3 * cos2_al))
        lam_p = lam
        lam = L + (1 - C) * _F * sin_al * (sig + C * sin_sig * (cos2sm + C * cos_sig * (-1 + 2 * cos2sm ** 2)))
        if abs(lam - lam_p) < 1e-13:
            break
    u2 = cos2_al * (_A ** 2 - _B ** 2) / _B ** 2
    Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    dsig = Bk * sin_sig * (cos2sm + Bk / 4 * (cos_sig * (-1 + 2 * cos2sm ** 2) - Bk / 6 * cos2sm *
                                              (-3 + 4 * sin_sig ** 2) * (-3 + 4 * cos2sm ** 2)))
    s = _B * Ak * (sig - dsig)
    az = math.atan2(cosU2 * math.sin(lam), cosU1 * sinU2 - sinU1 * cosU2 * math.cos(lam))
    return s, (math.degrees(az) + 360.0) % 360.0


def to_enu(icao, lat, lon):
    arp = layout(icao)['arp']
    s, az = vincenty_inverse(arp['lat'], arp['lon'], lat, lon)
    a = math.radians(az)
    return np.array([s * math.sin(a), s * math.cos(a)])
