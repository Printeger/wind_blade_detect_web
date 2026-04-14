from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from ..schemas import BatchTaskResult, BatchTaskSummary, PredictResponse


@dataclass
class TaskRecord:
    task_id: str
    task_name: str
    model_name: str
    created_at: datetime
    total_files: int
    status: str = "queued"
    completed_files: int = 0
    results: List[PredictResponse] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def summary(self) -> BatchTaskSummary:
        progress = round((self.completed_files / self.total_files) * 100, 2) if self.total_files else 0.0
        return BatchTaskSummary(
            task_id=self.task_id,
            task_name=self.task_name,
            status=self.status,
            total_files=self.total_files,
            completed_files=self.completed_files,
            progress=progress,
            created_at=self.created_at,
            model_name=self.model_name,
        )

    def detail(self) -> BatchTaskResult:
        return BatchTaskResult(task=self.summary(), results=self.results, errors=self.errors)


class TaskManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: Dict[str, TaskRecord] = {}

    def create_task(self, task_id: str, task_name: str, model_name: str, total_files: int) -> TaskRecord:
        record = TaskRecord(
            task_id=task_id,
            task_name=task_name,
            model_name=model_name,
            created_at=datetime.utcnow(),
            total_files=total_files,
        )
        with self._lock:
            self._tasks[task_id] = record
        return record

    def get(self, task_id: str) -> Optional[TaskRecord]:
        with self._lock:
            return self._tasks.get(task_id)

    def list(self) -> List[BatchTaskSummary]:
        with self._lock:
            tasks = list(self._tasks.values())
        tasks.sort(key=lambda item: item.created_at, reverse=True)
        return [item.summary() for item in tasks]

    def mark_running(self, task_id: str) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "running"

    def append_result(self, task_id: str, result: PredictResponse) -> None:
        with self._lock:
            record = self._tasks[task_id]
            record.results.append(result)
            record.completed_files += 1

    def append_error(self, task_id: str, error: str) -> None:
        with self._lock:
            record = self._tasks[task_id]
            record.errors.append(error)
            record.completed_files += 1

    def mark_finished(self, task_id: str) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "finished"

    def mark_failed(self, task_id: str, message: str) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "failed"
                self._tasks[task_id].errors.append(message)


task_manager = TaskManager()
