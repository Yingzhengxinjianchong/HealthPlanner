# 个性化智能健康顾问 (Personalized Health Planner)

## 一、项目简介

本项目是一个基于Web API混搭（Mashup）技术开发的个性化健康方案生成应用。

用户只需输入身高、体重、年龄、所在地区和日常运动量等基本信息，应用即可通过后端服务器整合多个第三方API，动态生成一份包含饮食建议、运动推荐和健康小妙招的专属日度健康计划。

项目的核心亮点在于利用大语言模型（LLM）作为“AI教练”，将从不同API获取的结构化数据（如BMI指数、天气状况等）转化为富有人情味和创造性的个性化建议，为用户提供超越传统数据查询的智能体验。

## 二、主要功能

**个性化数据输入**：接收用户的身高、体重、年龄、地理位置（三级联动选择）和运动习惯。

**多API数据融合**：后端服务器实时调用4个不同的API服务，获取健康指标、天气、菜谱等多元化信息。

**AI教练智能建议**：集成Google Gemini Pro，根据用户的综合数据，生成符合中式饮食习惯的、多样化的每日饮食与运动方案。

**菜谱即时查询**：用户可直接点击AI推荐的菜品，应用会弹出模态窗口，展示从API获取的多份类似的相关菜谱做法。

**每日健康小妙招**：每次生成方案时，都会随机展示一条与特定健康主题（如失眠、咳嗽等）相关的实用小贴士，并明确告知其主题。

**响应式前端界面**：简洁美观的单页应用界面，适配桌面和移动端设备。

## 三、技术架构

**前端**：使用原生HTML、CSS和JavaScript，并借助Tailwind CSS框架构建美观的响应式用户界面。

**后端**：基于Node.js和Express.js框架，负责处理前端请求、调用外部API、整合数据以及向AI模型发送指令。

**数据格式**：前后端之间以及与外部API之间主要使用JSON格式进行数据交换。

**核心理念**：典型的Mashup应用架构，将不同来源的数据和服务“混搭”在一起，创造出新的价值。

## 四、使用的API服务

本项目整合了来自4个不同提供商的6个API：

1. **聚合数据(Juhe)**
   `标准体重计算`用于根据身高体重计算BMI指数；
   `每日热量/卡路里消耗`根据年龄和运动量计算每日建议摄入热量。

2. **高德开放平台(Amap)**
   `天气预报`根据用户选择的地区编码，获取当地的实时天气信息。

3. **Google AI Studio**
   `Gemini 2.5 Flash`作为应用的大脑，接收所有处理过的数据，并根据精心设计的Prompt生成个性化的健康建议。

4. **天行数据(Tianxing)**:
   `菜谱查询`为用户提供某种食物相关的多种菜谱；
   `健康小妙招`为用户提供一条随机主题的健康相关小知识。

## 五、配置与部署指南

请按照以下步骤来运行本项目。

### 1. 准备工作

安装`Node.js`(推荐LTS版本)。

安装`Visual Studio Code`或其他代码编辑器。

在VS Code中安装`Live Server`插件，用于快速启动前端页面。

### 2. 后端配置

**配置方法：**
打开终端，依次运行以下命令：
```bash
cd backend # 打开终端，进入 backend 目录
npm install # 该命令会自动读取`package.json`文件并安装所有项目必需的库
```

**主要依赖的NPM库：**

express: 用于快速搭建后端HTTP服务器。

axios: 用于向第三方API发送HTTP请求。

cors: 用于处理跨域资源共享（CORS）问题。

dotenv: 用于从 .env 文件中加载环境变量（API密钥）。

**配置API密钥和代理设置**
在 backend 目录下，手动创建一个名为 .env 的文件。该文件用于存放所有API的密钥，不会被上传到Git。
打开`.env`文件，并按照以下格式填入你申请的API密钥和代理设置：

```bash
# 聚合数据 API Key
JUHE_WEIGHT_API_KEY=你的标准体重计算API_KEY
JUHE_CALORIE_API_KEY=你的每日热量/卡路里消耗API_KEY

# 高德开放平台 API Key
AMAP_API_KEY=你的高德地图API_KEY

# Google AI Gemini API Key
GEMINI_API_KEY=你的Gemini_API_KEY

# 天行数据 API Key
TIANXING_API_KEY=你的天行数据API_KEY（全平台API统一使用）

# 代理配置
GEMINI_PROXY_PROTOCOL=你使用的协议
GEMINI_PROXY_HOST=代理的IP地址
GEMINI_PROXY_PORT=代理的端口
```

### 3. 项目启动

**后端启动方法:**
在 backend 目录下，运行以下命令：
```bash
node server.js
```

当你看到终端输出`服务器正在 http://localhost:3000 上运行`时，表示后端已成功启动。

注意：如果你在访问Google Gemini API时遇到网络问题，请确保你的服务器环境可以访问Google服务，或参照`server.js`中的`axios`请求部分自行配置代理。

**前端启动方法：**

打开项目：在`VS Code`中打开整个项目文件夹。

启动页面：在`frontend`文件夹中找到`index.html`文件，在文件上右键，选择`Open with Live Server`。

开始使用：`Live Server`会自动在你的浏览器中打开页面（地址通常是 http://127.0.0.1:5500/frontend/index.html ），随即使用即可。

## 六、Prompt设计

本项目的一个核心是与大语言模型（LLM）的交互，详细的Prompt内容可以在 backend/server.js 文件中的 prompt 变量处查看。