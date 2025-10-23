// 引入需要的库
const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 引入文件系统模块
const path = require('path'); // 引入路径处理模块
const cors = require('cors'); // 引入cors中间件
// 引入dotenv库，用于使用.env文件中的环境变量
require('dotenv').config();

// --- 预加载并构建行政区划树 ---
const adcodeMap = new Map();
const regionTree = []; // 用于存放顶级的省份和直辖市
try {
    const csvPath = path.join(__dirname, 'adcode.csv');
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const rows = csvData.split('\n').slice(1);

    // 第一遍：将所有地区数据读入一个临时对象
    const allRegions = {};
    rows.forEach(row => {
        const columns = row.split(',');
        if (columns.length >= 2) {
            const name = columns[0].trim();
            const code = columns[1].trim();
            if (name && code) {
                adcodeMap.set(name, code);
                // 为每个地区创建一个节点，包含值、标签和子节点数组
                allRegions[code] = { value: code, label: name, children: [] };
            }
        }
    });

    // 第二遍：构建树状结构
    Object.keys(allRegions).forEach(code => {
        const region = allRegions[code];
        // 省级单位（以 "0000" 结尾，且不是 "100000" 中国）
        if (code.endsWith('0000') && code !== '100000') {
            regionTree.push(region);
        }
        // 市级单位
        else if (code.endsWith('00')) {
            const provinceCode = code.substring(0, 2) + '0000';
            if (allRegions[provinceCode]) {
                allRegions[provinceCode].children.push(region);
            }
        }
        // 区县级单位
        else {
            const cityCode = code.substring(0, 4) + '00';
            const provinceCode = code.substring(0, 2) + '0000';
            // 优先挂在市下面
            if (allRegions[cityCode] && allRegions[cityCode].children) {
                allRegions[cityCode].children.push(region);
            }
            // 兼容直辖市下的区县（例如北京市下的区）
            else if (allRegions[provinceCode] && allRegions[provinceCode].children) {
                allRegions[provinceCode].children.push(region);
            }
        }
    });

    console.log(`成功加载 ${adcodeMap.size} 条城市编码数据并构建层级树。`);
} catch (error) {
    console.error("加载或解析城市编码文件失败！", error);
    process.exit(1);
}

// 创建 express 应用实例
const app = express();
const PORT = 3000;

// 中间件配置
app.use(cors()); // 启用CORS中间件，允许所有跨域请求
app.use(express.json());

// --- 辅助函数：AI返回文本的备用解析器---
function parseAiTextFallback(text) {
    try {
        const suggestions = {
            food_recommendations: [],
            exercise_recommendations: [],
            summary: ""
        };

        const foodItemRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"reason"\s*:\s*"([^"]+)"\s*,\s*"search_keyword"\s*:\s*"([^"]+)"/g;
        const exerciseItemRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"reason"\s*:\s*"([^"]+)"/g;

        const foodMatch = text.match(/"food_recommendations"\s*:\s*\[([\s\S]*?)\]/);
        if (foodMatch && foodMatch[1]) {
            let match;
            while ((match = foodItemRegex.exec(foodMatch[1])) !== null) {
                let reason = match[2].trim();
                if (!/[。！？.?!]$/.test(reason)) {
                    reason += '。';
                }
                suggestions.food_recommendations.push({
                    name: match[1].trim(),
                    reason: reason,
                    search_keyword: match[3].trim()
                });
            }
        }

        const exerciseMatch = text.match(/"exercise_recommendations"\s*:\s*\[([\s\S]*?)\]/);
        if (exerciseMatch && exerciseMatch[1]) {
            let match;
            while ((match = exerciseItemRegex.exec(exerciseMatch[1])) !== null) {
                let reason = match[2].trim();
                if (!/[。！？.?!]$/.test(reason)) {
                    reason += '。';
                }
                suggestions.exercise_recommendations.push({ name: match[1].trim(), reason: reason });
            }
        }

        const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
        if (summaryMatch && summaryMatch[1]) {
            suggestions.summary = summaryMatch[1].trim();
        }

        if (suggestions.food_recommendations.length > 0 || suggestions.exercise_recommendations.length > 0 || suggestions.summary) {
            return suggestions;
        }

        return null;
    } catch (e) {
        console.error("执行备用文本解析时发生意外错误:", e);
        return null;
    }
}


// --- 从.env文件中安全地获取所有API密钥 ---
const juheWeightApiKey = process.env.JUHE_WEIGHT_API_KEY;
const juheCalorieApiKey = process.env.JUHE_CALORIE_API_KEY;
const amapApiKey = process.env.AMAP_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const tianxingApiKey = process.env.TIANXING_API_KEY;

// ---从.env加载代理配置 ---
const proxyProtocol = process.env.GEMINI_PROXY_PROTOCOL;
const proxyHost = process.env.GEMINI_PROXY_HOST;
const proxyPort = process.env.GEMINI_PROXY_PORT;

