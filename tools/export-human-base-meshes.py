# 从 Blender Studio 的「Human Base Meshes」包（CC0，见 assets/source/README.md）里导出两个女性全身，给 tools/build-torso.ts 用：
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --disable-autoexec \
#     "assets/source/blender-human-base-meshes/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend" \
#     --python tools/export-human-base-meshes.py
# 写实的那个带三级多级细分，取第二级（顶点间距两三毫米，工坊的格子是 5 毫米，再细也采不到）；风格化的原样导出。
# 用 Blender 自带的 OBJ 导出：Y 朝上、面朝 +Z（Blender 里人面朝 -Y），单位米；摆位（脚底、正中）在 build-torso.ts 里对
import os
import bpy

OUT = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), '..'))
for name, file in [('GEO-body_female_realistic', 'female_realistic.obj'), ('GEO-body_female_stylized', 'female_stylized.obj')]:
    obj = bpy.data.objects[name]
    if obj.name not in bpy.context.scene.collection.all_objects:
        bpy.context.scene.collection.objects.link(obj)
    for m in obj.modifiers:
        if m.type == 'MULTIRES':
            m.levels = min(2, m.total_levels)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.obj_export(
        filepath=os.path.join(OUT, file),
        export_selected_objects=True,
        apply_modifiers=True,
        export_eval_mode='DAG_EVAL_VIEWPORT',
        forward_axis='Z',
        up_axis='Y',
        export_uv=False,
        export_normals=False,
        export_materials=False,
    )
    print('EXPORTED', file)
