from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageDraw

from ..config import settings
from ..schemas import DetectionItem, PredictResponse


@dataclass
class PredictionPayload:
    filename: str
    model_name: str
    inference_backend: str
    detections: List[DetectionItem]
    output_image_path: Path
    inference_time: float


class BaseInferenceBackend:
    backend_name = "base"

    def predict(
        self,
        input_path: Path,
        output_path: Path,
        conf: float,
        iou: float,
        model_name: Optional[str],
        mode: Optional[str],
    ) -> PredictionPayload:
        raise NotImplementedError


def _severity_from_score(score: float) -> str:
    if score >= 0.80:
        return "高"
    if score >= 0.55:
        return "中"
    return "低"


def _clamp01(score: float) -> float:
    return max(0.0, min(1.0, score))


def _draw_detections(image: Image.Image, detections: List[DetectionItem]) -> None:
    draw = ImageDraw.Draw(image)
    for det in detections:
        x1, y1, x2, y2 = det.bbox
        draw.rectangle((x1, y1, x2, y2), outline="#a31f34", width=4)
        label = f"{det.class_name} {det.confidence:.2f}"
        draw.rectangle((x1, max(0, y1 - 26), x1 + 200, y1), fill="#a31f34")
        draw.text((x1 + 8, max(0, y1 - 22)), label, fill="white")


class MockInferenceBackend(BaseInferenceBackend):
    backend_name = "mock"

    def predict(
        self,
        input_path: Path,
        output_path: Path,
        conf: float,
        iou: float,
        model_name: Optional[str],
        mode: Optional[str],
    ) -> PredictionPayload:
        start = time.time()
        image = Image.open(input_path).convert("RGB")
        width, height = image.size

        # 生成两个稳定的示例框，便于前端联调和展示
        boxes = [
            DetectionItem(
                class_id=0,
                class_name="crack",
                confidence=max(0.55, round(min(0.92, conf + 0.62), 2)),
                bbox=[round(width * 0.18, 1), round(height * 0.22, 1), round(width * 0.48, 1), round(height * 0.36, 1)],
                severity=_severity_from_score(max(0.55, round(min(0.92, conf + 0.62), 2))),
            ),
            DetectionItem(
                class_id=1,
                class_name="erosion",
                confidence=max(0.45, round(min(0.78, conf + 0.38), 2)),
                bbox=[round(width * 0.56, 1), round(height * 0.46, 1), round(width * 0.82, 1), round(height * 0.74, 1)],
                severity=_severity_from_score(max(0.45, round(min(0.78, conf + 0.38), 2))),
            ),
        ]

        _draw_detections(image, boxes)

        image.save(output_path)
        elapsed = round(time.time() - start, 3)
        return PredictionPayload(
            filename=input_path.name,
            model_name=model_name or settings.default_model_name,
            inference_backend=self.backend_name,
            detections=boxes,
            output_image_path=output_path,
            inference_time=elapsed,
        )


