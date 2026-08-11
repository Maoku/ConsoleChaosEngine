"""
レベル要素のプロップモデルを Blender で作り、glTF として書き出す（T1-23。SG-10 で門を足した）。

箱で表現しきれない 7 種を作る:
  props_vine / props_pedestal / props_switch / props_enemy / props_caster / props_mark
  props_gate（SG-10）

Docs/asset-rules.md §9 と PHASE1_FEEDBACK_PLAN §8 の取り決めに従い、
**形状の正本はこのスクリプト**とする。Blender MCP は探索と確認に使ってよいが、
対話で作った結果をそのまま .gltf として確定させない（再現手段がリポジトリから失われるため）。

実行:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python tools/blender_export_props.py

出力: public/assets/models/props_*.gltf（+ .bin）

## 設計の約束

- すべてのプロップは **[-1, 1] の単位箱の中**で作る。
  描画側は要素の halfExtents を掛けるだけでよく、レベルを編集してもモデルを作り直さない
- 座標は**ゲーム側の系（Y が上、-Z が前）**で書き、to_blender() で入れ替える
- UV は手で与える（smart_project のような自動展開は使わない）。
  どのテクセルがどこに出るかが決まらないと、第1世代の量子化を予測できない
- ツタと敵は**交差する 2 枚の板**にする。実機の草木・スプライトと同じ作り方で、
  アルファ抜き（ps1_forward.glsl の uAlphaCutoff）で形が出る
"""

import bpy
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "assets", "models")


def to_blender(vec):
    """ゲーム側の (x, 上, 前) を Blender の (x, 前, 上) へ入れ替える"""
    return (vec[0], vec[2], vec[1])


class Builder:
    """頂点・面・UV を直接積む。ops を通さないので、出力が完全に決まる"""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []  # 面ごとの [(u, v), ...]

    def quad(self, p0, p1, p2, p3, uv0, uv1, uv2, uv3):
        base = len(self.verts)
        self.verts += [to_blender(p) for p in (p0, p1, p2, p3)]
        self.faces.append((base, base + 1, base + 2, base + 3))
        self.uvs.append([uv0, uv1, uv2, uv3])

    def quad_both_sides(self, p0, p1, p2, p3, uv0, uv1, uv2, uv3):
        """裏面カリングがあるので、両面から見えるものは 2 枚重ねる"""
        self.quad(p0, p1, p2, p3, uv0, uv1, uv2, uv3)
        self.quad(p3, p2, p1, p0, uv3, uv2, uv1, uv0)

    def box(self, center, half, u0=0.0, v0=0.0, u1=1.0, v1=1.0):
        """軸に沿った箱。各面に (u0,v0)-(u1,v1) の矩形を貼る"""
        cx, cy, cz = center
        hx, hy, hz = half
        x0, x1 = cx - hx, cx + hx
        y0, y1 = cy - hy, cy + hy
        z0, z1 = cz - hz, cz + hz
        uv = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
        # +Z / -Z / +X / -X / +Y / -Y。巻き方向は外向き（CCW）
        self.quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), *uv)
        self.quad((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), *uv)
        self.quad((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), *uv)
        self.quad((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), *uv)
        self.quad((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), *uv)
        self.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), *uv)

    def drum(self, sides, radius, y_bottom, y_top, side_u0, side_u1, cap_uv_radius):
        """
        多角柱。側面はテクスチャの縦帯 [side_u0, side_u1] を巻き、
        天面は中心から cap_uv_radius の円盤として貼る（放射状の刻印がそのまま出る）
        """
        ring = []
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            ring.append((math.cos(angle) * radius, math.sin(angle) * radius))
        for i in range(sides):
            x0, z0 = ring[i]
            x1, z1 = ring[(i + 1) % sides]
            self.quad(
                (x1, y_bottom, z1), (x0, y_bottom, z0), (x0, y_top, z0), (x1, y_top, z1),
                (side_u0, 0.0), (side_u1, 0.0), (side_u1, 1.0), (side_u0, 1.0),
            )
        # 天面：三角形の扇（四角形で 2 枚ずつ張る）
        for i in range(0, sides, 2):
            a = ring[i]
            b = ring[(i + 1) % sides]
            c = ring[(i + 2) % sides]
            self.quad(
                (0.0, y_top, 0.0), (a[0], y_top, a[1]), (b[0], y_top, b[1]), (c[0], y_top, c[1]),
                (0.5, 0.5),
                (0.5 + a[0] / radius * cap_uv_radius, 0.5 + a[1] / radius * cap_uv_radius),
                (0.5 + b[0] / radius * cap_uv_radius, 0.5 + b[1] / radius * cap_uv_radius),
                (0.5 + c[0] / radius * cap_uv_radius, 0.5 + c[1] / radius * cap_uv_radius),
            )

    def octahedron(self, radius):
        """結晶質の塊。低ポリゴンのまま面の向きが読める最小の立体"""
        top = (0.0, radius, 0.0)
        bottom = (0.0, -radius, 0.0)
        ring = [
            (radius, 0.0, 0.0),
            (0.0, 0.0, radius),
            (-radius, 0.0, 0.0),
            (0.0, 0.0, -radius),
        ]
        for i in range(4):
            a = ring[i]
            b = ring[(i + 1) % 4]
            # 三角形は「潰れた四角形」として積む（面の作り方を 1 本化する）
            self.quad(a, b, top, top, (0.0, 0.0), (1.0, 0.0), (0.5, 1.0), (0.5, 1.0))
            self.quad(b, a, bottom, bottom, (0.0, 0.0), (1.0, 0.0), (0.5, 1.0), (0.5, 1.0))


