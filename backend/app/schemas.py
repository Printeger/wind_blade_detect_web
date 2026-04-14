from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DetectionItem(BaseModel):
    class_id: int = 0
    class_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: List[float]
    severity: Optional[str] = None


class PredictResponse(BaseModel):
    success: bool = True
    task_id: str
    filename: str
    model_name: str
    inference_backend: Optional[str] = None
    inference_time: float
    num_detections: int
    detections: List[DetectionItem]
    result_image_url: str
    created_at: datetime


class BatchTaskSummary(BaseModel):
    task_id: str
    task_name: str
    status: str
    total_files: int
    completed_files: int
    progress: float
    created_at: datetime
    model_name: str


class BatchTaskResult(BaseModel):
    task: BatchTaskSummary
    results: List[PredictResponse]
    errors: List[str]


class HealthResponse(BaseModel):
    status: str
    message: str
    backend: str
    default_model_name: str
    active_model_path: Optional[str] = None
    available_backends: Optional[List[str]] = None
