"""Builds the SKYPACT 2-minute demo film: cuts the recorded footage to the narration, then writes index.html, one
scene per section (footage, camera moves, highlights, callouts, cursor) and the captions scene.

    python build/build.py            # cut footage + write HTML
    python build/build.py --html     # HTML only (footage already cut)

Inputs: the screen recordings and narration in the session scratchpad (paths below). Every time is in seconds.
"""
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
SCRATCH = Path(r"C:/Users/omerj/AppData/Local/Temp/claude/0cff163aca41ce14/5dd50b38-a55d-491f-bd58-afe3e5359c7d/scratchpad")
MAIN = SCRATCH / "rec" / "main.webm"
END = SCRATCH / "rec" / "end2.webm"
VO = SCRATCH / "vo"
FPS = 30
TOTAL = 120.0

AMBER = "#FFC24B"

# ---------------------------------------------------------------- the edit
# Each section: its slot in the film, when its narration starts (offset into the slot), and the footage pieces
# (source in/out in the recording, and how long the piece lasts in the film).
SECTIONS = [
    dict(id="s1", start=0.0, dur=12.0, vo=0.35, pieces=[(2.2, 7.4, 5.2), (7.4, 10.5, 6.8)]),
    dict(id="s2", start=12.0, dur=11.0, vo=0.3, pieces=[(16.3, 27.3, 11.0)]),
    dict(id="s3", start=23.0, dur=22.6, vo=0.2, pieces=[(28.85, 32.05, 4.3), (32.05, 35.30, 6.0), (55.75, 59.0, 3.3), (59.0, 62.2, 5.0), (62.2, 67.3, 4.0)]),
    dict(id="s4", start=45.6, dur=23.1, vo=0.3, pieces=[(67.45, 74.35, 9.3), (74.35, 83.35, 10.3), (83.35, 88.95, 3.5)]),
    dict(id="s5", start=68.7, dur=11.9, vo=0.3, pieces=[(89.45, 94.78, 3.9), (94.78, 99.81, 3.9), (99.81, 101.30, 4.1)]),
    dict(id="s6", start=80.6, dur=13.0, vo=0.3, pieces=[(102.0, 109.8, 13.0)]),
    dict(id="s7", start=93.6, dur=14.0, vo=0.3, pieces=[(109.9, 116.3, 8.2), (116.4, 123.3, 5.8)]),
    dict(id="s8", start=107.6, dur=12.4, vo=0.8, end=True),
]


def T(sid, t):
    """film time → time inside a section"""
    s = next(x for x in SECTIONS if x["id"] == sid)
    return round(t - s["start"], 3)


# Highlights, in the recording's 1920x1080 pixel space and in film time: a spotlight box (x, y, w, h), when it shows,
# and an optional tag (text, side). Rings: round markers on the map.
SPOTS = {
    "s1": [
        dict(kind="ring", box=(578, 866, 246, 50), t0=5.35, t1=10.6),
        dict(kind="ring", box=(806, 470, 246, 52), t0=6.3, t1=10.6),
        dict(kind="ring", box=(1162, 320, 246, 56), t0=6.8, t1=10.6),
    ],
    "s2": [dict(box=(100, 172, 452, 98), t0=17.9, t1=22.8, tag="Landings: 30 → 12 an hour", side="below")],
    "s3": [
        dict(box=(172, 207, 318, 42), t0=29.9, t1=33.2, tag="If nobody acts", side="below"),
        dict(box=(172, 207, 1016, 42), t0=34.7, t1=36.5, tag="The plan against doing nothing", side="below"),
        dict(box=(172, 207, 322, 42), t0=38.0, t1=41.5, tag="Independent safety check", side="below"),
    ],
    "s4": [
        dict(box=(322, 300, 1368, 70), t0=48.2, t1=50.9),
        dict(box=(322, 370, 1368, 68), t0=51.2, t1=53.0),
        dict(box=(322, 438, 1368, 68), t0=53.3, t1=54.85),
        dict(box=(330, 172, 680, 336), t0=56.8, t1=61.0, tag="Without SKYPACT", side="below"),
        dict(box=(1010, 172, 680, 336), t0=61.3, t1=65.15, tag="With SKYPACT", side="below"),
        dict(box=(322, 540, 1368, 330), t0=65.4, t1=68.6, tag="Planes circling all evening: without vs with", side="above"),
    ],
    "s5": [
        dict(box=(1536, 168, 358, 742), t0=69.6, t1=72.9, tag="Sharjah's duty manager, on the apron", side="left", radius=46),
        dict(box=(1272, 246, 404, 48), t0=74.6, t1=77.3, tag="The supervisor's final yes", side="below"),
    ],
    "s6": [
        dict(kind="ring", box=(1168, 405, 244, 56), t0=82.2, t1=85.7),
        dict(kind="ring", box=(1093, 484, 232, 56), t0=83.6, t1=85.7),
    ],
    "s7": [
        dict(box=(322, 328, 1368, 70), t0=97.6, t1=101.6, tag="Re-run after approval: 31 → 5 low-fuel diversions", side="below"),
        dict(box=(1450, 372, 458, 240), t0=102.0, t1=104.0, tag="Every human decision, recorded", side="below-right"),
        dict(box=(104, 192, 1804, 176), t0=104.2, t1=107.4, tag="Replays the evening exactly", side="below"),
    ],
}

