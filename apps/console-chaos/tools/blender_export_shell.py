"""
P1-2 の殻を Blender で作り、glTF として書き出す（T1-27）。

**このスクリプトが殻の形の正本である。**
見た目（`props_shell.gltf`）と当たり判定（`props_shell.plates.json`）の**両方**がここから出る。
レベル側（`area1.json` / `puzzle_lab.json`）の当たり判定は
`tests/unit/shell_shape.test.ts` がこの JSON と突き合わせるので、
「裂けて見える継ぎ目」と「通れる穴」が別々にずれていくことがない
（PHASE1_FEEDBACK_PLAN T1-27 の「一貫性」）。

実行:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/blender_export_shell.py

出力:
  public/assets/models/props_shell.gltf（+ .bin）
  public/assets/models/props_shell.plates.json

## 形の考え方

深度バッファを持たない世代では、**交差する形状は三角形の重心ソートでは原理的に解決できない**。
重心の遠近と、画素ごとの遠近が一致しないためで、交差線に沿って面が入れ替わって見える。
これが実機の「継ぎ目が裂ける」で、P1-2 が題材にしているものそのものである。

そこで殻は「箱」ではなく、**互いに食い込む板の集まり**として作る。

- 4 面 + 天面の板は、隣どうしが角で**重なる**（食い込む）
- 継ぎ目（-X 面の入口）を塞ぐ板は、まわりの 3 枚すべてに食い込ませる

破れの強さは板の厚み（`THICKNESS`）で決まる。
`OVERLAP` が決めるのは「継ぎ目がどれだけ読めるか」で、破れの量ではない
（採用しなかった候補は `Docs/measurements/T1-27_sort_break.md` §4）。
"""

import bpy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "assets", "models")
NAME = "props_shell"

# 板の厚み（単位箱 [-1, 1] での値）。0.25 = 実寸で 4m の殻に対して 0.5m
THICKNESS = 0.25

# 継ぎ目を塞ぐ板が、まわりの板へ食い込む量。
#
# **この値が決めるのは「継ぎ目が 1 枚の板としてどれだけ読めるか」で、破れの強さではない。**
# 3 つ試して分かったこと（T1-27_sort_break.md §4）:
#   0.04 … 継ぎ目の縁が読みにくい / 0.25 … CH 4 でも板が輪郭から飛び出す
# 破れの強さを決めているのは、板どうしが角で重なる量＝THICKNESS のほう
OVERLAP = 0.12

# 入口（継ぎ目）の開口。-X 面に開ける。プレイヤーは常に -X 側から来る
SEAM_Z = (-0.5, 0.5)
SEAM_TOP = 1.0 / 3.0  # 開口の上端（実寸で 2m。プレイヤーの身長 1.6m が通る）

# 天面の下端。0.25 刻みの実寸に載るよう 2/3 にしてある
TOP_BOTTOM = 2.0 / 3.0


def box(name, x, y, z):
    """(min, max) の 3 組で板を 1 枚作る"""
    return {"name": name, "x": x, "y": y, "z": z}


# 殻を構成する板。**当たり判定もこの表から出す**（開口を除く 7 枚 + 継ぎ目 1 枚）
PLATES = [
    # -X 面：入口の左右と、その上の梁。ここだけ 3 枚に割れている
    box("wall_left_back", (-1.0, -1.0 + THICKNESS), (-1.0, 1.0), (-1.0, SEAM_Z[0])),
    box("wall_left_front", (-1.0, -1.0 + THICKNESS), (-1.0, 1.0), (SEAM_Z[1], 1.0)),
    box("wall_left_lintel", (-1.0, -1.0 + THICKNESS), (SEAM_TOP, 1.0), SEAM_Z),
    # +X / +Z / -Z 面。角で -X 面と重なる（食い込み）
    box("wall_right", (1.0 - THICKNESS, 1.0), (-1.0, 1.0), (-1.0, 1.0)),
    box("wall_front", (-1.0, 1.0), (-1.0, 1.0), (1.0 - THICKNESS, 1.0)),
    box("wall_back", (-1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0 + THICKNESS)),
    # 天面。4 面すべてと重なる
    box("wall_top", (-1.0, 1.0), (TOP_BOTTOM, 1.0), (-1.0, 1.0)),
]