class UltralyticsInferenceBackend(BaseInferenceBackend):
    backend_name = "ultralytics"

    def __init__(self) -> None:
        self.model = None
        self.loaded_model_path: Optional[Path] = None
        self.loaded_model_mtime: float = -1.0

    def _ensure_model_loaded(self) -> None:
        from ultralytics import YOLO  # lazy import

        target_path = settings.resolved_model_file_path
        if not target_path.exists():
            raise FileNotFoundError(f"Model file not found: {target_path}")

        mtime = target_path.stat().st_mtime
        should_reload = (
            self.model is None
            or self.loaded_model_path != target_path
            or self.loaded_model_mtime != mtime
        )

        if should_reload:
            self.model = YOLO(str(target_path))
            self.loaded_model_path = target_path
            self.loaded_model_mtime = mtime
            print(f"[INFO] Ultralytics model loaded: {target_path}")

    def predict(
        self,
        input_path: Path,
        output_path: Path,
        conf: float,
        iou: float,
        model_name: Optional[str],
        mode: Optional[str],
    ) -> PredictionPayload:
        self._ensure_model_loaded()
        assert self.model is not None

        start = time.time()
        results = self.model.predict(
            source=str(input_path),
            conf=conf,
            iou=iou,
            save=False,
            verbose=False,
        )
        result = results[0]
        names = result.names if getattr(result, "names", None) else self.model.names

        detections: List[DetectionItem] = []
        if result.boxes is not None:
            for box in result.boxes:
                class_id = int(box.cls[0].item())
                score = float(box.conf[0].item())
                bbox = [round(v, 1) for v in box.xyxy[0].tolist()]
                severity = _severity_from_score(score)
                detections.append(
                    DetectionItem(
                        class_id=class_id,
                        class_name=str(names[class_id]),
                        confidence=round(_clamp01(score), 4),
                        bbox=bbox,
                        severity=severity,
                    )
                )

        plotted = result.plot()
        plotted_rgb = plotted[:, :, ::-1]
        Image.fromarray(plotted_rgb).save(output_path)

        elapsed = round(time.time() - start, 3)
        return PredictionPayload(
            filename=input_path.name,
            model_name=model_name or settings.default_model_name,
            inference_backend=self.backend_name,
            detections=detections,
            output_image_path=output_path,
            inference_time=elapsed,
        )


class RoboflowInferenceBackend(BaseInferenceBackend):
    backend_name = "roboflow"

    def __init__(self, api_url: str, api_key: str, model_id: str):
        if not api_key.strip():
            raise ValueError("ROBOFLOW_API_KEY is empty")
        if not model_id.strip():
            raise ValueError("ROBOFLOW_MODEL_ID is empty")

        from inference_sdk import InferenceHTTPClient  # lazy import

        self.client = InferenceHTTPClient(api_url=api_url, api_key=api_key)
        self.model_id = model_id
        self.class_to_id: Dict[str, int] = {}

    def _class_id(self, class_name: str) -> int:
        if class_name not in self.class_to_id:
            self.class_to_id[class_name] = len(self.class_to_id)
        return self.class_to_id[class_name]

    def _to_xyxy(self, pred: dict, width: int, height: int) -> Optional[List[float]]:
        if not isinstance(pred, dict):
            return None

        if {"x", "y", "width", "height"}.issubset(pred.keys()):
            x = float(pred.get("x", 0))
            y = float(pred.get("y", 0))
            w = float(pred.get("width", 0))
            h = float(pred.get("height", 0))
            x1 = max(0.0, x - w / 2.0)
            y1 = max(0.0, y - h / 2.0)
            x2 = min(float(width), x + w / 2.0)
            y2 = min(float(height), y + h / 2.0)
            return [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]

        if {"x1", "y1", "x2", "y2"}.issubset(pred.keys()):
            x1 = max(0.0, float(pred.get("x1", 0)))
            y1 = max(0.0, float(pred.get("y1", 0)))
            x2 = min(float(width), float(pred.get("x2", 0)))
            y2 = min(float(height), float(pred.get("y2", 0)))
            return [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)]

        return None

    def predict(
        self,
        input_path: Path,
        output_path: Path,
        conf: float,
        iou: float,
        model_name: Optional[str],
        mode: Optional[str],
    ) -> PredictionPayload:
        start = time.time()

        image = Image.open(input_path).convert("RGB")
        width, height = image.size

        try:
            from inference_sdk import InferenceConfiguration

            self.client.configure(
                InferenceConfiguration(
                    confidence_threshold=float(conf),
                    iou_threshold=float(iou),
                )
            )
        except Exception:
            # Keep backward compatibility with SDK variants that don't expose configuration APIs.
            pass

        result = self.client.infer(str(input_path), model_id=self.model_id)
        predictions = result.get("predictions", []) if isinstance(result, dict) else []

        detections: List[DetectionItem] = []
        for pred in predictions:
            score = _clamp01(float(pred.get("confidence", 0.0)))
            if score < conf:
                continue

            class_name = str(pred.get("class") or pred.get("class_name") or "unknown")
            class_id_val = pred.get("class_id")
            if class_id_val is None:
                class_id = self._class_id(class_name)
            else:
                try:
                    class_id = int(class_id_val)
                except (TypeError, ValueError):
                    class_id = self._class_id(class_name)

            bbox = self._to_xyxy(pred, width, height)
            if bbox is None:
                continue

            detections.append(
                DetectionItem(
                    class_id=class_id,
                    class_name=class_name,
                    confidence=round(score, 4),
                    bbox=bbox,
                    severity=_severity_from_score(score),
                )
            )

        _draw_detections(image, detections)
        image.save(output_path)

        elapsed = round(time.time() - start, 3)
        return PredictionPayload(
            filename=input_path.name,
            model_name=model_name or settings.default_model_name,
            inference_backend=self.backend_name,
            detections=detections,
            output_image_path=output_path,
            inference_time=elapsed,
        )