# Camera moves on the footage, per section: (film time, scale, x, y, duration, ease); x/y translate in px, origin 0 0.
CAMERA = {
    "s1": [(5.2, 1.0, 0, 0, 0, None), (5.6, 1.05, -48, -30, 6.2, "sine.inOut")],
    "s2": [(12.0, 1.0, 0, 0, 0, None), (12.0, 1.04, -38, -10, 5.4, "sine.inOut"), (17.6, 1.2, -6, -16, 0.7, "power2.inOut")],
    "s4": [(45.6, 1.0, 0, 0, 0, None), (46.0, 1.05, -48, -14, 8.6, "sine.inOut"), (54.9, 1.0, 0, 0, 0.5, "power2.inOut")],
    "s6": [(80.6, 1.0, 0, 0, 0, None), (80.8, 1.12, -110, -60, 12.6, "sine.inOut")],
}

# Data callouts: (film t0, t1, big text, small text, position)
CALLOUTS = {
    "s1": [(1.0, 5.0, "19 flights", "diverted from Dubai International by fog in one morning · Gulf News, 20 Nov 2025", "tr")],
    "s6": [(85.6, 91.6, "18:00 → 18:05", "fog at Abu Dhabi → plan approved by every stakeholder (simulated evening)", "br")],
    "s7": [(93.9, 97.4, "18.2%", "of UAE GDP comes from aviation and the tourism it brings · IATA, 2025", "br"),
           (97.7, 101.6, "Tens of thousands of USD", "what a single diversion can cost an airline (industry estimates)", "br")],
}

# Cursor path: (film time, x, y, click)
CURSOR = {"s5": [(70.6, 1960, 1020, False), (72.35, 1716, 792, False), (72.6, 1716, 792, True), (73.6, 1700, 760, False),
                 (76.2, 1480, 272, False), (76.45, 1480, 272, True), (77.6, 1520, 330, False)]}


# ---------------------------------------------------------------- footage
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2000:])
        raise SystemExit(f"failed: {' '.join(map(str, cmd[:6]))}")


def cut_section(s):
    out = PROJECT / "assets" / "clips" / f"{s['id']}.mp4"
    if s.get("end"):
        # the closing shot: the 3D view without the app's chrome, cropped and scaled to fill the frame
        vf = f"trim=start=0.3:end={0.3 + s['dur']},setpts=PTS-STARTPTS,crop=1538:865:237:175,scale=1920:1080:flags=lanczos,fps={FPS},format=yuv420p"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(END), "-vf", vf, "-an", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-g", "15",
             "-movflags", "+faststart", str(out)])
        return
    parts, labels = [], []
    for i, (a, b, d) in enumerate(s["pieces"]):
        k = d / (b - a)  # stretch factor: >1 slows the piece down
        parts.append(f"[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)*{k:.6f},fps={FPS}[p{i}]")
        labels.append(f"[p{i}]")
    fc = ";".join(parts) + f";{''.join(labels)}concat=n={len(labels)}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,trim=duration={s['dur']},format=yuv420p[v]"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(MAIN), "-filter_complex", fc, "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "17",
         "-preset", "slow", "-g", "15", "-movflags", "+faststart", str(out)])


def probe(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode().strip())


