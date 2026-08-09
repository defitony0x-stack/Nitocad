"""
Piping components: pipes, flanges, elbows.
"""
import cadquery as cq
import math

def generate_pipe_fitting(params: dict) -> cq.Workplane:
    """
    Generate a pipe or pipe fitting.
    
    Expected params:
    - fitting_type: "pipe", "elbow", "tee"
    - outer_diameter_mm: Outer diameter
    - wall_thickness_mm: Wall thickness
    - length_mm: Length (for pipe)
    - angle_deg: Angle (for elbow, default 90)
    """
    fitting_type = params.get('fitting_type', 'pipe')
    outer = params.get('outer_diameter_mm', 20.0)
    wall = params.get('wall_thickness_mm', 2.0)
    length = params.get('length_mm', 50.0)
    
    inner = outer - 2 * wall
    
    if fitting_type == 'pipe':
        result = (
            cq.Workplane("XY")
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length)
        )
    
    elif fitting_type == 'elbow':
        angle = params.get('angle_deg', 90)
        bend_radius = params.get('bend_radius_mm', outer * 2)
        
        # Create elbow by sweeping a ring profile along an arc
        # Simplified: create two pipes and join with a torus section.
        # pipe1/pipe2 are positioned to sit exactly flush against the
        # torus's start/end faces (matching bend_radius), which is
        # correct geometrically but leaves the solids only *touching*
        # rather than volumetrically overlapping - OCCT's boolean fuse
        # (BRepAlgoAPI_Fuse) is known to fail on that exact-coincidence
        # case with "BRep_API: command not done" (see
        # https://github.com/CadQuery/cadquery/issues/849 and
        # https://dev.opencascade.org/content/fuzzy-boolean-operations).
        # tol= on union() enables OCCT's fuzzy boolean mode, which
        # treats near/exactly-coincident faces as intersecting instead
        # of failing on them.
        # Even with tol= fuzzy booleans, OCCT's BRepAlgoAPI_Fuse can still
        # reject exactly-coincident faces in some versions/topologies,
        # especially chained union().union() calls on hollow (annular)
        # sections where both the outer AND inner radius edges coincide at
        # once. The more robust fix on top of the placement fix above:
        # don't just touch the torus's end faces, genuinely overlap into
        # them by a small epsilon, so the boolean has real 3D intersection
        # to work with instead of a degenerate shared-surface case.
        overlap = max(0.1, bend_radius * 0.005)

        pipe1 = (
            cq.Workplane("XY")
            .center(bend_radius, 0)
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length / 2)
            .translate((0, 0, -overlap))
        )
        
        # pipe2 must attach at wherever the torus's *far* end face actually
        # ends up after revolve(angle, ...). The old construction built it
        # on the "XZ" plane and rotated by a hardcoded -90deg about X, which
        # lands at (0, bend_radius, 0) with its axis along Z - nowhere near
        # the torus's real end cap at (bend_radius*cos(angle), 0,
        # -bend_radius*sin(angle)) with axis along the arc's tangent
        # direction. That's not a coincidence/tolerance issue, it's a wrong
        # placement, and it also ignored the `angle` param entirely.
        #
        # Fix: build pipe2 identically to pipe1 (same profile, same start
        # plane/orientation, same overlap nudge), then apply the *same*
        # rotation revolve() uses to sweep the torus profile from 0 to
        # `angle` about the Y axis. That guarantees pipe2's start face sits
        # exactly on (and now, thanks to the overlap nudge, slightly past)
        # the torus's end face for any angle/bend_radius, since it's the
        # same rigid transform revolve() applies internally.
        pipe2 = (
            cq.Workplane("XY")
            .center(bend_radius, 0)
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length / 2)
            .translate((0, 0, -overlap))
            .rotate((0, 0, 0), (0, 1, 0), angle)
        )
        
        # Create torus section for the bend
        torus = (
            cq.Workplane("XY")
            .center(bend_radius, 0)
            .circle(outer / 2)
            .circle(inner / 2)
            .revolve(angle, (0, 0, 0), (0, 1, 0))
        )
        
        result = pipe1.union(torus, tol=0.01).union(pipe2, tol=0.01)
    
    elif fitting_type == 'tee':
        # Main pipe
        main = (
            cq.Workplane("XY")
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length)
        )
        
        # Branch pipe
        branch = (
            cq.Workplane("XZ")
            .center(0, length / 2)
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length / 2)
        )
        
        result = main.union(branch, tol=0.01)
    
    else:
        # Default to simple pipe
        result = (
            cq.Workplane("XY")
            .circle(outer / 2)
            .circle(inner / 2)
            .extrude(length)
        )
    
    return result

def generate_flange(params: dict) -> cq.Workplane:
    """
    Generate a pipe flange.
    
    Expected params:
    - outer_diameter_mm: Flange outer diameter
    - inner_diameter_mm: Pipe bore
    - thickness_mm: Flange thickness
    - hole_count: Number of bolt holes
    - hole_diameter_mm: Bolt hole diameter
    - bolt_circle_mm: Bolt circle diameter
    """
    outer = params.get('outer_diameter_mm', 100.0)
    inner = params.get('inner_diameter_mm', 50.0)
    thickness = params.get('thickness_mm', 10.0)
    hole_count = params.get('hole_count', 4)
    hole_dia = params.get('hole_diameter_mm', 5.0)
    bolt_circle = params.get('bolt_circle_mm', 75.0)
    
    # Create flange disk
    result = (
        cq.Workplane("XY")
        .circle(outer / 2)
        .extrude(thickness)
    )
    
    # Add center bore
    result = result.faces(">Z").workplane().hole(inner)
    
    # Add bolt holes
    if hole_count > 0:
        bolt_radius = bolt_circle / 2
        angles = [i * 360.0 / hole_count for i in range(hole_count)]
        
        points = []
        for angle in angles:
            x = bolt_radius * math.cos(math.radians(angle))
            y = bolt_radius * math.sin(math.radians(angle))
            points.append((x, y))
        
        result = (
            result.faces(">Z")
            .workplane()
            .pushPoints(points)
            .hole(hole_dia)
        )
    
    return result
