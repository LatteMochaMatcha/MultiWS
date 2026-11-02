# 把 DJP Male Base Mesh Mark 03（Death Joe Productions，CC BY 4.0）的 FBX 转成 OBJ，给 tools/build-genital.ts 读。
# 用 Blender 在后台跑：
#   & "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --disable-autoexec --python tools/export-djp-male.py
# 只留身体那一大块（眼睛、牙齿是另外几小块），坐标换成工坊的：米，Y 朝上，面朝 +Z，左手边是 +X。
# FBX 读进 Blender 是 Z 朝上、面朝 -Y，所以 (x, y, z) → (x, z, -y)。
import bpy
import bmesh
from pathlib import Path

root = Path(bpy.path.abspath("//")) if bpy.data.filepath else Path.cwd()
source = root / "assets/source/djp-male/DJP Male Mark 03 Base Mesh.fbx"
target = root / "assets/source/djp-male/djp-male.obj"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
ob = next(o for o in bpy.data.objects if o.type == "MESH")

bm = bmesh.new()
bm.from_mesh(ob.data)
bm.transform(ob.matrix_world)
bm.verts.ensure_lookup_table()

# 最大的那一块
seen = {}
for v in bm.verts:
    if v.index in seen:
        continue
    seen[v.index] = v.index
    stack = [v]
    while stack:
        a = stack.pop()
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen[b.index] = v.index
                stack.append(b)
sizes = {}
for k in seen.values():
    sizes[k] = sizes.get(k, 0) + 1
main = max(sizes, key=sizes.get)

index = {}
lines = ["# DJP Male Base Mesh Mark 03 by Death Joe Productions (www.DeathJoeProductions.com), CC BY 4.0", "# tools/export-djp-male.py: body island only, metres, Y up, facing +Z"]
for v in bm.verts:
    if seen[v.index] != main:
        continue
    index[v.index] = len(index) + 1
    x, y, z = v.co
    lines.append(f"v {x:.6f} {z:.6f} {-y:.6f}")
faces = 0
for f in bm.faces:
    ids = [index.get(v.index) for v in f.verts]
    if None in ids:
        continue
    lines.append("f " + " ".join(str(i) for i in ids))
    faces += 1
target.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"EXPORTED {len(index)} vertices, {faces} faces -> {target}")
