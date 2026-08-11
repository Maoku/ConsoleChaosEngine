"""
プレイヤーモデルを Blender で作り、glTF として書き出す（T0-06 / T0-07 / T0-19 / T1-08）。

Docs/asset-rules.md §9 のエクスポート手順を**スクリプトとして固定**したもの。
手順を文章だけで持つと、実際の出力とずれても気づけない。
このスクリプトの出力を CI（npm run check:assets）が検査することで、
「規則どおりに出せば読める」ことが機械的に保証される。

実行:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/blender_export_player.py

出力: public/assets/models/player.gltf（+ .bin）
"""

import bpy
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets", "models", "player")

# T1-08 のプレイヤー像。T0-19 の申し送り（§4）をそのまま形にしている。
#
# 1. 特徴は塊で作る … 髪は顔を囲む大きな暗い塊（0.75 単位 = 24 画素）にした
# 2. 隣接部位は明度で分ける … 暗い髪 / 明るい顔、赤い胴 / 青い脚 / 黄色い足
# 3. 手足の先端に明るい色 … 足を黄色のまま残し、面積を増やした
# 4. 頭部の高さをブロック境界に合わせる … すべての面を 0.25 単位（= 8 画素、
#    level/schema.ts の PIXELS_PER_WORLD_UNIT = 32）の倍数に載せた。
#    第1世代のカラークラッシュのブロック（16 画素 = 0.5 単位）とも整合する
#
# 腕は胴と同じ色にする。8 画素幅の腕は量子化で必ず胴へ吸収されるため、
# 別の色を与えても「混ざった中間色」が出るだけで、シルエットが濁る（T0-19 の所見）。
#
# 座標は**ゲーム側の系（Y が上、-Z が前）**で書く。Blender は Z が上なので、
# to_blender() で変換する。書き出し時に +Y Up を指定するため、
# glTF には元の「Y が上」で戻ってくる（asset-rules.md §4）。
# (名前, 中心 x/y/z, 半径 x/y/z, 追従するボーン)
PARTS = [
    # 髪：顔を囲む暗い塊。y 1.25〜2.00
    ("hair",  (0.00, 1.625, -0.0625), (0.28125, 0.375, 0.25), "head"),
    # 顔：髪より前に出して、明度差で分ける。y 1.28〜1.72
    ("face",  (0.00, 1.50, 0.125), (0.21875, 0.21875, 0.21875), "head"),
    # 胴：y 0.75〜1.25
    ("torso", (0.00, 1.00, 0.00), (0.25, 0.25, 0.1875), "spine"),
    ("armL",  (-0.375, 1.00, 0.00), (0.125, 0.1875, 0.125), "spine"),
    ("armR",  (0.375, 1.00, 0.00), (0.125, 0.1875, 0.125), "spine"),
    # 脚：y 0.25〜0.75
    ("legL",  (-0.125, 0.50, 0.00), (0.125, 0.25, 0.125), "legL"),
    ("legR",  (0.125, 0.50, 0.00), (0.125, 0.25, 0.125), "legR"),
    # 足：y 0.00〜0.25。前方向に長くして面積を稼ぐ
    ("footL", (-0.125, 0.125, 0.0625), (0.1875, 0.125, 0.25), "legL"),
    ("footR", (0.125, 0.125, 0.0625), (0.1875, 0.125, 0.25), "legR"),
]

# ボーン: hips -> spine -> head、hips -> legL / legR（5 本。上限 16 に対して十分小さい）
BONES = [
    ("hips", (0.0, 0.75, 0.0), (0.0, 1.0, 0.0), None),
    ("spine", (0.0, 1.0, 0.0), (0.0, 1.25, 0.0), "hips"),
    ("head", (0.0, 1.25, 0.0), (0.0, 2.0, 0.0), "spine"),
    ("legL", (-0.125, 0.75, 0.0), (-0.125, 0.0, 0.0), "hips"),
    ("legR", (0.125, 0.75, 0.0), (0.125, 0.0, 0.0), "hips"),
]


