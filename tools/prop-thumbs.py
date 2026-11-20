# 写实款道具的小图：把开发服务器页面上截的图抠成透明底、裁成正方形、缩到 144 像素，
# 存成 public/props/real/<编号>.webp；顺手拼一张总览给人看。
#   uv run --with pillow --with numpy python tools/prop-thumbs.py <截图的文件夹> <项目根目录> [总览图]
# 每件要两张同一个镜头的截图：thumb-<编号>-k.png（黑底）和 thumb-<编号>-w.png（白底）。
# 两张一比就知道每个像素透了多少（一样的是实的，差得越多越透），椅子腿之间、浅色的桌面都分得清。
# 截图怎么来的见 assets/source/README.md「写实款道具」。
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 144
shots = Path(sys.argv[1])
root = Path(sys.argv[2])
out = root / "public/props/real"
out.mkdir(parents=True, exist_ok=True)
ids = [a["id"] for a in json.loads((root / "src/props/realMeta.json").read_text(encoding="utf-8"))["assets"]]
tiles = []
for key in ids:
    black = np.asarray(Image.open(shots / f"thumb-{key}-k.png").convert("RGB"), dtype=np.float32)
    white = np.asarray(Image.open(shots / f"thumb-{key}-w.png").convert("RGB"), dtype=np.float32)
    alpha = np.clip(1 - (white - black).mean(axis=2) / 255, 0, 1)
    # 黑底那张是「颜色 × 不透明度」：除回去
    rgb = np.clip(black / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    rgba = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")
    rgba = rgba.crop(rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())
    # 放回正方形的正中，四周留一点边
    side = int(max(rgba.size) * 1.06)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(rgba, ((side - rgba.size[0]) // 2, (side - rgba.size[1]) // 2))
    small = square.resize((SIZE, SIZE), Image.LANCZOS)
    small.save(out / f"{key}.webp", quality=86, method=6)
    tiles.append(small)
    print(key, (out / f"{key}.webp").stat().st_size)

if len(sys.argv) > 3:
    cols = 8
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (SIZE + 8) + 8, rows * 2 * (SIZE + 8) + 8), "#eef2f2")
    # 上半张浅色底、下半张深色底：两种界面配色下都看一眼
    sheet.paste("#0e1618", (0, rows * (SIZE + 8) + 4, sheet.size[0], sheet.size[1]))
    for half in range(2):
        for i, tile in enumerate(tiles):
            sheet.paste(tile, (8 + (i % cols) * (SIZE + 8), 8 + (i // cols + half * rows) * (SIZE + 8)), tile)
    sheet.save(sys.argv[3], quality=92)