class InferenceService:
    def __init__(self) -> None:
        self._backend_cache: Dict[str, BaseInferenceBackend] = {}
        self._default_backend_name = settings.model_backend

    @property
    def available_backends(self) -> List[str]:
        return ["mock", "ultralytics", "roboflow"]

    def _create_backend(self, backend_name: str) -> BaseInferenceBackend:
        if backend_name == "mock":
            return MockInferenceBackend()
        if backend_name == "ultralytics":
            return UltralyticsInferenceBackend()
        if backend_name == "roboflow":
            return RoboflowInferenceBackend(
                api_url=settings.roboflow_api_url,
                api_key=settings.roboflow_api_key,
                model_id=settings.roboflow_model_id,
            )
        raise ValueError(f"Unsupported backend: {backend_name}")

    def _get_backend(self, backend_override: Optional[str]) -> Tuple[str, BaseInferenceBackend]:
        requested = (backend_override or "").strip().lower()
        if requested in {"", "default", "auto"}:
            backend_name = self._default_backend_name
            strict = False
        else:
            backend_name = requested
            strict = True

        if backend_name not in self.available_backends:
            if strict:
                raise ValueError(f"Unknown backend: {backend_name}")
            backend_name = "mock"

        if backend_name in self._backend_cache:
            return backend_name, self._backend_cache[backend_name]

        try:
            backend = self._create_backend(backend_name)
            self._backend_cache[backend_name] = backend
            return backend_name, backend
        except Exception as exc:
            if strict:
                raise ValueError(f"Failed to initialize backend '{backend_name}': {exc}") from exc
            print(f"[WARN] Failed to initialize {backend_name} backend: {exc}. Falling back to mock backend.")
            if "mock" not in self._backend_cache:
                self._backend_cache["mock"] = MockInferenceBackend()
            return "mock", self._backend_cache["mock"]

    @property
    def backend_name(self) -> str:
        return self._default_backend_name

    @property
    def active_model_path(self) -> str:
        try:
            return str(settings.resolved_model_file_path)
        except Exception:
            return str(settings.model_file_path)

    def predict_file(
        self,
        input_path: Path,
        filename: str,
        conf: float,
        iou: float,
        model_name: Optional[str] = None,
        mode: Optional[str] = None,
        backend_override: Optional[str] = None,
    ) -> PredictResponse:
        backend_name, backend = self._get_backend(backend_override)
        task_id = uuid.uuid4().hex[:8]
        safe_filename = f"{task_id}_{filename}"
        output_path = settings.output_path / safe_filename
        payload = backend.predict(
            input_path=input_path,
            output_path=output_path,
            conf=conf,
            iou=iou,
            model_name=model_name,
            mode=mode,
        )
        return PredictResponse(
            success=True,
            task_id=task_id,
            filename=filename,
            model_name=payload.model_name,
            inference_backend=payload.inference_backend or backend_name,
            inference_time=payload.inference_time,
            num_detections=len(payload.detections),
            detections=payload.detections,
            result_image_url=f"/outputs/{payload.output_image_path.name}",
            created_at=datetime.utcnow(),
        )


inference_service = InferenceService()
