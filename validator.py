"""
Geometric validation and auto-correction for CAD parameters.
"""
from typing import Dict, Any, List, Tuple

class ValidationError(Exception):
    """Raised when geometry is invalid."""
    pass

class ValidationResult:
    """Result of validation with corrections."""
    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.corrections: Dict[str, Any] = {}
        self.is_valid: bool = True
    
    def add_error(self, msg: str):
        self.errors.append(msg)
        self.is_valid = False
    
    def add_warning(self, msg: str):
        self.warnings.append(msg)
    
    def add_correction(self, param: str, old_value: Any, new_value: Any):
        self.corrections[param] = {'old': old_value, 'new': new_value}

def validate_motor_mount(params: Dict[str, Any]) -> ValidationResult:
    """Validate motor mount parameters."""
    result = ValidationResult()
    
    thickness = params.get('thickness_mm', 3.0)
    hole_diameter = params.get('hole_diameter_mm', 3.2)
    fillet_radius = params.get('fillet_radius_mm', 2.0)
    motor_size = params.get('motor_size_mm', 50.0)
    
    # Hole diameter must be reasonable
    if hole_diameter > 20:
        result.add_warning(f"Hole diameter {hole_diameter}mm seems large, capping at 20mm")
        result.corrections['hole_diameter_mm'] = {'old': hole_diameter, 'new': 20.0}
    
    # Fillet radius must be less than half thickness
    if fillet_radius >= thickness / 2:
        new_fillet = thickness / 2 - 0.1
        result.add_warning(f"Fillet radius {fillet_radius}mm too large for {thickness}mm thickness, reducing to {new_fillet:.1f}mm")
        result.corrections['fillet_radius_mm'] = {'old': fillet_radius, 'new': new_fillet}
    
    # Motor size sanity check
    if motor_size < 20 or motor_size > 200:
        result.add_warning(f"Motor size {motor_size}mm unusual, using default 50mm")
        result.corrections['motor_size_mm'] = {'old': motor_size, 'new': 50.0}
    
    return result

def validate_l_bracket(params: Dict[str, Any]) -> ValidationResult:
    """Validate L-bracket parameters."""
    result = ValidationResult()
    
    width = params.get('width_mm', 50.0)
    height = params.get('height_mm', 60.0)
    depth = params.get('depth_mm', 40.0)
    thickness = params.get('thickness_mm', 3.0)
    hole_diameter = params.get('hole_diameter_mm', 3.2)
    fillet_radius = params.get('fillet_radius_mm', 2.0)
    
    # All dimensions must be positive
    for dim_name, dim_value in [('width', width), ('height', height), ('depth', depth), ('thickness', thickness)]:
        if dim_value <= 0:
            result.add_error(f"{dim_name} must be positive, got {dim_value}")
    
    # Thickness must be reasonable relative to other dimensions
    if thickness > min(width, height, depth) / 3:
        new_thickness = min(width, height, depth) / 3
        result.add_warning(f"Thickness {thickness}mm too large, reducing to {new_thickness:.1f}mm")
        result.corrections['thickness_mm'] = {'old': thickness, 'new': new_thickness}
    
    # Hole diameter must be less than thickness
    if hole_diameter >= thickness:
        new_hole = thickness - 0.5
        result.add_warning(f"Hole diameter {hole_diameter}mm >= thickness {thickness}mm, reducing to {new_hole:.1f}mm")
        result.corrections['hole_diameter_mm'] = {'old': hole_diameter, 'new': new_hole}
    
    # Fillet radius must be less than half thickness
    if fillet_radius >= thickness / 2:
        new_fillet = thickness / 2 - 0.1
        result.add_warning(f"Fillet radius {fillet_radius}mm too large, reducing to {new_fillet:.1f}mm")
        result.corrections['fillet_radius_mm'] = {'old': fillet_radius, 'new': new_fillet}
    
    return result

