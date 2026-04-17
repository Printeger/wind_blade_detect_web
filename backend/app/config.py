from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Wind Defect Detection API"
    app_env: str = "dev"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    cors_allow_origins: str = "*"

    model_backend: str = "mock"
    model_path: str = "weights/best.pt"
    auto_update_model: bool = False
    model_search_glob: str = ""
    default_model_name: str = "baseline-yolo"

    roboflow_api_url: str = "https://serverless.roboflow.com"
    roboflow_api_key: str = ""
    roboflow_model_id: str = ""

    upload_dir: str = "data/uploads"
    output_dir: str = "data/outputs"

    max_batch_files: int = 200

    @property
    def cors_origins_list(self) -> List[str]:
        if self.cors_allow_origins.strip() == "*":
            return ["*"]
        return [item.strip() for item in self.cors_allow_origins.split(",") if item.strip()]

    @property
    def upload_path(self) -> Path:
        return BASE_DIR / self.upload_dir

    @property
    def output_path(self) -> Path:
        return BASE_DIR / self.output_dir

    @property
    def model_file_path(self) -> Path:
        return BASE_DIR / self.model_path

    @property
    def model_candidates(self) -> List[Path]:
        candidates: List[Path] = []
        direct = self.model_file_path
        if direct.exists():
            candidates.append(direct)

        if self.auto_update_model and self.model_search_glob.strip():
            for path in BASE_DIR.glob(self.model_search_glob):
                if path.is_file() and path.suffix == ".pt":
                    candidates.append(path.resolve())

        # unique + sort by mtime desc
        uniq: dict[str, Path] = {str(path): path for path in candidates}
        sorted_paths = sorted(uniq.values(), key=lambda p: p.stat().st_mtime, reverse=True)
        return sorted_paths

    @property
    def resolved_model_file_path(self) -> Path:
        candidates = self.model_candidates
        if candidates:
            return candidates[0]
        return self.model_file_path

    @field_validator("model_backend")
    @classmethod
    def validate_backend(cls, value: str) -> str:
        allowed = {"mock", "ultralytics", "roboflow"}
        if value not in allowed:
            raise ValueError(f"MODEL_BACKEND must be one of: {sorted(allowed)}")
        return value


settings = Settings()
settings.upload_path.mkdir(parents=True, exist_ok=True)
settings.output_path.mkdir(parents=True, exist_ok=True)
