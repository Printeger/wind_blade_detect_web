# 风机缺陷检测 Web 平台

本仓库提供一个可落地的风机缺陷检测 Web 方案，采用前后端解耦架构：

- 前端：静态站点（适配 GitHub Pages）
- 后端：FastAPI 推理服务
- 推理后端：`mock`、`ultralytics`、`roboflow`

平台覆盖单图检测、批量检测、任务查询与结果展示，适合课程项目、实验室演示、算法联调与工程化过渡。

## 主要能力

- 单张检测：`POST /api/predict`
- 批量检测（后台任务）：`POST /api/predict-batch`
- 任务列表与详情：`GET /api/tasks`、`GET /api/tasks/{task_id}`
- 服务状态检查：`GET /api/health`
- 结果图静态访问：`/outputs/...`
- 前端支持配置 `API_BASE` 与接口路径（保存在浏览器 `localStorage`）
- 请求级推理后端覆盖（`provider` 字段）

## 系统架构

```text
GitHub Pages（frontend 静态页面）
       |
       | HTTP
       v
FastAPI（/api/*）
       |
       +-- mock（演示用）
       +-- ultralytics（本地 .pt）
       +-- roboflow（托管推理）
```

## 仓库结构

```text
wind_blade_detect_web/
├── .github/workflows/
│   └── deploy-pages.yml
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── assets/
└── backend/
  ├── app.py
  ├── requirements.txt
  ├── .env.example
  ├── data/
  │   ├── uploads/
  │   └── outputs/
  ├── weights/
  └── app/
    ├── main.py
    ├── config.py
    ├── schemas.py
    ├── api/routes.py
    └── services/
      ├── inference.py
      └── task_manager.py
```

## 快速开始

### 1. 启动后端

环境要求：

- Python 3.10+

if below python 3.10, please use pyenv to create a compatible environment.
```
cd ~

sudo apt update
sudo apt install -y make build-essential libssl-dev zlib1g-dev \
  libbz2-dev libreadline-dev libsqlite3-dev curl git libncursesw5-dev \
  xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev

curl -fsSL https://pyenv.run | bash

echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc
echo '[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(pyenv init - bash)"' >> ~/.bashrc

echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.profile
echo '[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.profile
echo 'eval "$(pyenv init - bash)"' >> ~/.profile

exec "$SHELL"

pyenv install 3.10.16
pyenv local 3.10.16
python -V
```

```bash
python -m venv .venv
source .venv/bin/activate

python -V
which python

python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动后可访问：

- API 根路径：http://127.0.0.1:8000/
- 健康检查：http://127.0.0.1:8000/api/health
- Swagger 文档：http://127.0.0.1:8000/docs

### 2. 启动前端（本地预览）

```bash
cd frontend
python3 -m http.server 5173
```

浏览器打开：

- http://127.0.0.1:5173

在“接口与设置”页将 `API_BASE` 设置为：

- `http://127.0.0.1:8000`

## API 约定

### `GET /api/health`

返回服务状态与后端信息：

- `status`
- `message`
- `backend`
- `default_model_name`
- `active_model_path`
- `available_backends`

### `POST /api/predict`

请求（FormData）：

- `file`（必填）
- `conf`（默认 `0.25`）
- `iou`（默认 `0.45`）
- `model_name`
- `mode`
- `provider`（`default` | `auto` | `mock` | `ultralytics` | `roboflow`）

核心响应字段：

- `task_id`
- `filename`
- `model_name`
- `inference_backend`
- `inference_time`
- `num_detections`
- `detections[]`
- `result_image_url`
- `created_at`

### `POST /api/predict-batch`

请求（FormData）：

- `files[]`（必填）
- `task_name`
- `conf`
- `iou`
- `model_name`
- `mode`
- `provider`

返回任务摘要（`task_id`、`status`、`progress` 等）。

### `GET /api/tasks` 与 `GET /api/tasks/{task_id}`

- 查询任务列表与批量任务详情。
- 当前版本任务存储为内存态，服务重启后会清空。

## 配置说明（`backend/.env`）

关键配置项：

- `MODEL_BACKEND=mock|ultralytics|roboflow`
- `MODEL_PATH=weights/best.pt`
- `AUTO_UPDATE_MODEL=true`
- `MODEL_SEARCH_GLOB=../../runs/**/weights/best.pt`
- `CORS_ALLOW_ORIGINS=*`（生产环境请收紧）
- `ROBOFLOW_API_KEY=`
- `ROBOFLOW_MODEL_ID=`

推理模式建议：

1. `mock`：无需真实模型，适合前后端联调。
2. `ultralytics`：加载本地 `.pt`，适合本地验证与实验。
3. `roboflow`：调用托管推理服务，适合云端快速接入。

## GitHub Pages 部署（前端）

仓库内已包含自动部署工作流：

- `.github/workflows/deploy-pages.yml`

触发规则：

- `main` 分支下 `frontend/**` 发生变更
- 工作流文件自身变更
- 手动触发（`workflow_dispatch`）

部署边界：

- GitHub Pages 仅部署 `frontend/` 静态页面。
- FastAPI 后端需独立部署（云服务器、容器平台等）。

## 生产化建议

- 将 `CORS_ALLOW_ORIGINS` 设置为精确来源，不建议长期使用 `*`。
- 批量任务建议迁移到持久化队列（如 Celery/RQ + Redis）。
- 推理与任务结果建议落库（SQLite/PostgreSQL）以便审计与追溯。

## 路线图

- 任务与复核记录持久化
- 报告导出（PDF/Excel）
- 更健壮的异步任务架构
- ONNX/TensorRT 推理后端支持

## 贡献指南

欢迎提交 Issue 与 PR。建议附上：

- 复现步骤
- 预期结果与实际结果
- 环境信息（操作系统、Python 版本、后端模式）