def validate_flat_plate(params: Dict[str, Any]) -> ValidationResult:
    """Validate flat plate parameters."""
    result = ValidationResult()
    
    length = params.get('length_mm', 100.0)
    width = params.get('width_mm', 80.0)
    thickness = params.get('thickness_mm', 5.0)
    hole_diameter = params.get('hole_diameter_mm', 3.2)
    corner_fillet = params.get('corner_fillet_mm', 3.0)
    hole_count_x = params.get('hole_count_x', 4)
    hole_count_y = params.get('hole_count_y', 3)
    
    # Dimensions must be positive
    if length <= 0 or width <= 0 or thickness <= 0:
        result.add_error("All dimensions must be positive")
    
    # Hole diameter must be less than thickness
    if hole_diameter >= thickness:
        new_hole = thickness - 0.5
        result.add_warning(f"Hole diameter {hole_diameter}mm >= thickness {thickness}mm, reducing to {new_hole:.1f}mm")
        result.corrections['hole_diameter_mm'] = {'old': hole_diameter, 'new': new_hole}
    
    # Corner fillet must be less than quarter of smallest dimension
    max_fillet = min(length, width) / 4
    if corner_fillet >= max_fillet:
        new_fillet = max_fillet - 0.1
        result.add_warning(f"Corner fillet {corner_fillet}mm too large, reducing to {new_fillet:.1f}mm")
        result.corrections['corner_fillet_mm'] = {'old': corner_fillet, 'new': new_fillet}
    
    # Hole count sanity check
    if hole_count_x < 1 or hole_count_y < 1:
        result.add_warning("Hole count must be at least 1")
        result.corrections['hole_count_x'] = {'old': hole_count_x, 'new': max(1, hole_count_x)}
        result.corrections['hole_count_y'] = {'old': hole_count_y, 'new': max(1, hole_count_y)}
    
    return result

def validate_shaft(params: Dict[str, Any]) -> ValidationResult:
    """Validate shaft parameters."""
    result = ValidationResult()
    
    diameter = params.get('diameter_mm', 10.0)
    length = params.get('length_mm', 50.0)
    
    if diameter <= 0 or length <= 0:
        result.add_error("Diameter and length must be positive")
    
    # Length should be at least diameter
    if length < diameter:
        result.add_warning(f"Length {length}mm < diameter {diameter}mm, adjusting")
        result.corrections['length_mm'] = {'old': length, 'new': diameter * 2}
    
    return result

def validate_gear(params: Dict[str, Any]) -> ValidationResult:
    """Validate gear parameters."""
    result = ValidationResult()
    
    module = params.get('module', 2.0)
    teeth = params.get('teeth', 20)
    bore = params.get('bore_diameter_mm', 5.0)
    
    if teeth < 10:
        result.add_warning(f"Gear with {teeth} teeth may have undercut, minimum recommended is 17")
    
    if module <= 0:
        result.add_error("Module must be positive")
    
    # Bore must be smaller than pitch diameter
    pitch_diameter = module * teeth
    if bore >= pitch_diameter * 0.8:
        new_bore = pitch_diameter * 0.5
        result.add_warning(f"Bore {bore}mm too large for gear, reducing to {new_bore:.1f}mm")
        result.corrections['bore_diameter_mm'] = {'old': bore, 'new': new_bore}
    
    return result

def validate_bearing(params: Dict[str, Any]) -> ValidationResult:
    """Validate bearing parameters."""
    result = ValidationResult()
    
    inner = params.get('inner_diameter_mm', 10.0)
    outer = params.get('outer_diameter_mm', 20.0)
    width = params.get('width_mm', 5.0)
    
    if outer <= inner:
        result.add_error(f"Outer diameter {outer}mm must be greater than inner {inner}mm")
        result.corrections['outer_diameter_mm'] = {'old': outer, 'new': inner * 2}
    
    if width <= 0:
        result.add_error("Width must be positive")
    
    return result

def validate_simple_box(params: Dict[str, Any]) -> ValidationResult:
    """Validate box parameters."""
    result = ValidationResult()
    
    length = params.get('length_mm', 100.0)
    width = params.get('width_mm', 80.0)
    height = params.get('height_mm', 50.0)
    wall = params.get('wall_thickness_mm', 3.0)
    
    # Wall thickness must be less than half of smallest dimension
    min_dim = min(length, width, height)
    if wall >= min_dim / 2:
        new_wall = min_dim / 2 - 0.5
        result.add_warning(f"Wall thickness {wall}mm too large, reducing to {new_wall:.1f}mm")
        result.corrections['wall_thickness_mm'] = {'old': wall, 'new': new_wall}
    
    return result

def validate_parameters(part_type: str, params: Dict[str, Any]) -> Tuple[Dict[str, Any], ValidationResult]:
    """
    Validate and auto-correct parameters for any part type.
    Returns corrected parameters and validation result.
    """
    validators = {
        'motor_mount': validate_motor_mount,
        'l_bracket': validate_l_bracket,
        'flat_plate': validate_flat_plate,
        'shaft': validate_shaft,
        'gear': validate_gear,
        'bearing': validate_bearing,
        'simple_box': validate_simple_box,
    }
    
    validator = validators.get(part_type)
    if validator:
        result = validator(params)
        
        # Apply corrections
        corrected_params = params.copy()
        for param, correction in result.corrections.items():
            corrected_params[param] = correction['new']
        
        return corrected_params, result
    else:
        # No validator, return as-is
        return params, ValidationResult()
