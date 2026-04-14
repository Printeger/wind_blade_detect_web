前端结构改成更适合 GitHub Pages + FastAPI 的形式
预留并接入了可配置的接口位：
POST /api/predict
POST /api/predict-batch
GET /api/tasks/{task_id}
GET /api/health
新增了 接口与设置 页面，可以直接填写 API_BASE，并把配置保存到浏览器 localStorage
单张检测页已经写好了前端调用逻辑：
如果 FastAPI 可访问，就调用真实接口；如果没接通，就自动回退到演示数据
批量检测页也保留了任务接口位置，方便你后面接异步任务

你后面接后端时，最关键的是让 FastAPI 返回这些字段：

task_id
detections
inference_time
result_image_url

这样这个前端基本不用再改结构，只需要把真实接口接上就能跑。

和这个前端接口一一对应的 FastAPI 后端骨架在这里：
这版已经包含：

GET /api/health
POST /api/predict
POST /api/predict-batch
GET /api/tasks
GET /api/tasks/{task_id}
/outputs/... 结果图静态访问

并且接口字段和你前端已经预留的调用方式对齐，单张检测返回这些关键字段：

task_id
filename
model_name
inference_time
num_detections
detections
result_image_url
created_at

后端目录结构也已经搭好，包括：

app.py
requirements.txt
.env.example
README.md
app/config.py
app/schemas.py
app/main.py
app/api/routes.py
app/services/inference.py
app/services/task_manager.py

这版支持两种模式：

mock 演示模式
不需要真实模型，也能先把前后端联调打通。
Ultralytics YOLO .pt 模型模式
把你的模型放到 weights/best.pt，把 .env 里的 MODEL_BACKEND 改成 ultralytics 就能接真实推理。

你接下来可以这样启动：

cd wind_defect_backend_fastapi
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 8000 --reload

启动后：

健康检查：http://127.0.0.1:8000/api/health
Swagger 文档：http://127.0.0.1:8000/docs

如果你要和 GitHub Pages 前端联调，记得把 .env 里的 CORS_ALLOW_ORIGINS 改成你的 Pages 域名，或者本地联调时先用 *。

---

## GitHub Pages 部署（frontend）

本仓库已新增自动部署工作流：  
`/home/runner/work/wind_blade_detect_web/wind_blade_detect_web/.github/workflows/deploy-pages.yml`

部署边界：
- GitHub Pages 只部署 `frontend` 静态页面
- `backend` 继续独立部署（不能部署到 GitHub Pages）

自动发布规则：
- `main` 分支有 `frontend/**` 变更时自动触发
- 也支持手动触发（workflow_dispatch）
- 发布目标地址：`https://printeger.github.io/wind_blade_detect_web/`

### 仓库设置（需要在 GitHub 网页端操作）
1. 进入 `Settings` → `Pages`
2. `Build and deployment` 的 `Source` 选择 **GitHub Actions**
3. 确认仓库 Actions 权限允许工作流运行与部署 Pages

### 首次发布后检查
- 首页可访问：`https://printeger.github.io/wind_blade_detect_web/`
- 资源加载正常：
  - `styles.css`
  - `assets/polyu-logo.png`
  - `app.js`

### 前后端联调
1. 前端“接口与设置”页填入后端 `API_BASE`（例如 `https://your-api-domain.com`）
2. 后端 `.env` 设置：
   - `CORS_ALLOW_ORIGINS=https://printeger.github.io`
3. 刷新页面并执行一次单图检测，确认接口请求与页面交互正常