def build_object(name, builder, color=(1.0, 1.0, 1.0, 1.0)):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(builder.verts, [], builder.faces)
    mesh.update()

    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon, uvs in zip(mesh.polygons, builder.uvs):
        for index, loop_index in enumerate(polygon.loop_indices):
            uv_layer.data[loop_index].uv = uvs[index]

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# --- プロップの形（すべて [-1, 1] の単位箱の中で作る） ---


def build_vine():
    """交差する 2 枚の板。蔓と葉の形はテクスチャのアルファが決める"""
    b = Builder()
    b.quad_both_sides(
        (-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    b.quad_both_sides(
        (0, -1, -1), (0, -1, 1), (0, 1, 1), (0, 1, -1),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    return b


def build_enemy():
    """敵も交差する 2 枚の板。実機のスプライトと同じ扱い（走査線制限の対象）"""
    b = Builder()
    b.quad_both_sides(
        (-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    b.quad_both_sides(
        (0, -1, -0.6), (0, -1, 0.6), (0, 1, 0.6), (0, 1, -0.6),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    return b


def build_pedestal():
    """
    2 段の台座。天面に円形の刻印が出るよう、上の段の天面だけ円盤として貼る。
    側面はテクスチャの左端（無地の石）を巻き、模様が横に伸びないようにする
    """
    b = Builder()
    b.drum(8, 0.9, -1.0, 0.35, 0.02, 0.14, 0.0)  # 下段（天面は上の段で隠れる）
    b.drum(8, 0.75, 0.35, 0.9, 0.02, 0.14, 0.48)  # 上段：天面に刻印
    return b


def build_switch():
    """柱 + 傾いた操作面。壁の裏から見ても「触るもの」だと分かる形にする"""
    b = Builder()
    b.box((0.0, -0.45, 0.0), (0.32, 0.55, 0.32))  # 柱
    b.box((0.0, 0.35, 0.0), (0.85, 0.28, 0.6))  # 台
    # 操作面：手前へ傾けた板
    b.quad_both_sides(
        (-0.75, 0.6, 0.45), (0.75, 0.6, 0.45), (0.75, 1.0, -0.2), (-0.75, 1.0, -0.2),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    return b


def build_caster():
    """影を落とす塊。半透明で薄く見えるだけなので、面の向きが読める最小の立体でよい"""
    b = Builder()
    b.octahedron(1.0)
    return b


def build_gate():
    """
    目標の門（SG-10、上位計画 §1 の I）。段積みの石塔の中央に、縦長のアーチ。

    **絵は 1 枚しか貼れない**（材質は 1 つ）ので、テクスチャの使い分けは UV で行う。
      - 石塔 … 左端の縦帯 [0, 0.12]（`gate_glow.png` の外側の暗い段）
      - アーチ … 全面 [0, 1]。**中心の白がそのまま画面でいちばん明るい面になる**
    アーチは石塔よりわずかに手前（+Z）へ出して、深度を持たない世代でも必ず前に来るようにする。
    """
    b = Builder()
    # 段積みの石塔（左右 2 本）。上へ行くほど細くする
    for side in (-1.0, 1.0):
        b.box((side * 0.72, -0.55, 0.0), (0.26, 0.45, 0.26), 0.0, 0.0, 0.12, 1.0)
        b.box((side * 0.72, 0.05, 0.0), (0.20, 0.18, 0.20), 0.0, 0.0, 0.12, 1.0)
        b.box((side * 0.72, 0.38, 0.0), (0.15, 0.16, 0.15), 0.0, 0.0, 0.12, 1.0)
    # 冠石（2 本を渡す横木）
    b.box((0.0, 0.62, 0.0), (0.95, 0.12, 0.18), 0.0, 0.0, 0.12, 1.0)
    # 光るアーチ。**交差する 2 枚の板**にする（草木と同じ作り方）。
    # 2D 世代は横から、3D 世代は通路の奥から近づくので、1 枚だと片方で真横を向く
    b.quad_both_sides(
        (-0.42, -1.0, 0.0), (0.42, -1.0, 0.0), (0.42, 0.5, 0.0), (-0.42, 0.5, 0.0),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    b.quad_both_sides(
        (0.0, -1.0, -0.42), (0.0, -1.0, 0.42), (0.0, 0.5, 0.42), (0.0, 0.5, -0.42),
        (0, 0), (1, 0), (1, 1), (0, 1),
    )
    return b


def build_mark():
    """床に埋まった刻印。天面だけが見えればよいので、薄い板にする"""
    b = Builder()
    b.box((0.0, -0.5, 0.0), (1.0, 0.5, 1.0))
    return b


PROPS = {
    "props_vine": build_vine,
    "props_pedestal": build_pedestal,
    "props_switch": build_switch,
    "props_enemy": build_enemy,
    "props_caster": build_caster,
    "props_mark": build_mark,
    "props_gate": build_gate,
}


def export(name):
    path = os.path.join(OUT_DIR, name)
    bpy.ops.object.select_all(action="SELECT")
    # Docs/asset-rules.md §9 の設定。プロップはスキンもアニメも持たない
    bpy.ops.export_scene.gltf(
        filepath=path,
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
    print("EXPORTED:", path + ".gltf")


os.makedirs(OUT_DIR, exist_ok=True)
for prop_name, build in PROPS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_object(prop_name, build())
    export(prop_name)

sys.exit(0)
