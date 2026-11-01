# 把验收台（tools/accept.ts）出的图拼成带标题的总图，再和 refs/ 里的参考图并排出对照图。
#   uv run --with pillow python tools/accept-sheet.py <验收图目录> [--title 第1期改前] [--refs refs] [--compare refs/compare]
# 总图：<验收图目录>/sheet-<组>.png，每种组合一行（全身正面、躯干正面、侧面、背面、斜后、自然站立、自然站立斜前）。
# 对照图：<compare>/<标题>-<组>.png，上面一排是 refs/ 里这一组的参考图（文件名以组的字母开头，C、D 共用 CD-*），下面是这一组每种组合的全身正面。
# 参考图是别人的画，对照图只放在 refs/ 下面（不进仓库）。
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = "C:/Windows/Fonts/msyh.ttc"
COLUMNS = [
    ("front", "全身正面"),
    ("front-close", "躯干正面"),
    ("side-close", "侧面"),
    ("back-close", "背面"),
    ("rear-close", "斜后"),
    ("posed_front", "自然站立"),
    ("posed_three-close", "自然站立 斜前"),
]
ROW_H = 300
GAP = 8
BG = (255, 255, 255)
INK = (40, 40, 44)


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def font(size):
    return ImageFont.truetype(FONT, size)


def fit_h(img, h):
    return img.resize((max(1, round(img.width * h / img.height)), h), Image.LANCZOS)


def sheet(folder, group, cases, title):
    rows = []
    for case in cases:
        tiles = []
        for key, _ in COLUMNS:
            f = folder / f"{case['name']}_{key}.png"
            tiles.append(fit_h(Image.open(f).convert("RGB"), ROW_H) if f.exists() else None)
        rows.append((case, tiles))
    widths = [max((t[i].width for _, t in rows if t[i] is not None), default=0) for i in range(len(COLUMNS))]
    widths = [w or ROW_H for w in widths]
    width = sum(widths) + GAP * (len(widths) + 1)
    head = 56
    cap = 34
    height = head + cap + len(rows) * (ROW_H + 44 + GAP) + GAP
    out = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(out)
    draw.text((GAP, 10), f"{title} · {group} 组", font=font(28), fill=INK)
    x = GAP
    for (_, label), w in zip(COLUMNS, widths):
        draw.text((x, head), label, font=font(20), fill=(110, 110, 116))
        x += w + GAP
    y = head + cap
    for case, tiles in rows:
        draw.text((GAP, y + 4), f"{case['label']}（{case['setting']}）", font=font(22), fill=INK)
        rest = case["rest"]
        note = f"{rest['components']} 块 · 破口边 {rest['open']} · 穿插 {len(case['clashes'])} 处 · 融合 {rest['ms']} ms"
        draw.text((width - GAP - draw.textlength(note, font=font(18)), y + 8), note, font=font(18), fill=(120, 120, 126))
        y += 40
        x = GAP
        for tile, w in zip(tiles, widths):
            if tile is not None:
                out.paste(tile, (x + (w - tile.width) // 2, y))
            x += w + GAP
        y += ROW_H + 4 + GAP
    return out


def compare(folder, group, cases, refs, title):
    prefixes = ("CD-",) if group in ("C", "D") else (f"{group}-",)
    shots = sorted(p for p in refs.iterdir() if p.is_file() and p.name.startswith(prefixes))
    if not shots:
        return None
    h = 560
    top = [fit_h(Image.open(p).convert("RGB"), h) for p in shots]
    bottom = []
    for case in cases:
        f = folder / f"{case['name']}_front.png"
        if f.exists():
            bottom.append((case, fit_h(Image.open(f).convert("RGB"), h)))
    width = max(sum(t.width for t in top) + GAP * (len(top) + 1), sum(b.width for _, b in bottom) + GAP * (len(bottom) + 1))
    height = 50 + 30 + h + 30 + 60 + h + GAP
    out = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(out)
    draw.text((GAP, 10), f"{title} · {group} 组：参考图（上）和工坊（下）", font=font(26), fill=INK)
    y = 50
    x = GAP
    for p, t in zip(shots, top):
        draw.text((x, y), p.name, font=font(18), fill=(110, 110, 116))
        out.paste(t, (x, y + 30))
        x += t.width + GAP
    y += 30 + h + 30
    x = GAP
    for case, b in bottom:
        draw.text((x, y), f"{case['name']}（{case['setting']}）", font=font(18), fill=(110, 110, 116))
        out.paste(b, (x, y + 30))
        x += b.width + GAP
    return out


def main():
    folder = Path(sys.argv[1])
    title = arg("--title", folder.name)
    refs = Path(arg("--refs", "refs"))
    target = Path(arg("--compare", str(refs / "compare")))
    cases = json.loads((folder / "summary.json").read_text(encoding="utf-8"))["cases"]
    groups = sorted({c["group"] for c in cases})
    for group in groups:
        mine = [c for c in cases if c["group"] == group]
        out = folder / f"sheet-{group}.png"
        sheet(folder, group, mine, title).save(out)
        print(out)
        if refs.exists():
            pair = compare(folder, group, mine, refs, title)
            if pair is not None:
                target.mkdir(parents=True, exist_ok=True)
                f = target / f"{title}-{group}.png"
                pair.save(f)
                print(f)


main()
