"""Render deterministic +X/-X end views for Racing source-asset preflight."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> tuple[Path, Path]:
    separator = sys.argv.index("--")
    source, output_prefix = sys.argv[separator + 1 : separator + 3]
    return Path(source).resolve(), Path(output_prefix).resolve()


def scene_bounds() -> tuple[Vector, Vector]:
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        for corner in obj.bound_box
    ]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


source, prefix = arguments()
prefix.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))

minimum, maximum = scene_bounds()
center = (minimum + maximum) * 0.5
span = maximum - minimum

camera_data = bpy.data.cameras.new("PreflightCamera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = max(span.y, span.z) * 1.45
camera = bpy.data.objects.new("PreflightCamera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera

world = bpy.data.worlds.new("PreflightWorld")
world.color = (0.055, 0.065, 0.085)
bpy.context.scene.world = world

for name, location, energy, size in (
    ("Key", center + Vector((2.0, -2.5, 3.5)), 900.0, 4.0),
    ("Fill", center + Vector((-2.0, 2.5, 2.0)), 500.0, 3.0),
):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    point_camera(light, center)
    bpy.context.collection.objects.link(light)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False

distance = max(span.x, 1.0) * 2.5
for label, direction in (("plus-x", 1.0), ("minus-x", -1.0)):
    camera.location = center + Vector((direction * distance, 0.0, span.z * 0.18))
    point_camera(camera, center)
    scene.render.filepath = str(prefix.with_name(f"{prefix.name}-{label}.png"))
    bpy.ops.render.render(write_still=True)
