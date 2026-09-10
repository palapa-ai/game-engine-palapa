import json
import struct
import tempfile
import unittest
from pathlib import Path
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf
from compile_usd import compile_scene


class SceneCompilerTest(unittest.TestCase):
    def test_mesh_transform_normals_material_and_visibility(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'sample.usda'
            output = Path(directory) / 'sample.scene.json'
            stage = Usd.Stage.CreateNew(str(source))
            UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
            root = UsdGeom.Xform.Define(stage, '/Example')
            root.AddTranslateOp().Set(Gf.Vec3d(2, 3, 4))
            root.GetPrim().SetCustomData({'purpose': 'test'})
            stage.SetDefaultPrim(root.GetPrim())
            mesh = UsdGeom.Mesh.Define(stage, '/Example/Triangle')
            mesh.CreatePointsAttr([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
            mesh.CreateFaceVertexCountsAttr([3])
            mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
            mesh.CreateNormalsAttr([(0, 0, 1)])
            mesh.SetNormalsInterpolation(UsdGeom.Tokens.constant)
            mesh.CreateDoubleSidedAttr(True)
            mesh.CreateVisibilityAttr(UsdGeom.Tokens.invisible)
            material = UsdShade.Material.Define(stage, '/Example/Material')
            shader = UsdShade.Shader.Define(stage, '/Example/Material/Surface')
            shader.CreateIdAttr('UsdPreviewSurface')
            shader.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(.2, .4, .6))
            shader.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(.75)
            shader.CreateInput('opacity', Sdf.ValueTypeNames.Float).Set(.5)
            material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), 'surface')
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
            stage.GetRootLayer().Save()
            compile_scene(source, output)
            document = json.loads(output.read_text())
            self.assertEqual(document['metadata'], {'purpose': 'test'})
            root_node = document['nodes'][0]
            self.assertEqual(root_node['matrix'][12:15], [2, 3, 4])
            node = root_node['children'][0]
            self.assertFalse(node['visible'])
            geometry = node['geometry']
            self.assertTrue(geometry['doubleSided'])
            self.assertEqual(geometry['normal']['count'], 3)
            binary = output.with_suffix('.bin').read_bytes()
            indices = struct.unpack_from('<III', binary, geometry['index']['offset'])
            self.assertEqual(indices, (0, 1, 2))
            self.assertEqual(document['materials'][0]['roughness'], .75)
            self.assertEqual(document['materials'][0]['opacity'], .5)


if __name__ == '__main__':
    unittest.main()
