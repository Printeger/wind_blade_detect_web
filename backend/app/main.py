from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Backend API for the Wind Defect Detection Frontend (GitHub Pages + FastAPI).",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.mount("/outputs", StaticFiles(directory=str(settings.output_path)), name="outputs")
    app.include_router(router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "message": settings.app_name,
            "health": "/api/health",
            "predict": "/api/predict",
            "predict_batch": "/api/predict-batch",
            "tasks": "/api/tasks",
        }

    return app


app = create_app()