# ---------------------------------------------------------------- captions
FUNCTION_WORDS = {"in", "a", "an", "the", "to", "and", "of", "from", "on", "for", "its", "it", "it's", "with", "by", "at", "is"}
NUMBER = re.compile(r"^(nineteen|thirty|twelve|twenty-nine|five|sixty|percent|six|hundred|fifty-one|nine|four|eighteen|ninety-day|half|minutes|18:00|18:05|19)$", re.I)


def caption_groups():
    spec = json.loads((VO / "script.json").read_text(encoding="utf8"))
    groups = []
    for s in SECTIONS:
        if s.get("end"):
            continue  # the closing card shows these words itself
        text = next(x["text"] for x in spec["sections"] if x["id"] == s["id"])
        words = json.loads((VO / f"words_{s['id']}.json").read_text(encoding="utf8"))["words"]
        tokens = text.split()
        # align the script's tokens (with punctuation) to the timed words, in order
        norm = lambda w: re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))
        ti, timed = 0, []
        for w in words:
            while ti < len(tokens) and norm(tokens[ti]) != norm(w["text"]):
                ti += 1
            tok = tokens[ti] if ti < len(tokens) else w["text"]
            ti += 1
            timed.append(dict(text=tok, start=s["start"] + s["vo"] + w["start"], end=s["start"] + s["vo"] + w["end"]))
        # clauses end at punctuation; a long clause is split into near-equal parts of at most 6 words
        clause = []
        for i, w in enumerate(timed):
            clause.append(w)
            if re.search(r"[.,:;!?]$", w["text"]) or i == len(timed) - 1:
                n = len(clause)
                parts = -(-n // 6)
                size = -(-n // parts)
                for k in range(0, n, size):
                    groups.append(clause[k:k + size])
                clause = []
    out = []
    for i, g in enumerate(groups):
        start = max(g[0]["start"] - 0.05, out[-1]["end"] + 0.02 if out else 0)
        end = g[-1]["end"] + 0.35
        if i + 1 < len(groups):
            end = min(end, groups[i + 1][0]["start"] - 0.06)
        out.append(dict(start=round(start, 3), end=round(max(end, g[-1]["end"]), 3), words=[w["text"] for w in g]))
    return out


# ---------------------------------------------------------------- HTML
BASE_CSS = """
#root { position: absolute; inset: 0; overflow: hidden; background: #0b1017; font-family: "Inter", sans-serif; }
.cam { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }
.cam video { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; }
.spot { position: absolute; }
.spot .in { position: absolute; inset: 0; border-radius: 14px; box-shadow: 0 0 0 4px #FFC24B, 0 0 0 4000px rgba(6, 10, 16, 0.5); }
.ring .in { border-radius: 14px; box-shadow: 0 0 0 4px #FFC24B, 0 0 26px 6px rgba(255, 194, 75, 0.35); }
.tag { position: absolute; white-space: nowrap; background: #FFC24B; color: #10151c; font-weight: 700; font-size: 30px;
       letter-spacing: -0.01em; padding: 9px 16px; border-radius: 9px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.callout { position: absolute; width: 640px; padding: 26px 30px 28px; border-radius: 16px; background: rgba(11, 16, 23, 0.96);
           border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); color: #e9edf2; }
.callout .big { font-size: 64px; font-weight: 800; letter-spacing: -0.03em; color: #FFC24B; line-height: 1.02; }
.callout .small { margin-top: 10px; font-size: 28px; line-height: 1.32; color: #cfd6df; }
.cursor { position: absolute; left: 0; top: 0; width: 46px; height: 46px; }
.cursor .ripple { position: absolute; left: -28px; top: -28px; width: 56px; height: 56px; border-radius: 50%; border: 4px solid #FFC24B; }
"""


def tag_pos(box, side):
    x, y, w, h = box
    if side == "below":
        return f"left:{x}px; top:{y + h + 16}px;"
    if side == "below-right":
        return f"right:{1920 - x - w}px; top:{y + h + 16}px;"
    if side == "above":
        return f"left:{x}px; top:{y - 66}px;"
    if side == "left":
        return f"right:{1920 - x + 18}px; top:{y + 24}px;"
    return f"left:{x + w + 18}px; top:{y}px;"


def callout_pos(pos):
    return {"tr": "right:84px; top:140px;", "tl": "left:150px; top:140px;", "br": "right:84px; bottom:170px;"}[pos]


def scene_html(s):
    sid, start, dur = s["id"], s["start"], s["dur"]
    els, js = [], []
    # footage inside the camera wrapper; spots ride with the camera
    cam_inner = [f'<video id="{sid}-v" class="clip" data-start="0" data-duration="{dur}" src="assets/clips/{sid}.mp4" muted playsinline data-track-index="0"></video>']
    for i, sp in enumerate(SPOTS.get(sid, [])):
        x, y, w, h = sp["box"]
        t0, t1 = T(sid, sp["t0"]), T(sid, sp["t1"])
        cls = "spot ring" if sp.get("kind") == "ring" else "spot"
        rad = f' style="border-radius:{sp["radius"]}px"' if sp.get("radius") else ""
        tag = ""
        if sp.get("tag"):
            tag = f'<div class="tag" id="{sid}-sp{i}-tag" style="{tag_pos(sp["box"], sp.get("side", "below"))}">{html.escape(sp["tag"])}</div>'
        cam_inner.append(
            f'<div id="{sid}-sp{i}" class="clip" data-start="{t0}" data-duration="{round(t1 - t0, 3)}" data-track-index="{2 + i}" '
            f'data-layout-allow-overlap data-layout-allow-occlusion style="position:absolute; inset:0;">'
            f'<div class="{cls}" style="left:{x}px; top:{y}px; width:{w}px; height:{h}px;"><div class="in" id="{sid}-sp{i}-in"{rad}></div></div>{tag}</div>')
        js.append(f'tl.fromTo("#{sid}-sp{i}-in", {{opacity: 0, scale: 1.06}}, {{opacity: 1, scale: 1, duration: 0.45, ease: "expo.out"}}, {t0});')
        js.append(f'tl.to("#{sid}-sp{i}-in", {{opacity: 0, duration: 0.25, ease: "power2.in"}}, {round(t1 - 0.27, 3)});')
        if sp.get("tag"):
            js.append(f'tl.fromTo("#{sid}-sp{i}-tag", {{opacity: 0, y: 8}}, {{opacity: 1, y: 0, duration: 0.35, ease: "expo.out"}}, {round(t0 + 0.12, 3)});')
            js.append(f'tl.to("#{sid}-sp{i}-tag", {{opacity: 0, duration: 0.2, ease: "power2.in"}}, {round(t1 - 0.22, 3)});')
    els.append(f'<div id="{sid}-cam" class="cam">' + "".join(cam_inner) + "</div>")
    for (t, sc, x, y, d, ease) in CAMERA.get(sid, []):
        tt = T(sid, t)
        if d == 0:
            js.append(f'tl.set("#{sid}-cam", {{scale: {sc}, x: {x}, y: {y}}}, {tt});')
        else:
            js.append(f'tl.to("#{sid}-cam", {{scale: {sc}, x: {x}, y: {y}, duration: {d}, ease: "{ease}"}}, {tt});')
    if sid not in CAMERA:
        js.append(f'tl.set("#{sid}-cam", {{scale: 1, x: 0, y: 0}}, 0);')
    for i, (t0, t1, big, small, pos) in enumerate(CALLOUTS.get(sid, [])):
        a, b = T(sid, t0), T(sid, t1)
        els.append(f'<div id="{sid}-co{i}" class="clip" data-start="{max(0, a)}" data-duration="{round(b - max(0, a), 3)}" data-track-index="{10 + i}" style="position:absolute; inset:0;">'
                   f'<div class="callout" id="{sid}-co{i}-in" style="{callout_pos(pos)}"><div class="big">{html.escape(big)}</div><div class="small">{html.escape(small)}</div></div></div>')
        js.append(f'tl.fromTo("#{sid}-co{i}-in", {{opacity: 0, y: 14, filter: "blur(6px)"}}, {{opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: "expo.out"}}, {max(0, a)});')
        js.append(f'tl.to("#{sid}-co{i}-in", {{opacity: 0, filter: "blur(6px)", duration: 0.25, ease: "power2.in"}}, {round(b - 0.27, 3)});')
    if sid in CURSOR:
        pts = CURSOR[sid]
        a, b = T(sid, pts[0][0]), T(sid, pts[-1][0])
        els.append(f'<div id="{sid}-cur" class="clip" data-start="{a}" data-duration="{round(b - a + 0.3, 3)}" data-track-index="14" style="position:absolute; inset:0;">'
                   f'<div class="cursor" id="{sid}-cur-in"><div class="ripple" id="{sid}-rip"></div>'
                   '<svg width="46" height="46" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.2 L11.6 22 L14.4 20.8 L11.5 14.1 L17.8 14.1 Z" fill="#ffffff" stroke="#10151c" stroke-width="1.4" stroke-linejoin="round"/></svg>'
                   "</div></div>")
        js.append(f'tl.set("#{sid}-cur-in", {{x: {pts[0][1]}, y: {pts[0][2]}, scale: 1}}, {a});')
        js.append(f'tl.set("#{sid}-rip", {{opacity: 0, scale: 0.3}}, {a});')
        prev = pts[0]
        for p in pts[1:]:
            t = T(sid, p[0])
            if p[3]:
                js.append(f'tl.to("#{sid}-cur-in", {{scale: 0.86, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.inOut"}}, {round(t - 0.04, 3)});')
                js.append(f'tl.fromTo("#{sid}-rip", {{opacity: 1, scale: 0.3}}, {{opacity: 0, scale: 1.6, duration: 0.5, ease: "power2.out"}}, {t});')
            else:
                pt = T(sid, prev[0])
                js.append(f'tl.to("#{sid}-cur-in", {{x: {p[1]}, y: {p[2]}, duration: {round(t - pt, 3)}, ease: "power3.inOut"}}, {pt});')
            prev = p
        js.append(f'tl.to("#{sid}-cur-in", {{opacity: 0, duration: 0.25}}, {round(b, 3)});')
    if s.get("end"):
        els.append(END_CARD)
        js.extend(END_JS)
    body = "\n    ".join(els)
    script = "\n    ".join(js)
    extra_css = END_CSS if s.get("end") else ""
    return f"""<template>
  <style>
{BASE_CSS}{extra_css}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080">
    {body}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {script}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""


END_CSS = """
.end-scrim { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(8, 12, 18, 0.92) 0%, rgba(8, 12, 18, 0.78) 42%, rgba(8, 12, 18, 0.15) 75%, rgba(8, 12, 18, 0) 100%); }
.end { position: absolute; left: 150px; top: 250px; width: 1300px; color: #f2f5f8; }
.end .mark { display: flex; align-items: center; gap: 26px; }
.end .mark img { width: 112px; height: 112px; border-radius: 26px; }
.end .word { font-size: 112px; font-weight: 800; letter-spacing: -0.035em; line-height: 1; }
.end .line { margin-top: 44px; white-space: nowrap; font-size: 52px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
.end .line b { color: #FFC24B; font-weight: 700; }
.end .next { margin-top: 30px; font-size: 32px; color: #c9d1db; }
.meta { position: absolute; left: 150px; bottom: 74px; font-size: 28px; color: #aab4c1; font-family: "Inter", sans-serif; }
"""

END_CARD = """<div id="s8-scrim" class="clip" data-start="0" data-duration="12.4" data-track-index="20" style="position:absolute; inset:0;"><div class="end-scrim" id="s8-scrim-in"></div></div>
    <div id="s8-mark" class="clip" data-start="0.4" data-duration="12.0" data-track-index="21" style="position:absolute; inset:0;">
      <div class="end"><div class="mark"><img id="s8-logo" src="assets/img/skypact-logo.png" alt="SKYPACT logo"/><div class="word" id="s8-word">SKYPACT</div></div>
      <div class="line" id="s8-line">Three airports. One plan. <b>People in charge.</b></div>
      <div class="next" id="s8-next">Next: a 90-day shadow pilot on one airport pair</div></div>
      <div class="meta" id="s8-meta">Live demo · uae-hackathon.vercel.app · simulated evening on real airport layouts</div>
    </div>"""

END_JS = [
    'tl.fromTo("#s8-scrim-in", {opacity: 0}, {opacity: 1, duration: 0.8, ease: "power2.inOut"}, 0);',
    'tl.fromTo("#s8-logo", {opacity: 0, scale: 0.7, rotation: -12}, {opacity: 1, scale: 1, rotation: 0, duration: 0.7, ease: "back.out(1.6)"}, 0.5);',
    'tl.fromTo("#s8-word", {opacity: 0, clipPath: "inset(0 100% 0 0)"}, {opacity: 1, clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power3.out"}, 0.75);',
    'tl.fromTo("#s8-line", {opacity: 0, filter: "blur(8px)"}, {opacity: 1, filter: "blur(0px)", duration: 0.35, ease: "power3.out"}, 1.7);',
    'tl.fromTo("#s8-next", {opacity: 0, filter: "blur(6px)"}, {opacity: 1, filter: "blur(0px)", duration: 0.3, ease: "power3.out"}, 4.9);',
    'tl.fromTo("#s8-meta", {opacity: 0}, {opacity: 1, duration: 0.4, ease: "power2.out"}, 6.6);',
]


def captions_html(groups):
    els, js = [], []
    for i, g in enumerate(groups):
        words = []
        for w in g["words"]:
            core = re.sub(r"[^\w:-]", "", w)
            cls = ' class="n"' if NUMBER.match(core) else ""
            words.append(f"<span{cls}>{html.escape(w)}</span>")
        els.append(f'<div id="cap{i}" class="clip cap" data-start="{g["start"]}" data-duration="{round(g["end"] - g["start"], 3)}" data-track-index="0">'
                   f'<div class="box" id="cap{i}-in">{" ".join(words)}</div></div>')
        js.append(f'tl.fromTo("#cap{i}-in", {{opacity: 0, y: 6}}, {{opacity: 1, y: 0, duration: 0.14, ease: "power2.out"}}, {g["start"]});')
    return f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; font-family: "Inter", sans-serif; pointer-events: none; }}
    .cap {{ position: absolute; left: 0; right: 0; bottom: 58px; text-align: center; }}
    .cap .box {{ display: inline-block; max-width: 1560px; padding: 12px 26px 14px; border-radius: 12px; background: rgba(10, 14, 20, 0.8);
                 color: #ffffff; font-size: 44px; font-weight: 600; letter-spacing: -0.012em; line-height: 1.2; }}
    .cap .n {{ color: #FFC24B; }}
  </style>
  <div id="root" data-composition-id="captions" data-width="1920" data-height="1080">
    {chr(10).join("    " + e for e in els)}
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {chr(10).join("    " + j for j in js)}
    window.__timelines["captions"] = tl;
  </script>
</template>
"""


def index_html():
    hosts, audio = [], []
    for i, s in enumerate(SECTIONS):
        hosts.append(f'<div id="{s["id"]}" data-composition-id="{s["id"]}" data-composition-src="compositions/{s["id"]}.html" data-start="{s["start"]}" '
                     f'data-duration="{s["dur"]}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:1"></div>')
        d = json.loads((VO / f"words_{s['id']}.json").read_text(encoding="utf8"))["duration"]
        audio.append(f'<audio id="vo-{s["id"]}" class="clip" src="assets/vo/{s["id"]}.mp3" data-start="{round(s["start"] + s["vo"], 3)}" data-duration="{d}" data-volume="1" data-track-index="4"></audio>')
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>SKYPACT · 2-minute demo</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0b1017; }}
      #root {{ position: relative; width: 100%; height: 100%; font-family: "Inter", sans-serif; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080">
      {chr(10).join("      " + h for h in hosts)}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="{TOTAL}" data-track-index="3" data-track-kind="captions" data-width="1920" data-height="1080" style="z-index:5"></div>
      {chr(10).join("      " + a for a in audio)}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""


def main():
    html_only = "--html" in sys.argv
    (PROJECT / "compositions").mkdir(exist_ok=True)
    for s in SECTIONS:
        if not html_only:
            cut_section(s)
            got = probe(PROJECT / "assets" / "clips" / f"{s['id']}.mp4")
            print(s["id"], "slot", s["dur"], "clip", round(got, 2))
        shutil.copy(VO / f"{s['id']}.mp3", PROJECT / "assets" / "vo" / f"{s['id']}.mp3")
        (PROJECT / "compositions" / f"{s['id']}.html").write_text(scene_html(s), encoding="utf8")
    groups = caption_groups()
    (PROJECT / "compositions" / "captions.html").write_text(captions_html(groups), encoding="utf8")
    (PROJECT / "index.html").write_text(index_html(), encoding="utf8")
    (PROJECT / "build" / "captions.json").write_text(json.dumps(groups, indent=1), encoding="utf8")
    print("groups", len(groups), "· written")


if __name__ == "__main__":
    main()