def to_blender(vec):
    """ゲーム側の (x, 上, 前) を Blender の (x, 前, 上) へ入れ替える"""
    return (vec[0], vec[2], vec[1])


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    # 金属・粗さは読まない（asset-rules.md §7）。既定のままにしておく
    return material


# 明度で分ける（T0-19 の申し送り 2）。
#
# **第1世代のパレットに乗る色を選ぶこと**（T1-08 の実測で判明）。
# 54 色の固定パレットには「中明度の低彩度な暖色」が無いため、
# 肌色のような淡い色はライティングで暗くなった瞬間に灰色 (152,150,152) へ落ちる。
# 顔は彩度を上げた暖色にして、明度が下がっても橙〜茶の系統に留まるようにした。
# 髪は逆に、どの明度でも黒へ落ちる色にして塊を安定させる。
COLORS = {
    "face": (0.92, 0.62, 0.35, 1.0),   # 明るさが変わっても橙〜茶に留まる
    "hair": (0.06, 0.06, 0.10, 1.0),   # どの明度でも黒
    "torso": (0.90, 0.25, 0.30, 1.0),  # 中（0.44）
    "armL": (0.90, 0.25, 0.30, 1.0),
    "armR": (0.90, 0.25, 0.30, 1.0),
    "legL": (0.18, 0.32, 0.68, 1.0),   # 暗め（0.33）
    "legR": (0.18, 0.32, 0.68, 1.0),
    "footL": (0.95, 0.90, 0.35, 1.0),  # 明（0.85）
    "footR": (0.95, 0.90, 0.35, 1.0),
}