// --- API 接口定义 ---

app.get('/', (req, res) => {
    res.send('你好，我的健康规划师后端服务器已经启动！');
});

// 辅助接口：提供层级行政区划数据的接口
app.get('/api/regions', (req, res) => {
    const parentCode = req.query.parent;

    if (!parentCode) {
        // 如果没有parent参数，返回顶级列表（省份和直辖市）
        // 只返回前端需要的 value 和 label 字段
        res.json(regionTree.map(r => ({ value: r.value, label: r.label })));
    } else {
        // 递归查找父节点
        const findNode = (nodes, code) => {
            for (const node of nodes) {
                if (node.value === code) return node;
                // 只有当子节点数组存在且不为空时才递归
                if (node.children && node.children.length > 0) {
                    const found = findNode(node.children, code);
                    if (found) return found;
                }
            }
            return null;
        };

        const parentNode = findNode(regionTree, parentCode);

        if (parentNode && parentNode.children && parentNode.children.length > 0) {
            // 返回子节点列表，同样只包含 value 和 label
            res.json(parentNode.children.map(r => ({ value: r.value, label: r.label })));
        } else {
            res.json([]); // 如果找不到或没有子节点，返回空数组
        }
    }
});


// 接口一：生成健康方案
app.post('/api/getHealthPlan', async (req, res) => {
    console.log("收到了 /api/getHealthPlan 的请求！");
    const userData = req.body;

    if (!juheWeightApiKey || !juheCalorieApiKey || !amapApiKey || !geminiApiKey) {
        return res.status(500).json({ error: "服务器核心功能API密钥配置不完整" });
    }

    // 从前端直接接收adcode
    const adcode = userData.adcode;
    if (!adcode) {
        return res.status(400).json({ error: `adcode缺失，请确保前端已正确选择地区。` });
    }

    try {
        const [weightResponse, calorieResponse, weatherResponse] = await Promise.all([
            axios.get('http://apis.juhe.cn/fapig/calculator/weight', { params: { key: juheWeightApiKey, height: userData.height, weight: userData.weight } }),
            axios.get('http://apis.juhe.cn/fapig/healthy/calorie', { params: { key: juheCalorieApiKey, height: userData.height, weight: userData.weight, age: userData.age, level: userData.activityLevel } }),
            axios.get('https://restapi.amap.com/v3/weather/weatherInfo', { params: { key: amapApiKey, city: adcode, extensions: 'base' } })
        ]);

        const isWeightApiSuccess = weightResponse.data.error_code === 0;
        const isCalorieApiSuccess = calorieResponse.data.error_code === 0;
        const isWeatherApiSuccess = weatherResponse.data.status === '1';

        if (!isWeightApiSuccess || !isCalorieApiSuccess || !isWeatherApiSuccess) {
            const errorReport = {
                error: "外部API调用存在失败",
                details: {
                    weightApi: { success: isWeightApiSuccess, reason: weightResponse.data.reason },
                    calorieApi: { success: isCalorieApiSuccess, reason: calorieResponse.data.reason },
                    weatherApi: { success: isWeatherApiSuccess, reason: weatherResponse.data.info }
                }
            };
            return res.status(500).json(errorReport);
        }

        const weightData = weightResponse.data.result;
        const calorieData = calorieResponse.data.result;
        const weatherData = weatherResponse.data.lives && weatherResponse.data.lives[0];

        if (!weightData || !calorieData || !weatherData) {
            return res.status(500).json({ error: "未能从外部API响应中提取完整的必要数据" });
        }

        const prompt = `
你是一位专业的健康与健身教练，并且是一位精通中式健康饮食的专家。请根据我提供的以下个人健康数据和当地天气情况，为我推荐今天适合吃的3种食物和1-2种适宜的运动。

请注意：
1. 请优先推荐美味、健康、且符合中国人口味的家常菜。
2. 请尽量让推荐的菜品多样化，避免总是推荐如“鸡胸肉沙拉”、“烤三文鱼”这类常见的西式健身餐，多推荐中餐。。
3. 推荐需要充分考虑我的体重等级和天气状况。例如，如果超重，推荐低热量食物；如果天气不佳（如雨天、空气污染），推荐室内运动。
4. 为每道推荐菜额外提供一个"search_keyword"字段。这个关键词必须是这道菜里最核心的、单一的、常见的中式食材名称（例如：“排骨”），以便于后续在菜谱API中进行精确搜索。
5. 你的回答应该友好、鼓励，并简要说明推荐的理由。
6. 请严格按照下面的JSON格式返回你的建议，不要在JSON前后添加任何多余的文字、解释或markdown标记。

我的数据如下：
{
  "体重等级": "${weightData.levelMsg}",
  "BMI指数": ${weightData.bmi},
  "每日建议热量消耗": "${calorieData.range}",
  "今日天气": {
    "城市": "${weatherData.city}",
    "天气状况": "${weatherData.weather}",
    "温度": "${weatherData.temperature}°C"
  }
}

你的JSON格式回复应为：
{
  "food_recommendations": [
    {
      "name": "你推荐的第一道菜肴名称",
      "reason": "推荐这道菜的理由",
      "search_keyword": "这道菜最核心的单一食材"
    },
    {
      "name": "你推荐的第二道菜肴名称",
      "reason": "推荐这道菜的理由",
      "search_keyword": "这道菜最核心的单一食材"
    },
    {
      "name": "你推荐的第三道菜肴名称",
      "reason": "推荐这道菜的理由",
      "search_keyword": "这道菜最核心的单一食材"
    }
  ],
  "exercise_recommendations": [
    {
      "name": "你推荐的运动名称",
      "reason": "推荐这项运动的理由"
    }
  ],
  "summary": "对今天健康计划的一段总结和鼓励"
}
`;
        // --- 动态构建Gemini-Axios配置 ---
        const geminiAxiosConfig = {};
        if (proxyProtocol && proxyHost && proxyPort) {
            geminiAxiosConfig.proxy = {
                protocol: proxyProtocol,
                host: proxyHost,
                port: parseInt(proxyPort, 10) // 确保端口是数字
            };
            console.log("检测到代理配置，正在使用:", geminiAxiosConfig.proxy);
        }

        const geminiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            },
            geminiAxiosConfig // 使用动态配置，替换掉硬编码的代理
        );

        console.log("从Gemini API收到的完整响应:", JSON.stringify(geminiResponse.data, null, 2));

        if (!geminiResponse.data || !geminiResponse.data.candidates || geminiResponse.data.candidates.length === 0) {
            return res.status(500).json({ error: "AI服务返回了意外的格式" });
        }

        const aiSuggestionText = geminiResponse.data.candidates[0].content.parts[0].text;
        let aiSuggestions;
        try {
            aiSuggestions = JSON.parse(aiSuggestionText);
        } catch (parseError) {
            aiSuggestions = parseAiTextFallback(aiSuggestionText);
            if (!aiSuggestions) {
                return res.status(500).json({ error: "AI返回的数据格式无法恢复" });
            }
        }

        const finalResponse = {
            baseInfo: {
                weightInfo: { bmi: weightData.bmi, levelMessage: weightData.levelMsg },
                calorieInfo: { dailyCalorieRange: calorieData.range },
                weatherInfo: { weather: weatherData.weather, temperature: weatherData.temperature }
            },
            aiCoach: aiSuggestions
        };
        res.json(finalResponse);

    } catch (error) {
        console.error("--- 捕获到 /api/getHealthPlan 中的错误 ---");
        console.error(error);
        let errorDetails = "未知服务器错误";
        if (error.response) {
            errorDetails = error.response.data;
        } else if (error.message) {
            errorDetails = error.message;
        }
        res.status(500).json({ error: "处理请求失败", details: errorDetails });
    }
});

