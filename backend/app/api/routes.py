from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from ..config import settings
from ..schemas import BatchTaskResult, BatchTaskSummary, HealthResponse, PredictResponse
from ..services.inference import inference_service
from ..services.task_manager import task_manager

router = APIRouter(prefix="/api", tags=["wind-defect-api"])

SUPPORTED_PROVIDER_VALUES = {"default", "auto", "mock", "ultralytics", "roboflow"}


def _normalize_provider(provider: Optional[str]) -> Optional[str]:
    if provider is None:
        return None
    normalized = provider.strip().lower()
    if not normalized:
        return None
    if normalized not in SUPPORTED_PROVIDER_VALUES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported provider: {provider}. Allowed values: {sorted(SUPPORTED_PROVIDER_VALUES)}",
        )
    return normalized


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        message="FastAPI service is running.",
        backend=inference_service.backend_name,
        default_model_name=settings.default_model_name,
        active_model_path=inference_service.active_model_path,
        available_backends=inference_service.available_backends,
    )


@router.post("/predict", response_model=PredictResponse)
async def predict(
    file: UploadFile = File(...),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    model_name: str = Form(settings.default_model_name),
    mode: str = Form("standard"),
    provider: Optional[str] = Form(None),
) -> PredictResponse:
    provider = _normalize_provider(provider)
    filename = file.filename or f"upload_{uuid.uuid4().hex[:8]}.jpg"
    input_path = settings.upload_path / f"{uuid.uuid4().hex[:8]}_{filename}"
    with input_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        return inference_service.predict_file(
            input_path=input_path,
            filename=filename,
            conf=conf,
            iou=iou,
            model_name=model_name,
            mode=mode,
            backend_override=provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _run_batch_task(
    task_id: str,
    saved_files: List[tuple[Path, str]],
    conf: float,
    iou: float,
    model_name: str,
    mode: str,
    provider: Optional[str],
) -> None:
    task_manager.mark_running(task_id)
    try:
        for input_path, original_name in saved_files:
            try:
                result = inference_service.predict_file(
                    input_path=input_path,
                    filename=original_name,
                    conf=conf,
                    iou=iou,
                    model_name=model_name,
                    mode=mode,
                    backend_override=provider,
                )
                task_manager.append_result(task_id, result)
            except Exception as exc:
                task_manager.append_error(task_id, f"{original_name}: {exc}")
        task_manager.mark_finished(task_id)
    except Exception as exc:
        task_manager.mark_failed(task_id, str(exc))


@router.post("/predict-batch", response_model=BatchTaskSummary)
async def predict_batch(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    task_name: str = Form("风机缺陷批量检测任务"),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    model_name: str = Form(settings.default_model_name),
    mode: str = Form("standard"),
    provider: Optional[str] = Form(None),
) -> BatchTaskSummary:
    provider = _normalize_provider(provider)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")
    if len(files) > settings.max_batch_files:
        raise HTTPException(status_code=400, detail=f"Too many files. Max allowed: {settings.max_batch_files}")

    task_id = uuid.uuid4().hex[:10]
    record = task_manager.create_task(
        task_id=task_id,
        task_name=task_name,
        model_name=model_name,
        total_files=len(files),
    )

    saved_files: List[tuple[Path, str]] = []
    for file in files:
        original_name = file.filename or f"upload_{uuid.uuid4().hex[:8]}.jpg"
        input_path = settings.upload_path / f"{task_id}_{uuid.uuid4().hex[:6]}_{original_name}"
        with input_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append((input_path, original_name))

    background_tasks.add_task(_run_batch_task, task_id, saved_files, conf, iou, model_name, mode, provider)
    return record.summary()


@router.get("/tasks", response_model=List[BatchTaskSummary])
def list_tasks() -> List[BatchTaskSummary]:
    return task_manager.list()


@router.get("/tasks/{task_id}", response_model=BatchTaskResult)
def task_detail(task_id: str) -> BatchTaskResult:
    task = task_manager.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task.detail()
