"""
Assembly support for multi-part CAD generation.
"""
import cadquery as cq
from typing import Dict, Any, List
from cad_templates import TEMPLATES

def generate_assembly(parts_spec: List[Dict[str, Any]]) -> cq.Assembly:
    """
    Generate an assembly from multiple parts.
    
    Each part spec should have:
    - name: Part name
    - part_type: Type of part
    - parameters: Part parameters
    - position: (x, y, z) position
    - rotation: (rx, ry, rz) rotation in degrees (optional)
    - constraints: List of constraints (optional)
    """
    assy = cq.Assembly()
    
    for part_spec in parts_spec:
        name = part_spec.get('name', 'part')
        part_type = part_spec.get('part_type')
        params = part_spec.get('parameters', {})
        position = part_spec.get('position', (0, 0, 0))
        rotation = part_spec.get('rotation', (0, 0, 0))
        
        # Generate the part
        if part_type in TEMPLATES:
            template_func = TEMPLATES[part_type]
            workplane = template_func(params)
            
            # Add to assembly with position and rotation
            loc = cq.Location(
                cq.Vector(*position),
                cq.Vector(1, 0, 0),
                rotation[0]
            ) * cq.Location(
                cq.Vector(0, 0, 0),
                cq.Vector(0, 1, 0),
                rotation[1]
            ) * cq.Location(
                cq.Vector(0, 0, 0),
                cq.Vector(0, 0, 1),
                rotation[2]
            )
            
            assy.add(workplane, name=name, loc=loc)
    
    return assy

def parse_assembly_description(description: str) -> List[Dict[str, Any]]:
    """
    Parse assembly description into parts list.
    This is a simplified parser - in production, use LLM.
    """
    # For MVP, just return a simple example assembly
    # In production, this would use the LLM to parse complex descriptions
    return [
        {
            'name': 'base_plate',
            'part_type': 'flat_plate',
            'parameters': {
                'length_mm': 100.0,
                'width_mm': 80.0,
                'thickness_mm': 5.0,
                'hole_pattern': 'rectangular',
                'hole_count_x': 4,
                'hole_count_y': 3,
                'hole_diameter_mm': 3.2,
                'corner_fillet_mm': 3.0
            },
            'position': (0, 0, 0),
            'rotation': (0, 0, 0)
        },
        {
            'name': 'bracket',
            'part_type': 'l_bracket',
            'parameters': {
                'width_mm': 40.0,
                'height_mm': 50.0,
                'depth_mm': 30.0,
                'thickness_mm': 3.0,
                'hole_count': 2,
                'hole_diameter_mm': 3.2,
                'fillet_radius_mm': 2.0
            },
            'position': (0, 0, 5.0),
            'rotation': (0, 0, 0)
        }
    ]
