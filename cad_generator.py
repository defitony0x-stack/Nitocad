"""
Main CAD generation pipeline with validation and assembly support.
"""
import os
import uuid
from pathlib import Path
from typing import Optional
import cadquery as cq
from cad_templates import TEMPLATES
from smart_parser import parse_description as regex_parse_description
from deepseek_parser import parse_description as deepseek_parse_description
from validator import validate_parameters
from assembly import generate_assembly, parse_assembly_description
import db
import storage
from cad_templates._safe_ops import safe_fillet, safe_chamfer

class CADGenerator:
    """Main CAD generation engine."""
    
    def __init__(self, output_dir: str = "./output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
    
    def generate_from_text(
        self, 
        description: str, 
        use_deepseek: Optional[bool] = None,
        api_key: Optional[str] = None,
        model: str = "deepseek-v4-flash",
        user_id: str = "default",
    ) -> dict:
        """
        Generate CAD from natural language description.

        use_deepseek: None (default) = auto - uses DeepSeek if a key
        resolves from anywhere (caller-supplied api_key, or this server's
        own DEEPSEEK_API_KEY env var), otherwise regex. True/False force
        one or the other explicitly. See deepseek_parser.parse_description
        for the full resolution logic - this is what lets the frontend
        not need a DeepSeek toggle in the UI at all; the server decides.

        Returns dict with:
        - step_file: Path to .STEP file
        - stl_file: Path to .STL file (for preview)
        - parameters: Parsed parameters used
        - validation: Validation results
        - success: Boolean
        - error: Error message if failed
        """
        # Defined before the try block so the except handler below always
        # has a value, even in the unlikely case parsing itself throws
        # before the resolution logic runs.
        used_deepseek = bool((api_key or os.environ.get("DEEPSEEK_API_KEY")) and use_deepseek is not False)

        try:
            # Step 1: Parse description
            print(f"Parsing description: {description}")
            params = deepseek_parse_description(description, use_deepseek=use_deepseek, api_key=api_key, model=model)

            # Mirrors deepseek_parser.parse_description's own resolution
            # logic, purely so the db audit log records what actually
            # happened rather than just echoing the caller's input flag.
            resolved_key = api_key or os.environ.get("DEEPSEEK_API_KEY")
            used_deepseek = (use_deepseek is not False) and bool(resolved_key)
            
            if params.part_type == "unknown":
                db.record_job(
                    description=description, user_id=user_id, success=False,
                    used_deepseek=used_deepseek,
                    error="Could not determine part type from description",
                )
                return {
                    "success": False,
                    "error": "Could not determine part type from description",
                    "parameters": None
                }
            
            print(f"Detected part type: {params.part_type}")
            print(f"Parameters: {params.parameters}")
            
            # Step 2: Validate and auto-correct parameters
            corrected_params, validation_result = validate_parameters(
                params.part_type, 
                params.parameters
            )
            
            if validation_result.warnings:
                print(f"Validation warnings: {validation_result.warnings}")
            if validation_result.corrections:
                print(f"Auto-corrections: {validation_result.corrections}")
                params.parameters = corrected_params
            
            # Step 3: Generate CAD
            if params.part_type == "assembly":
                # Handle assembly
                parts_spec = parse_assembly_description(description)
                assembly = generate_assembly(parts_spec)
                
                # Export assembly
                # uuid4, not hash(description) % 10000 - str hash() is
                # randomized per-process by default and 10k buckets
                # collides fast under real concurrent traffic.
                base_name = f"assembly_{uuid.uuid4().hex}"
                step_path = self.output_dir / f"{base_name}.step"
                stl_path = self.output_dir / f"{base_name}.stl"
                
                # Save assembly
                assembly.save(str(step_path))
                
                # For STL, need to convert to compound
                compound = assembly.toCompound()
                cq.exporters.export(compound, str(stl_path))
                
            else:
                # Single part
                if params.part_type not in TEMPLATES:
                    return {
                        "success": False,
                        "error": f"Unsupported part type: {params.part_type}",
                        "parameters": params.dict()
                    }
                
                template_func = TEMPLATES[params.part_type]
                workplane = template_func(params.parameters)
                
                # Apply additional operations if specified
                if 'operations' in params.parameters:
                    workplane = self._apply_operations(workplane, params.parameters['operations'], warnings=validation_result.warnings)
                
                # Export files
                base_name = f"{params.part_type}_{uuid.uuid4().hex}"
                step_path = self.output_dir / f"{base_name}.step"
                stl_path = self.output_dir / f"{base_name}.stl"
                
                # Export STEP
                cq.exporters.export(workplane, str(step_path))
                print(f"Exported STEP: {step_path}")
                
                # Export STL for preview
                cq.exporters.export(workplane, str(stl_path))
                print(f"Exported STL: {stl_path}")
            
            # Upload to R2 if configured, otherwise fall back to serving
            # the local file via /download/step|stl/{filename} - see
            # storage.py and the download routes in web_app.py.
            step_url = storage.upload_step(str(step_path)) or f"/download/step/{step_path.name}"
            stl_url = storage.upload_stl(str(stl_path)) or f"/download/stl/{stl_path.name}"

            job_id = db.record_job(
                description=description,
                user_id=user_id,
                success=True,
                part_type=params.part_type,
                parameters=params.parameters,
                material=params.material,
                used_deepseek=used_deepseek,
                step_url=step_url,
                stl_url=stl_url,
                warnings=validation_result.warnings,
                corrections=validation_result.corrections,
            )

            return {
                "success": True,
                "job_id": job_id,
                "step_file": str(step_path),
                "stl_file": str(stl_path),
                "step_url": step_url,
                "stl_url": stl_url,
                "parameters": params.dict(),
                "validation": {
                    "warnings": validation_result.warnings,
                    "errors": validation_result.errors,
                    "corrections": validation_result.corrections
                },
                "error": None
            }
            
        except Exception as e:
            import traceback
            error_msg = f"Generation failed: {str(e)}\n{traceback.format_exc()}"
            print(error_msg)
            db.record_job(
                description=description, user_id=user_id, success=False,
                used_deepseek=used_deepseek, error=error_msg,
            )
            return {
                "success": False,
                "error": error_msg,
                "parameters": None
            }
    
    def _apply_operations(self, workplane: cq.Workplane, operations: list, warnings: Optional[list] = None) -> cq.Workplane:
        """Apply additional CAD operations to workplane."""
        for op in operations:
            op_type = op.get('type')
            
            if op_type == 'fillet':
                radius = op.get('radius', 1.0)
                edges = op.get('edges', 'all')
                selector = None if edges == 'all' else edges
                workplane = safe_fillet(workplane, radius, selector, warnings=warnings)
            
            elif op_type == 'chamfer':
                size = op.get('size', 1.0)
                edges = op.get('edges', 'all')
                selector = None if edges == 'all' else edges
                workplane = safe_chamfer(workplane, size, selector, warnings=warnings)
            
            elif op_type == 'shell':
                thickness = op.get('thickness', 2.0)
                open_top = op.get('open_top', True)
                if open_top:
                    workplane = workplane.faces('>Z').shell(-thickness)
                else:
                    workplane = workplane.shell(-thickness)
        
        return workplane

# Global instance
generator = CADGenerator()
