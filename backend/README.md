# Wind Defect FastAPI Backend Skeleton

这个后端骨架与前端页面 `web/frontend` 的接口一一对应，适合以下部署方式：

- 前端：GitHub Pages
- 后端：FastAPI
- 推理：YOLO `.pt` / 演示 mock / 后续可替换为 ONNX、TensorRT

## 已实现接口

- `GET /api/health`
- `POST /api/predict`
- `POST /api/predict-batch`
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /outputs/{filename}` 静态结果图访问

## 返回字段与前端对齐

单张检测返回：
- `task_id`
- `filename`
- `model_name`
- `inference_backend`
- `inference_time`
- `num_detections`
- `detections`
- `result_image_url`
- `created_at`

`GET /api/health` 额外返回：
- `backend`
- `default_model_name`
- `active_model_path`
- `available_backends`

## 目录结构

```text
wind_defect_backend_fastapi/
├── app.py
├── requirements.txt
├── .env.example
├── README.md
├── weights/
│   └── .gitkeep
├── data/
│   ├── uploads/
│   └── outputs/
└── app/
    ├── config.py
    ├── schemas.py
    ├── main.py
    ├── api/
    │   └── routes.py
    └── services/
        ├── inference.py
        └── task_manager.py
```

## 快速启动

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 复制配置

```bash
cp .env.example .env
```

### 3. 启动服务

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

也可以使用：

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

服务启动后：
- 根路径：`http://127.0.0.1:8000/`
- 健康检查：`http://127.0.0.1:8000/api/health`
- Swagger：`http://127.0.0.1:8000/docs`

## 与 GitHub Pages 前端联调

### `.env` 里建议设置 CORS

```env
CORS_ALLOW_ORIGINS=https://你的用户名.github.io
```

> 说明：即使 Pages 访问地址是 `https://你的用户名.github.io/仓库名/`，`CORS_ALLOW_ORIGINS` 也只填写源域名 `https://你的用户名.github.io`（不要带仓库路径）。

### 前端 `API_BASE`
在前端“接口与设置”页里填：

```text
http://127.0.0.1:8000
```

如果后端部署到服务器，就改成：

```text
https://your-api-domain.com
```

## 模型接入方式

### 方式 A：先用 mock 演示模式
`.env`:

```env
MODEL_BACKEND=mock
```

特点：
- 不依赖真实模型
- 上传图片后会返回示例框
- 适合先打通前后端联调

### 方式 B：接入 Ultralytics YOLO `.pt`
1. 把模型放到：

```text
weights/best.pt
```

2. `.env` 改成：

```env
MODEL_BACKEND=ultralytics
MODEL_PATH=weights/best.pt
AUTO_UPDATE_MODEL=true
MODEL_SEARCH_GLOB=../../runs/**/weights/best.pt
DEFAULT_MODEL_NAME=baseline-yolo
```

3. 重启服务

说明：
- 当 `AUTO_UPDATE_MODEL=true` 时，后端会在 `MODEL_PATH` 与 `MODEL_SEARCH_GLOB` 命中的候选 `.pt` 中自动选择最新修改时间的模型。
- 适合你每次新训练完成后，直接让服务自动切到最新 `best.pt`（无需手工改路径）。

如果你想直接使用当前仓库训练好的权重，也可以把 `MODEL_PATH` 指向训练产物，例如：

```env
MODEL_BACKEND=ultralytics
MODEL_PATH=../../runs/detect/runs/wind_defect_train_r2_tune/weights/best.pt
DEFAULT_MODEL_NAME=wind-defect-r2-tune
```

### 方式 C：接入 Roboflow 托管模型

`.env`:

```env
MODEL_BACKEND=roboflow
ROBOFLOW_API_URL=https://serverless.roboflow.com
ROBOFLOW_API_KEY=你的_api_key
ROBOFLOW_MODEL_ID=your-project/version
DEFAULT_MODEL_NAME=roboflow-hosted
```

依赖安装：

```bash
pip install -r requirements.txt
```

其中已包含 `inference-sdk`。

## 双后端切换

- 系统默认使用 `MODEL_BACKEND` 指定的后端。
- 你也可以在请求中通过 `provider` 覆盖本次推理后端：

`POST /api/predict` FormData:
- `file`
- `conf`
- `iou`
- `model_name`
- `mode`
- `provider` (`default` / `ultralytics` / `roboflow` / `mock`)

`POST /api/predict-batch` 也支持同样的 `provider` 字段。

## 当前批量任务实现说明

当前 `POST /api/predict-batch` 使用 FastAPI `BackgroundTasks` 做轻量异步任务，适合：
- 阶段 demo
- 小批量测试
- 前后端联调

如果后面需要更稳定的生产级任务队列，建议替换为：
- Celery + Redis
- RQ + Redis
- Dramatiq

## 推荐的后续扩展

- 增加 `POST /api/review` 保存人工复核结果
- 增加 `GET /api/tasks/{task_id}/export` 导出报告
- 增加数据库存储（SQLite / PostgreSQL）
- 将 `task_manager` 的内存存储替换为数据库
- 将 `UltralyticsInferenceBackend` 替换成 ONNXRuntime / TensorRT 推理后端

## 注意事项

1. 当前批量任务和历史任务存储在内存里，重启服务后会丢失。
2. `mock` 模式适合演示，不能作为真实算法结果。
3. GitHub Pages 只能部署前端，不能运行 FastAPI。
4. 正式部署时请收紧 `CORS_ALLOW_ORIGINS`，不要长期使用 `*`。
