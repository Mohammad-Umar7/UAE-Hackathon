"""Asset list: every signature-architecture GLB with its builder, LODs and superseded OSM ids."""
import importlib

MODULES = ['ap_omaa', 'ap_omdb', 'ap_omsj']


def assets():
    out = []
    for m in MODULES:
        try:
            mod = importlib.import_module(m)
        except ModuleNotFoundError as e:
            if e.name == m:
                continue
            raise
        out.extend(mod.ASSETS)
    return out


def by_name(name):
    for a in assets():
        if a['name'] == name:
            return a
    return None