def build_mesh():
    """部位ごとの箱を 1 つのメッシュに統合する（ドローコールを増やさないため）"""
    objects = []
    for name, center, half, _bone in PARTS:
        bpy.ops.mesh.primitive_cube_add(size=2.0, location=to_blender(center))
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = to_blender(half)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(make_material(name, COLORS[name]))
        objects.append(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    mesh = bpy.context.active_object
    mesh.name = "player"
    return mesh


def build_armature():
    bpy.ops.object.armature_add(location=(0, 0, 0))
    armature = bpy.context.active_object
    armature.name = "player_rig"
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones
    for bone in list(edit_bones):
        edit_bones.remove(bone)
    created = {}
    for name, head, tail, parent in BONES:
        bone = edit_bones.new(name)
        bone.head = to_blender(head)
        bone.tail = to_blender(tail)
        if parent:
            bone.parent = created[parent]
            # 脚は腰から下向きに生えるので、接続すると位置がずれる
            bone.use_connect = not name.startswith("leg")
        created[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def bind(mesh, armature):
    """頂点グループで部位ごとにボーンへ割り当てる（ウェイトは 1.0 に正規化される）"""
    modifier = mesh.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    mesh.parent = armature

    groups = {}
    for _name, _center, _half, bone in PARTS:
        if bone not in groups:
            groups[bone] = mesh.vertex_groups.new(name=bone)

    # 頂点の位置から、どの部位に属するかを判定して割り当てる
    for vertex in mesh.data.vertices:
        best_bone = None
        best_distance = None
        for _name, center, half, bone in PARTS:
            bc = to_blender(center)
            bh = to_blender(half)
            dx = max(abs(vertex.co.x - bc[0]) - bh[0], 0.0)
            dy = max(abs(vertex.co.y - bc[1]) - bh[1], 0.0)
            dz = max(abs(vertex.co.z - bc[2]) - bh[2], 0.0)
            distance = dx * dx + dy * dy + dz * dz
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_bone = bone
        groups[best_bone].add([vertex.index], 1.0, "REPLACE")


def iter_fcurves(action):
    """
    F カーブを列挙する。Blender 4.4 以降は Action がレイヤ / スロット構造になり、
    action.fcurves が無くなったため、両方の形に対応する。
    """
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                yield from channelbag.fcurves


def set_pose(armature, frame, angles):
    """フレームにポーズを打つ。angles は {ボーン名: X 軸の角度（度）}"""
    scene = bpy.context.scene
    scene.frame_set(frame)
    for bone_name, degrees in angles.items():
        bone = armature.pose.bones[bone_name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (math.radians(degrees), 0.0, 0.0)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame)


# 3 本のアニメーション（T1-08）。
# **アセット側にコマ落ちは作らない。** 滑らかな 1 本を持ち、
# 再生時刻を世代プロファイルの animationHz で量子化して世代差を出す
#（asset-rules.md §6、T0-19 で第1世代 6fps の成立を実測済み）。
#
# 先頭と末尾のキーを一致させてループさせる。jump だけは片道。
ANIMATIONS = {
    # 待機：呼吸のような上体の揺れ
    "idle": [
        (1, {"spine": 0.0, "head": 0.0}),
        (13, {"spine": -6.0, "head": 4.0}),
        (25, {"spine": 0.0, "head": 0.0}),
    ],
    # 歩行：脚の前後スイング + 上体のわずかな逆位相。24 フレーム 1 周
    "walk": [
        (1, {"legL": 22.0, "legR": -22.0, "spine": -4.0, "head": 2.0}),
        (7, {"legL": 0.0, "legR": 0.0, "spine": 0.0, "head": 0.0}),
        (13, {"legL": -22.0, "legR": 22.0, "spine": -4.0, "head": 2.0}),
        (19, {"legL": 0.0, "legR": 0.0, "spine": 0.0, "head": 0.0}),
        (25, {"legL": 22.0, "legR": -22.0, "spine": -4.0, "head": 2.0}),
    ],
    # 跳躍：踏み切りで縮み、上昇中は脚を前へ抱える。ループしない
    "jump": [
        (1, {"legL": 0.0, "legR": 0.0, "spine": 0.0, "head": 0.0}),
        (5, {"legL": 26.0, "legR": 26.0, "spine": 10.0, "head": -6.0}),
        (13, {"legL": -18.0, "legR": -10.0, "spine": -8.0, "head": 4.0}),
    ],
}


def build_animations(armature):
    """
    アニメーションを 1 本ずつ Action に作り、NLA トラックへ積む。

    glTF エクスポータは NLA トラックを**トラック名のアニメーションとして**書き出す。
    Action をそのまま出す方式は Blender 4.4 以降のスロット構造で名前が揺れるため、
    名前を確実に固定できる NLA 方式を採る。
    """
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    scene = bpy.context.scene
    scene.frame_start = 1
    armature.animation_data_create()

    for name, keys in ANIMATIONS.items():
        action = bpy.data.actions.new(name)
        armature.animation_data.action = action
        scene.frame_end = max(frame for frame, _ in keys)
        for frame, angles in keys:
            set_pose(armature, frame, angles)

        # 補間を LINEAR に落とす（asset-rules.md §6：CUBICSPLINE は不可）
        for fcurve in iter_fcurves(action):
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "LINEAR"

        track = armature.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, action)
        armature.animation_data.action = None

    bpy.ops.object.mode_set(mode="OBJECT")


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    # Docs/asset-rules.md §9 の設定をそのままコードにしたもの
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLTF_SEPARATE",
        export_yup=True,                    # 3. +Y Up
        export_apply=True,                  # 4. Apply Modifiers
        export_tangents=False,              #    Tangents は無効
        export_vertex_color="NONE",         #    Vertex Colors は無効
        export_all_vertex_colors=False,
        export_attributes=False,
        export_materials="EXPORT",          # 5. baseColor が出れば足りる
        export_def_bones=True,              # 6. Export Deformation Bones Only
        export_force_sampling=True,         # 7. Sampling Animations
        export_animations=True,
        export_animation_mode="NLA_TRACKS",  # トラック名がそのままアニメ名になる
        export_skins=True,
        export_normals=True,
        export_texcoords=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_optimize_animation_size=True,
    )


clear_scene()
mesh = build_mesh()
armature = build_armature()
bind(mesh, armature)
build_animations(armature)
export()

print("EXPORTED:", OUT + ".gltf")
sys.exit(0)