// 接口二：根据食物名称查询菜谱
app.get('/api/recipe', async (req, res) => {
    const foodName = req.query.word;
    if (!tianxingApiKey) { return res.status(500).json({ error: "服务器天行数据API密钥未配置" }); }
    if (!foodName) { return res.status(400).json({ error: "缺少'word'参数" }); }

    try {
        const response = await axios.get('https://apis.tianapi.com/caipu/index', {
            params: { key: tianxingApiKey, word: foodName, num: 5 }
        });

        if (response.data.code === 200) {
            res.json(response.data.result.list);
        } else {
            res.status(500).json({ error: "查询菜谱失败", details: response.data.msg });
        }
    } catch (error) {
        res.status(500).json({ error: "调用外部API失败", details: error.message });
    }
});

// 接口三：获取一条随机健康小妙招
app.get('/api/healthtip', async (req, res) => {
    if (!tianxingApiKey) { return res.status(500).json({ error: "服务器天行数据API密钥未配置" }); }

    try {
        const healthKeywords = ['失眠', '感冒', '咳嗽', '胃痛', '便秘'];
        const randomKeyword = healthKeywords[Math.floor(Math.random() * healthKeywords.length)];

        const response = await axios.get('https://apis.tianapi.com/healthskill/index', {
            params: { key: tianxingApiKey, word: randomKeyword }
        });

        if (response.data.code === 200 && response.data.result.list.length > 0) {
            const tips = response.data.result.list;
            const randomTip = tips[Math.floor(Math.random() * tips.length)];
            const responseData = {
                keyword: randomKeyword,
                content: randomTip.content
            };
            res.json(responseData);
        } else {
            const reason = response.data.msg || "未找到相关小妙招";
            res.status(500).json({ error: "获取健康小妙招失败", details: reason });
        }
    } catch (error) {
        res.status(500).json({ error: "调用外部API失败", details: error.message });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器正在 http://localhost:${PORT} 上运行`);
});