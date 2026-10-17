#!/usr/bin/env python3
"""Генерирует img/motif-<game>.svg — полутоновые (halftone) знаки дисциплин.
Свои абстрактные символы, не логотипы игр. Файлы — маски: цвет задаёт CSS."""
import math, os

N = 64            # точек по стороне
S = 1200          # размер холста
STEP = S / N

def smooth(a, b, x):
    t = max(0, min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t)

def seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def poly_outline(px, py, pts, closed=True):
    d = 1e9
    n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = pts[i], pts[(i + 1) % n]
        d = min(d, seg(px, py, a[0], a[1], b[0], b[1]))
    return d

def inside(px, py, pts):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def hexagon(cx, cy, r):
    return [(cx + r * math.cos(math.radians(60 * i - 90)), cy + r * math.sin(math.radians(60 * i - 90))) for i in range(6)]

def star(cx, cy, ro, ri, n=5):
    pts = []
    for i in range(n * 2):
        r = ro if i % 2 == 0 else ri
        a = math.radians(-90 + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

C = S / 2

def f_dota2(x, y):
    """Шестигранник-руна и диагональный клинок"""
    hx = hexagon(C, C, 430)
    d_hex = poly_outline(x, y, hx)
    d_blade = seg(x, y, C - 250, C + 250, C + 250, C - 250)
    d_guard = seg(x, y, C + 60, C - 60 + 0, C + 250, C - 250) * 99
    cross = seg(x, y, C - 120, C + 20, C + 20, C + 120)  # гарда
    v = min(d_hex / 36, d_blade / 26, cross / 24)
    inner = hexagon(C, C, 300)
    v = min(v, poly_outline(x, y, inner) / 60 + (0.0 if True else 0) + 0.55)
    return 1 - smooth(0.55, 1.1, v)

def f_csgo(x, y):
    """Прицел с засечками и дымовые «облака»"""
    r = math.hypot(x - C, y - C)
    ring = abs(r - 360) / 34
    ring2 = abs(r - 140) / 22
    ticks = min(seg(x, y, C, C - 520, C, C - 220), seg(x, y, C, C + 220, C, C + 520),
                seg(x, y, C - 520, C, C - 220, C), seg(x, y, C + 220, C, C + 520, C)) / 26
    dot = r / 30
    smoke = 1e9
    for (sx, sy, sr) in [(300, 880, 150), (470, 940, 110), (880, 300, 130), (760, 220, 90)]:
        smoke = min(smoke, abs(math.hypot(x - sx, y - sy) - sr) / 20)
    v = min(ring, ring2, ticks, dot)
    return 1 - smooth(0.55, 1.1, v)

def f_clash(x, y):
    """Корона и капля"""
    crown = [(C - 360, C + 160), (C - 400, C - 190), (C - 190, C - 40), (C, C - 280), (C + 190, C - 40), (C + 400, C - 190), (C + 360, C + 160)]
    base = [(C - 360, C + 160), (C + 360, C + 160), (C + 330, C + 260), (C - 330, C + 260)]
    d = min(poly_outline(x, y, crown + [], True), poly_outline(x, y, base, True)) / 30
    # капля (эликсир) внутри
    ex, ey = C, C + 20
    t = math.hypot(x - ex, (y - ey) * 0.9) - 90
    drop_tip = seg(x, y, ex, ey - 190, ex - 70, ey - 40)
    drop = min(abs(t) / 22, drop_tip / 22, seg(x, y, ex, ey - 190, ex + 70, ey - 40) / 22)
    fill = 0 if inside(x, y, base) else 1
    v = min(d, drop)
    out = 1 - smooth(0.55, 1.1, v)
    if inside(x, y, base) and t > 0: out = max(out, 0.18)
    return out

def f_brawl(x, y):
    """Звезда в круглом значке с заклёпками"""
    r = math.hypot(x - C, y - C)
    ring = abs(r - 470) / 34
    st = star(C, C, 330, 150)
    d_star = poly_outline(x, y, st) / 30
    rivets = 1e9
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        rivets = min(rivets, math.hypot(x - (C + 400 * math.cos(a)), y - (C + 400 * math.sin(a))) / 22)
    v = min(ring, d_star, rivets)
    out = 1 - smooth(0.55, 1.1, v)
    if inside(x, y, st): out = max(out, 0.22)
    return out

FUNCS = {'dota2': f_dota2, 'csgo': f_csgo, 'clash': f_clash, 'brawl': f_brawl}

def build(gid):
    f = FUNCS[gid]
    parts = []
    for j in range(N):
        for i in range(N):
            x = (i + 0.5) * STEP + (STEP / 2 if j % 2 else 0) - STEP / 4
            y = (j + 0.5) * STEP
            if x < 0 or x > S: continue
            v = f(x, y)
            if v < 0.08: continue
            r = round(1.5 + v * (STEP * 0.46), 1)
            parts.append('<circle cx="%d" cy="%d" r="%s"/>' % (round(x), round(y), r))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" fill="#000">' % (S, S)) + ''.join(parts) + '</svg>'

os.makedirs('img', exist_ok=True)
for gid in FUNCS:
    svg = build(gid)
    with open('img/motif-%s.svg' % gid, 'w') as fh: fh.write(svg)
    print(gid, len(svg) // 1024, 'KB', svg.count('<circle'), 'точек')
