"""
CAD template registry.
"""
from .motor_mount import generate_motor_mount
from .l_bracket import generate_l_bracket
from .flat_plate import generate_flat_plate
from .simple_box import generate_simple_box
from .primitives import generate_shaft, generate_bearing, generate_spacer, generate_washer, generate_sphere
from .transmission import generate_gear, generate_pulley, generate_sprocket
from .structural import generate_structural_beam, generate_angle, generate_tube
from .piping import generate_pipe_fitting, generate_flange
from .freeform import generate_freeform
from .misc import generate_hinge, generate_cam
from .hardware import generate_hex_standoff, generate_t_bracket, generate_channel_bracket

TEMPLATES = {
    # Basic parts
    "motor_mount": generate_motor_mount,
    "l_bracket": generate_l_bracket,
    "flat_plate": generate_flat_plate,
    "simple_box": generate_simple_box,
    
    # Primitives
    "shaft": generate_shaft,
    "bearing": generate_bearing,
    "spacer": generate_spacer,
    "washer": generate_washer,
    "sphere": generate_sphere,
    
    # Transmission
    "gear": generate_gear,
    "pulley": generate_pulley,
    "sprocket": generate_sprocket,
    
    # Structural
    "structural_beam": generate_structural_beam,
    "angle": generate_angle,
    "tube": generate_tube,
    
    # Piping
    "pipe_fitting": generate_pipe_fitting,
    "flange": generate_flange,
    
    # Freeform
    "freeform": generate_freeform,
    
    # Misc
    "hinge": generate_hinge,
    "cam": generate_cam,

    # Hardware/structural (added after the initial 20)
    "hex_standoff": generate_hex_standoff,
    "t_bracket": generate_t_bracket,
    "channel_bracket": generate_channel_bracket,
}
