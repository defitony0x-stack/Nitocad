"""
Main CAD generation pipeline with validation and assembly support.
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import cadquery as cq

import db
import exporters
import storage
from assembly import generate_assembly, get_assembly_parts, parse_assembly_description
from cad_templates import TEMPLATES
from cad_templates._safe_ops import safe_chamfer, safe_fillet
from config import settings
from deepseek_parser import parse_description as deepseek_parse_description
from exceptions import (
    AssemblyError,
    GenerationError,
    GeometryValidationError,
    NitocadError,
    ParseError,
    StorageError,
    UnsupportedPartTypeError,
)
from logging_config import get_logger, log_duration
from validator import validate_parameters

logger = get_logger(__name__)

# Bounds on the *number* of extra operations a single request can chain -
# unrelated to any one operation's own parameter validation (radius,
# thickness, etc, which validator.py / safe_fillet/safe_chamfer already
# bound). Without this, a pathological `operations` list (thousands of
# entries) is a cheap way to make one request tie up the OCCT kernel for
# a long time - each fillet/chamfer/shell call is real geometry work, not
# a no-op.
MAX_OPERATIONS_PER_REQUEST = 25


class CADGenerator:
    """Main CAD generation engine."""

    def __init__(self, output_dir: str | None = None):
        self.output_dir = Path(output_dir or settings.OUTPUT_DIR)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate_from_text(
        self,
        description: str,
        use_deepseek: bool | None = None,
        api_key: str | None = None,
        model: str = "deepseek-v4-flash",
        user_id: str = "default",
        formats: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        Generate CAD from natural language description.

        use_deepseek: None (default) = auto - uses DeepSeek if a key
        resolves from anywhere (caller-supplied api_key, or this server's
        own DEEPSEEK_API_KEY env var), otherwise regex. True/False force
        one or the other explicitly. See deepseek_parser.parse_description
        for the full resolution logic - this is what lets the frontend
        not need a DeepSeek toggle in the UI at all; the server decides.

        formats: which export formats to produce. Defaults to every
        supported format (exporters.DEFAULT_FORMATS = "step", "stl",
        "iges", "dxf", "pdf") when omitted - pass an explicit list to
        narrow it. Invalid entries raise UnsupportedFormatError (422)
        before any geometry work happens.

        Returns dict with:
        - step_file / stl_file / iges_file / dxf_file / pdf_file: local
          paths for each requested format (only formats that were
          requested are populated; the rest are None)
        - step_url / stl_url / iges_url / dxf_url / pdf_url: matching
          download URLs (R2 if configured, else local /download/{fmt}/..)
        - parameters: Parsed parameters used
        - validation: Validation results
        - success: Boolean
        - error / error_type: populated on failure
        """
        # Defined before the try block so the except handler below always
        # has a value, even in the unlikely case parsing itself throws
        # before the resolution logic runs.
        resolved_key = api_key or settings.DEEPSEEK_API_KEY
        used_deepseek = bool(resolved_key) and use_deepseek is not False

        try:
            if not description or not description.strip():
                raise ParseError("description must not be empty")
            if len(description) > 4000:
                raise ParseError(
                    f"description is {len(description)} characters; the parser isn't "
                    "designed for anything beyond a short part spec. Keep it under 4000."
                )

            # Fail fast on a bad format list before doing any parse/geometry
            # work - no point spending an OCCT build only to reject the
            # export format at the very end.
            resolved_formats = exporters.validate_formats(list(formats) if formats else list(exporters.DEFAULT_FORMATS))

            with log_duration(logger, "parse", part_type=None):
                params = deepseek_parse_description(
                    description, use_deepseek=use_deepseek, api_key=api_key, model=model
                )

            # Mirrors deepseek_parser.parse_description's own resolution
            # logic, purely so the db audit log records what actually
            # happened rather than just echoing the caller's input flag.
            used_deepseek = (use_deepseek is not False) and bool(resolved_key)

            if params.part_type == "unknown":
                raise ParseError("Could not determine part type from description")

            logger.info(
                "parsed description",
                extra={"part_type": params.part_type, "used_deepseek": used_deepseek},
            )

            # Step 2: Validate and auto-correct parameters
            with log_duration(logger, "validate", part_type=params.part_type):
                corrected_params, validation_result = validate_parameters(
                    params.part_type, params.parameters
                )

            if not validation_result.is_valid:
                raise GeometryValidationError(
                    "Parameters are geometrically invalid: " + "; ".join(validation_result.errors),
                    details={"errors": validation_result.errors},
                )

            if validation_result.warnings:
                logger.warning(
                    "validation warnings: %s",
                    validation_result.warnings,
                    extra={"part_type": params.part_type},
                )
            if validation_result.corrections:
                logger.info(
                    "auto-corrections applied: %s",
                    validation_result.corrections,
                    extra={"part_type": params.part_type},
                )
                params.parameters = corrected_params

            # Step 3: Generate CAD
            if params.part_type == "assembly":
                export_paths = self._generate_assembly(description, resolved_formats)
            else:
                export_paths = self._generate_single_part(
                    params, validation_result, resolved_formats
                )

            # Upload each produced format to R2 if configured, otherwise
            # fall back to serving the local file via /download/{fmt}/{filename}
            # - see storage.py and the download routes in web_app.py.
            try:
                urls = {
                    fmt: (
                        storage.upload_export(str(p), fmt)
                        or f"/download/{fmt}/{p.name}"
                    )
                    for fmt, p in export_paths.items()
                }
            except Exception as exc:  # noqa: BLE001 - genuinely any storage backend error
                raise StorageError(f"Generated locally but failed to upload: {exc}") from exc

            step_url = urls.get("step")
            stl_url = urls.get("stl")

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

            result = {
                "success": True,
                "job_id": job_id,
                "parameters": params.dict(),
                "validation": {
                    "warnings": validation_result.warnings,
                    "errors": validation_result.errors,
                    "corrections": validation_result.corrections,
                },
                "error": None,
            }
            # step_file/stl_file/... and step_url/stl_url/... - populated
            # only for formats that were actually requested, None otherwise,
            # so old callers that only ever look at step_file/stl_file keep
            # working unchanged.
            for fmt in exporters.SUPPORTED_FORMATS:
                result[f"{fmt}_file"] = str(export_paths[fmt]) if fmt in export_paths else None
                result[f"{fmt}_url"] = urls.get(fmt)
            return result

        except NitocadError as exc:
            logger.warning("generation failed (%s): %s", type(exc).__name__, exc.message)
            db.record_job(
                description=description, user_id=user_id, success=False,
                used_deepseek=used_deepseek, error=exc.message,
            )
            return {
                "success": False,
                "error": exc.message,
                "error_type": type(exc).__name__,
                "parameters": None,
            }
        except Exception as exc:  # noqa: BLE001 - last-resort boundary; see exceptions.py
            logger.exception("unexpected generation failure")
            db.record_job(
                description=description, user_id=user_id, success=False,
                used_deepseek=used_deepseek, error=str(exc),
            )
            return {
                "success": False,
                "error": f"Generation failed: {exc}",
                "error_type": "UnexpectedError",
                "parameters": None,
            }

    # -- internal helpers ------------------------------------------------

    def _generate_assembly(
        self, description: str, formats: list[str]
    ) -> dict[str, Path]:
        try:
            with log_duration(logger, "assembly_build"):
                parts_spec = parse_assembly_description(description)
                assembly = generate_assembly(parts_spec)
        except Exception as exc:  # noqa: BLE001
            raise AssemblyError(f"Assembly construction failed: {exc}") from exc

        base_name = f"assembly_{uuid.uuid4().hex}"
        compound = assembly.toCompound()
        # Per-part shapes (name, world-located shape) for the multi-part
        # DXF/PDF drawing path - see assembly.get_assembly_parts and the
        # `parts` param on exporters.export_all/export_dxf/export_pdf.
        # step/stl/iges still use the flattened `compound` below; only
        # dxf/pdf draw one block per part instead of one for the compound.
        try:
            with log_duration(logger, "assembly_parts"):
                parts = get_assembly_parts(assembly)
        except Exception as exc:  # noqa: BLE001
            raise AssemblyError(f"Failed to enumerate assembly parts: {exc}") from exc

        try:
            with log_duration(logger, "assembly_export", formats=",".join(formats)):
                export_paths: dict[str, Path] = {}
                # STEP for an assembly goes through Assembly.save(), not
                # exporters.export_step(), because that's what preserves
                # named sub-parts in the STEP file rather than flattening
                # to one solid - every other format works on the compound.
                if "step" in formats:
                    step_path = self.output_dir / f"{base_name}.step"
                    assembly.save(str(step_path))
                    export_paths["step"] = step_path
                remaining = [f for f in formats if f != "step"]
                if remaining:
                    export_paths.update(
                        exporters.export_all(
                            compound,
                            self.output_dir,
                            base_name,
                            formats=remaining,
                            part_name="assembly",
                            parts=parts,
                        )
                    )
        except Exception as exc:  # noqa: BLE001
            raise GenerationError(f"Assembly export failed: {exc}") from exc

        return export_paths

    def _generate_single_part(
        self, params: Any, validation_result: Any, formats: list[str]
    ) -> dict[str, Path]:
        if params.part_type not in TEMPLATES:
            raise UnsupportedPartTypeError(f"Unsupported part type: {params.part_type}")

        template_func = TEMPLATES[params.part_type]
        try:
            with log_duration(logger, "template_build", part_type=params.part_type):
                workplane = template_func(params.parameters)

            if "operations" in params.parameters:
                operations = params.parameters["operations"]
                if len(operations) > MAX_OPERATIONS_PER_REQUEST:
                    raise GenerationError(
                        f"Too many operations requested ({len(operations)}); "
                        f"max is {MAX_OPERATIONS_PER_REQUEST}."
                    )
                with log_duration(logger, "apply_operations", part_type=params.part_type):
                    workplane = self._apply_operations(
                        workplane, operations, warnings=validation_result.warnings
                    )
        except NitocadError:
            raise
        except Exception as exc:  # noqa: BLE001 - CadQuery/OCCT raises many exception types
            raise GenerationError(f"Failed to build {params.part_type}: {exc}") from exc

        base_name = f"{params.part_type}_{uuid.uuid4().hex}"

        try:
            with log_duration(logger, "export_all", part_type=params.part_type, formats=",".join(formats)):
                export_paths = exporters.export_all(
                    workplane,
                    self.output_dir,
                    base_name,
                    formats=formats,
                    part_name=params.part_type,
                    material=getattr(params, "material", None),
                    part_type=params.part_type,
                )
        except NitocadError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise GenerationError(f"Export failed for {params.part_type}: {exc}") from exc

        return export_paths

    def _apply_operations(
        self, workplane: cq.Workplane, operations: list, warnings: list | None = None
    ) -> cq.Workplane:
        """Apply additional CAD operations to workplane."""
        for op in operations:
            op_type = op.get("type")

            if op_type == "fillet":
                radius = op.get("radius", 1.0)
                edges = op.get("edges", "all")
                selector = None if edges == "all" else edges
                workplane = safe_fillet(workplane, radius, selector, warnings=warnings)

            elif op_type == "chamfer":
                size = op.get("size", 1.0)
                edges = op.get("edges", "all")
                selector = None if edges == "all" else edges
                workplane = safe_chamfer(workplane, size, selector, warnings=warnings)

            elif op_type == "shell":
                thickness = op.get("thickness", 2.0)
                open_top = op.get("open_top", True)
                if open_top:
                    workplane = workplane.faces(">Z").shell(-thickness)
                else:
                    workplane = workplane.shell(-thickness)
            else:
                logger.warning("unknown operation type %r ignored", op_type)

        return workplane


# Global instance
generator = CADGenerator()
