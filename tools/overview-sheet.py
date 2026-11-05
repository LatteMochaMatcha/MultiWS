# 把 tools/overview.ts 的结果按组合拼成总图：一种组合一张，静止的在最前，后面每个姿势一格，格子下面写检查结果，
# 不对劲的（网格碎了、有破口、蒙皮拉得太长、出错）标红。另写一份 summary.md 列出标红的。
#   uv run --with pillow python -I tools/overview-sheet.py <输出目录>
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(out, 'shard-*.jsonl'))):
    with open(f, encoding='utf-8') as fh:
        rows += [json.loads(line) for line in fh if line.strip()]
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)
title_font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 26)
W, H, CAP, COLS = 320, 480, 58, 6

# 蒙皮的边拉长多少只写在格子下面、不标红：关节（腋下、膝弯）那几条小边本来就拉得长，拿它当门槛几乎每格都红，真问题反而淹掉了


def problems(r):
    """这一格不对劲的地方（空的就是没问题）"""
    out = []
    if 'error' in r:
        return ['出错']
    character = r['case'].startswith('C')
    if not character and r.get('components', 1) > 1:
        out.append(f"{r['components']} 块")
    if r.get('open', 0) > 0 and not character:
        out.append(f"破口 {r['open']}")
    if r.get('nonManifold', 0) > 0 and not character:
        out.append(f"非流形 {r['nonManifold']}")
    if r['pose'] == -1 and r.get('clashes'):
        out.append(f"穿插 {len(r['clashes'])}")
    return out


def caption(r):
    if 'error' in r:
        return '出错'
    bits = []
    if r['pose'] == -1:
        bits.append(f"{r['ms']} ms")
    else:
        bits.append(f"{'重融' if r.get('path') == 'refuse' else '蒙皮'} {r['ms']} ms")
        s = r.get('stretch')
        if s:
            bits.append(f"拉长 {s['most']}× / {s['over']}%")
    return '  '.join(bits)


cases = {}
for r in rows:
    cases.setdefault(r['case'], []).append(r)
os.makedirs(os.path.join(out, 'sheets'), exist_ok=True)
flagged = []
for name in sorted(cases):
    items = sorted(cases[name], key=lambda r: r['pose'])
    label = items[0]['label']
    n = len(items)
    rows_n = (n + COLS - 1) // COLS
    sheet = Image.new('RGB', (W * COLS, 48 + rows_n * (H + CAP)), 'white')
    d = ImageDraw.Draw(sheet)
    d.text((14, 8), f'{name}  {label}', fill=(30, 30, 30), font=title_font)
    for i, r in enumerate(items):
        x = (i % COLS) * W
        y = 48 + (i // COLS) * (H + CAP)
        img = os.path.join(out, 'img', f"{name}_rest.png" if r['pose'] == -1 else f"{name}_p{r['pose']:02d}.png")
        if os.path.exists(img):
            sheet.paste(Image.open(img), (x, y))
        bad = problems(r)
        d.text((x + 8, y + H + 2), r.get('name', f"姿势 {r['pose']}"), fill=(40, 40, 40), font=font)
        d.text((x + 8, y + H + 28), '，'.join(bad) if bad else caption(r), fill=(200, 30, 30) if bad else (110, 110, 110), font=font)
        if bad:
            d.rectangle([x + 1, y + 1, x + W - 2, y + H + CAP - 2], outline=(220, 40, 40), width=3)
            flagged.append((name, label, r.get('name', ''), '，'.join(bad), r.get('error', '').splitlines()[0] if 'error' in r else ''))
    sheet.save(os.path.join(out, 'sheets', f'{name}.png'), optimize=True)

with open(os.path.join(out, 'summary.md'), 'w', encoding='utf-8') as fh:
    fh.write(f'# 总览重测\n\n{len(cases)} 种组合，{sum(1 for r in rows if r["pose"] >= 0)} 个姿势图。\n\n')
    fh.write('## 标红的\n\n' if flagged else '没有标红的。\n')
    for name, label, pose, bad, err in flagged:
        fh.write(f'- {name} {label} · {pose}：{bad}{"（" + err + "）" if err else ""}\n')
    refuse = [r for r in rows if r.get('path') == 'refuse']
    if refuse:
        slow = sorted(refuse, key=lambda r: -r['ms'])[:8]
        fh.write('\n## 照姿势重新融合最慢的\n\n')
        for r in slow:
            fh.write(f"- {r['case']} {r['label']} · {r['name']}：{r['ms']} ms\n")
print(f'{len(cases)} 张总图，标红 {len(flagged)} 格')
