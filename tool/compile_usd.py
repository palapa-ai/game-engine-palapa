#!/usr/bin/env python3
"""Compile authored USD polygon meshes with the OpenUSD SDK for the web runtime."""
import argparse
import json
import struct
from pathlib import Path
from pxr import Usd, UsdGeom, UsdShade


def compile_scene(source, output):
    stage = Usd.Stage.Open(str(source))
    if not stage:
        raise ValueError(f'Cannot open USD stage: {source}')
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y:
        raise ValueError('Web scenes must be authored with Y up')
    data = bytearray()
    materials = []
    material_indices = {}

    def buffer(values, kind, item_size):
        offset = len(data)
        data.extend(struct.pack('<' + kind * len(values), *values))
        return {'offset': offset, 'count': len(values) // item_size}

    def material_index(material):
        path = str(material.GetPath()) if material else ''
        if path in material_indices:
            return material_indices[path]
        result = {'name': material.GetPrim().GetName() if material else 'Default',
                  'color': [1, 1, 1], 'roughness': .5, 'metalness': 0, 'opacity': 1}
        if material:
            shader, _, _ = material.ComputeSurfaceSource()
            if not shader or shader.GetIdAttr().Get() != 'UsdPreviewSurface':
                raise ValueError(f'{path}: expected UsdPreviewSurface material')
            for name, field in [('diffuseColor', 'color'), ('roughness', 'roughness'),
                                ('metallic', 'metalness'), ('opacity', 'opacity'),
                                ('emissiveColor', 'emissive'), ('ior', 'ior'),
                                ('clearcoat', 'clearcoat'), ('clearcoatRoughness', 'clearcoatRoughness'),
                                ('opacityThreshold', 'alphaTest'), ('opacityMode', 'opacityMode')]:
                value = shader.GetInput(name)
                if not value:
                    continue
                if value.HasConnectedSource():
                    raise ValueError(f'{path}.{name}: bake texture connections before compiling')
                value = value.Get()
                if value is not None:
                    result[field] = list(value) if name.endswith('Color') else value
            mode = result.pop('opacityMode', 'transparent')
            if mode not in ('transparent', 'presence'):
                raise ValueError(f'{path}: unsupported opacityMode {mode}')
            # USD translucent surfaces retain Fresnel reflection; they are not
            # alpha-faded surfaces. A nonzero threshold instead means a cutout.
            if result.get('alphaTest', 0) == 0 and mode == 'transparent' and result['opacity'] < 1:
                result['transmission'] = 1 - result['opacity']
                result['opacity'] = 1
                result.setdefault('ior', 1.5)
        index = len(materials)
        material_indices[path] = index
        materials.append(result)
        return index

    def mesh_data(prim):
        mesh = UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get() or []
        counts = mesh.GetFaceVertexCountsAttr().Get() or []
        point_indices = mesh.GetFaceVertexIndicesAttr().Get() or []
        if sum(counts) != len(point_indices):
            raise ValueError(f'{prim.GetPath()}: invalid polygon topology')
        normals = mesh.GetNormalsAttr().Get() or []
        interpolation = mesh.GetNormalsInterpolation()
        uv = UsdGeom.PrimvarsAPI(prim).GetPrimvar('st')
        texcoords = uv.ComputeFlattened() if uv else []
        texcoords = texcoords or []
        uv_interpolation = uv.GetInterpolation() if uv else None
        material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
        face_materials = [material_index(material)] * len(counts)
        for subset in UsdShade.MaterialBindingAPI(prim).GetMaterialBindSubsets():
            bound = UsdShade.MaterialBindingAPI(subset.GetPrim()).ComputeBoundMaterial()[0]
            index = material_index(bound)
            for face in subset.GetIndicesAttr().Get() or []:
                face_materials[face] = index

        def attribute(values, mode, point, corner, face):
            if not values:
                return ()
            index = {'vertex': point, 'varying': point, 'faceVarying': corner,
                     'uniform': face, 'constant': 0}.get(str(mode))
            if index is None or index >= len(values):
                raise ValueError(f'{prim.GetPath()}: invalid attribute interpolation {mode}')
            return tuple(values[index])

        positions, normal_values, uv_values, indices, groups = [], [], [], [], []
        vertices = {}
        corner = 0
        reverse = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
        for face, count in enumerate(counts):
            if count < 3:
                raise ValueError(f'{prim.GetPath()}: polygon has fewer than 3 vertices')
            start = len(indices)
            for triangle in range(1, count - 1):
                corners = [corner, corner + triangle, corner + triangle + 1]
                if reverse:
                    corners.reverse()
                for current in corners:
                    point = point_indices[current]
                    normal = attribute(normals, interpolation, point, current, face)
                    texcoord = attribute(texcoords, uv_interpolation, point, current, face)
                    key = (point, normal, texcoord)
                    if key not in vertices:
                        vertices[key] = len(positions) // 3
                        positions.extend(points[point])
                        normal_values.extend(normal)
                        uv_values.extend(texcoord)
                    indices.append(vertices[key])
            count_indices = len(indices) - start
            index = face_materials[face]
            if groups and groups[-1]['material'] == index:
                groups[-1]['count'] += count_indices
            else:
                groups.append({'start': start, 'count': count_indices, 'material': index})
            corner += count
        result = {'position': buffer(positions, 'f', 3), 'index': buffer(indices, 'I', 1),
                  'groups': groups, 'doubleSided': bool(mesh.GetDoubleSidedAttr().Get())}
        if normal_values:
            result['normal'] = buffer(normal_values, 'f', 3)
        if uv_values:
            result['uv'] = buffer(uv_values, 'f', 2)
        return result

    def node(prim):
        if prim.IsA(UsdShade.Material) or prim.IsA(UsdShade.Shader):
            return None
        result = {'name': prim.GetName(), 'children': []}
        xform = UsdGeom.Xformable(prim)
        if xform:
            matrix = xform.GetLocalTransformation()
            if xform.GetResetXformStack():
                raise ValueError(f'{prim.GetPath()}: resetXformStack is unsupported')
            result['matrix'] = [matrix[row][column] for row in range(4) for column in range(4)]
        imageable = UsdGeom.Imageable(prim)
        if imageable and imageable.GetVisibilityAttr().Get() == UsdGeom.Tokens.invisible:
            result['visible'] = False
        metadata = prim.GetAllAuthoredMetadata().get('customData')
        if metadata:
            result['metadata'] = dict(metadata)
        if prim.IsA(UsdGeom.Mesh):
            result['geometry'] = mesh_data(prim)
        result['children'] = [value for child in prim.GetChildren() if (value := node(child))]
        return result

    roots = [value for prim in stage.GetPseudoRoot().GetChildren() if (value := node(prim))]
    binary = output.with_suffix('.bin')
    default = stage.GetDefaultPrim()
    metadata = dict(default.GetAllAuthoredMetadata().get('customData', {})) if default else {}
    compiled = {'version': 1, 'buffer': binary.name, 'metersPerUnit': UsdGeom.GetStageMetersPerUnit(stage),
                'materials': materials, 'nodes': roots, 'metadata': metadata}
    output.parent.mkdir(parents=True, exist_ok=True)
    binary.write_bytes(data)
    output.write_text(json.dumps(compiled, separators=(',', ':')) + '\n')
    print(f'{source.name}: {len(materials)} materials, {len(data)} geometry bytes → {output.name}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    compile_scene(args.source.resolve(), args.output.resolve())