# 継ぎ目を塞ぐ板。**まわりの 3 枚へ食い込ませる**のがこの形の要点で、
# 深度バッファを持たない世代ではここが裂ける
SEAM = box(
    "seam",
    (-1.0 - OVERLAP * 0.2, -1.0 + THICKNESS + OVERLAP * 0.2),
    (-1.0, SEAM_TOP + OVERLAP),
    (SEAM_Z[0] - OVERLAP, SEAM_Z[1] + OVERLAP),
)

# 当たり判定として使う板（単位箱の中心と半径）。開口は `seam` が塞ぐ。
# 見た目の食い込みぶんは当たり判定に入れない（通れる穴の大きさが変わってしまうため）
COLLIDERS = [
    *PLATES,
    box("seam", (-1.0, -1.0 + THICKNESS), (-1.0, SEAM_TOP), SEAM_Z),
]


def to_blender(vec):
    """ゲーム側の (x, 上, 前) を Blender の (x, 前, 上) へ入れ替える"""
    return (vec[0], vec[2], vec[1])


def add_plate(plate, uv_scale=0.5):
    """板 1 枚を箱として置く。UV は面ごとに 0..1（テクスチャの継ぎ目が板の縁に来る）"""
    center = [(plate[axis][0] + plate[axis][1]) / 2 for axis in ("x", "y", "z")]
    half = [(plate[axis][1] - plate[axis][0]) / 2 for axis in ("x", "y", "z")]
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=to_blender(center))
    obj = bpy.context.active_object
    obj.name = plate["name"]
    obj.scale = to_blender(half)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # 装甲板のテクスチャを板の面いっぱいに貼る（uv_scale は将来の調整用の余地）
    uv_layer = obj.data.uv_layers.new(name="UVMap") if not obj.data.uv_layers else obj.data.uv_layers[0]
    for loop in obj.data.loops:
        uv = uv_layer.data[loop.index].uv
        uv[0] = uv[0] * uv_scale + 0.25
        uv[1] = uv[1] * uv_scale + 0.25
    return obj


def build():
    material = bpy.data.materials.new(NAME)
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)

    objects = [add_plate(plate) for plate in [*PLATES, SEAM]]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    mesh = bpy.context.active_object
    mesh.name = NAME
    mesh.data.materials.append(material)
    return mesh


def write_colliders():
    """当たり判定の正本。単位箱（中心 0、半径 1）での中心と半径で持つ"""
    data = {
        "note": "P1-2 の殻の当たり判定。単位箱での中心と半径。tools/blender_export_shell.py が正本",
        "seam": "seam",
        "plates": [
            {
                "name": plate["name"],
                "center": [(plate[axis][0] + plate[axis][1]) / 2 for axis in ("x", "y", "z")],
                "half": [(plate[axis][1] - plate[axis][0]) / 2 for axis in ("x", "y", "z")],
            }
            for plate in COLLIDERS
        ],
    }
    path = os.path.join(OUT_DIR, NAME + ".plates.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print("WROTE:", path)


def export():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, NAME),
        export_format="GLTF_SEPARATE",
        export_yup=True,
        export_apply=True,
        export_tangents=False,
        export_vertex_color="NONE",
        export_all_vertex_colors=False,
        export_attributes=False,
        export_materials="EXPORT",
        export_skins=False,
        export_animations=False,
        export_normals=True,
        export_texcoords=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    print("EXPORTED:", os.path.join(OUT_DIR, NAME) + ".gltf")


os.makedirs(OUT_DIR, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
build()
export()
write_colliders()
sys.exit(0)
