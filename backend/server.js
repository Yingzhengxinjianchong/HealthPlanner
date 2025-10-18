// 引入需要的库
const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 引入文件系统模块
const path = require('path'); // 引入路径处理模块
// 引入dotenv库，让我们可以使用.env文件中的环境变量
require('dotenv').config(); 

// --- 预加载城市编码数据 ---
const adcodeMap = new Map();
try {
    const csvPath = path.join(__dirname, 'adcode.csv');
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const rows = csvData.split('\n').slice(1);
    rows.forEach(row => {
        const columns = row.split(',');
        if (columns.length >= 2) {
            const cityName = columns[0].trim();
            const adcode = columns[1].trim();
            if (cityName && adcode) {
                adcodeMap.set(cityName, adcode);
            }
        }
    });
    console.log(`成功加载 ${adcodeMap.size} 条城市编码数据。`);
} catch (error) {
    console.error("加载城市编码文件失败！请确保 'adcode.csv' 文件存在于backend文件夹中。", error);
    process.exit(1);
}

// 创建 express 应用实例
const app = express();
const PORT = 3000;

// 中间件配置
app.use(express.json());

// --- 辅助函数：AI返回文本的备用解析器 ---
function parseAiTextFallback(text) {
    try {
        const suggestions = {
            food_recommendations: [],
            exercise_recommendations: [],
            summary: ""
        };

        // 提取 "name", "reason", 和 "search_keyword" 的通用正则表达式
        const foodItemRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"reason"\s*:\s*"([^"]+)"\s*,\s*"search_keyword"\s*:\s*"([^"]+)"/g;
        // 提取运动的正则表达式（没有search_keyword）
        const exerciseItemRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"reason"\s*:\s*"([^"]+)"/g;

        // 提取食物推荐部分
        const foodMatch = text.match(/"food_recommendations"\s*:\s*\[([\s\S]*?)\]/);
        if (foodMatch && foodMatch[1]) {
            let match;
            while ((match = foodItemRegex.exec(foodMatch[1])) !== null) {
                let reason = match[2].trim();
                // 确保理由以句号结尾
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

        // 提取运动推荐部分
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

        // 提取总结部分
        const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);
        if (summaryMatch && summaryMatch[1]) {
            suggestions.summary = summaryMatch[1].trim();
        }

        // 如果成功提取到任何数据，就返回结果
        if (suggestions.food_recommendations.length > 0 || suggestions.exercise_recommendations.length > 0 || suggestions.summary) {
            return suggestions;
        }

        return null; // 如果什么都没提取到，返回null
    } catch (e) {
        console.error("执行备用文本解析时发生意外错误:", e);
        return null; // 确保函数在任何情况下都不会崩溃
    }
}


// --- 从.env文件中安全地获取所有API密钥 ---
const juheWeightApiKey = process.env.JUHE_WEIGHT_API_KEY;
const juheCalorieApiKey = process.env.JUHE_CALORIE_API_KEY;
const amapApiKey = process.env.AMAP_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const tianxingApiKey = process.env.TIANXING_API_KEY; // 新增：天行数据密钥

// --- API 接口定义 ---

app.get('/', (req, res) => {
    res.send('你好，我的健康规划师后端服务器已经启动！');
});

// 接口一：核心功能 - 生成健康方案
app.post('/api/getHealthPlan', async (req, res) => {
    console.log("收到了 /api/getHealthPlan 的请求！");
    const userData = req.body;

    // 检查所需密钥
    if (!juheWeightApiKey || !juheCalorieApiKey || !amapApiKey || !geminiApiKey) {
        return res.status(500).json({ error: "服务器核心功能API密钥配置不完整" });
    }
    
    const adcode = adcodeMap.get(userData.city);
    if (!adcode) {
        return res.status(400).json({ error: `无法找到地区 "${userData.city}" 的编码。` });
    }

    try {
        // --- 第一阶段：并行获取基础数据 ---
        const [weightResponse, calorieResponse, weatherResponse] = await Promise.all([
            axios.get('http://apis.juhe.cn/fapig/calculator/weight', { params: { key: juheWeightApiKey, height: userData.height, weight: userData.weight } }),
            axios.get('http://apis.juhe.cn/fapig/healthy/calorie', { params: { key: juheCalorieApiKey, height: userData.height, weight: userData.weight, age: userData.age, level: userData.activityLevel } }),
            axios.get('https://restapi.amap.com/v3/weather/weatherInfo', { params: { key: amapApiKey, city: adcode, extensions: 'base' } })
        ]);

        // --- 检查基础数据API调用是否成功 ---
        const isWeightApiSuccess = weightResponse.data.error_code === 0;
        const isCalorieApiSuccess = calorieResponse.data.error_code === 0;
        const isWeatherApiSuccess = weatherResponse.data.status === '1';

        if (!isWeightApiSuccess || !isCalorieApiSuccess || !isWeatherApiSuccess) {
            console.error("一个或多个外部API返回错误");
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
        
        // --- 数据有效性检查 ---
        const weightData = weightResponse.data.result;
        const calorieData = calorieResponse.data.result;
        const weatherData = weatherResponse.data.lives && weatherResponse.data.lives[0];

        if (!weightData || !calorieData || !weatherData) {
            console.error("基础数据提取失败:", {
                weightDataFound: !!weightData,
                calorieDataFound: !!calorieData,
                weatherDataFound: !!weatherData,
            });
            return res.status(500).json({ error: "未能从外部API响应中提取完整的必要数据" });
        }


        // --- 第二阶段：调用AI大脑进行智能分析 ---
        const prompt = `
你是一位专业的健康与健身教练。请根据我提供的以下个人健康数据和当地天气情况，为我推荐今天适合吃的3种食物和1-2种适宜的运动。

请注意：
1. 推荐需要充分考虑我的体重等级和天气状况。例如，如果超重，推荐低热量食物；如果天气不佳（如雨天、空气污染），推荐室内运动。
2. 你的回答应该友好、鼓励，并简要说明推荐的理由。
3. 为每道推荐菜额外提供一个"search_keyword"字段。这个关键词必须是这道菜里最核心的、单一的、常见的食材名称（例如："鸡胸肉"、"三文鱼"、"西兰花"、"豆腐"），以便于后续在菜谱API中进行精确搜索。请不要使用复合词或菜系名。
4. 请严格按照下面的JSON格式返回你的建议，不要在JSON前后添加任何多余的文字、解释或markdown标记。

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
      "search_keyword": "这道菜最核心的单一食材（如果是鸡胸，就回复‘鸡胸’，不要写‘鸡胸肉’）"
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
        const geminiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            },
            // 为axios请求配置代理以解决连接超时问题 +++
            {
                proxy: {
                    protocol: 'http',
                    host: '127.0.0.1',
                    port: 7897,
                }
            }
        );
        
        // --- 更智能的日志和预检查 ---
        console.log("从Gemini API收到的完整响应:", JSON.stringify(geminiResponse.data, null, 2));

        if (!geminiResponse.data || !geminiResponse.data.candidates || geminiResponse.data.candidates.length === 0) {
            console.error("Gemini API的响应格式不正确，缺少'candidates'。");
            return res.status(500).json({
                error: "AI服务返回了意外的格式",
                details: "未能从Google Gemini API获取有效的候选回复，请检查API密钥或服务状态。"
            });
        }
        
        // --- 健壮的JSON解析与错误处理 ---
        const aiSuggestionText = geminiResponse.data.candidates[0].content.parts[0].text;
        let aiSuggestions;
        try {
            // 尝试直接解析JSON
            aiSuggestions = JSON.parse(aiSuggestionText);
        } catch (parseError) {
            console.error("A计划失败：无法将AI响应解析为JSON。", parseError);
            console.warn("AI返回的原始文本:", aiSuggestionText);
            
            // 如果失败，启动备用文本解析器
            console.log("启动B计划：尝试进行手动文本解析...");
            aiSuggestions = parseAiTextFallback(aiSuggestionText);

            if (!aiSuggestions) {
                // 如果也失败，则最终放弃
                console.error("B计划失败：手动文本解析也无法提取有效数据。");
                return res.status(500).json({ 
                    error: "AI返回的数据格式无法恢复", 
                    details: "AI模型没有返回有效的JSON，并且备用解析器也无法提取信息。请稍后重试。"
                });
            }
            console.log("B计划成功：已通过手动解析抢救出数据:", aiSuggestions);
        }

        // --- 第三阶段：整合所有数据并返回 ---
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
        // --- 详细的错误日志 ---
        console.error("--- 捕获到 /api/getHealthPlan 中的错误 ---");
        // 打印完整的错误对象，包括堆栈跟踪(stack trace)
        console.error(error); 
        
        // 尝试从不同的错误类型中提取有用的信息返回给前端
        let errorDetails = "未知服务器错误";
        if (error.response) { // 这是 Axios 的 HTTP 错误
            errorDetails = error.response.data;
        } else if (error.message) { // 这是普通的 JavaScript 错误
            errorDetails = error.message;
        }
    
        res.status(500).json({ error: "处理请求失败", details: errorDetails });
    }
});

// 接口二：根据食物名称查询菜谱
app.get('/api/recipe', async (req, res) => {
    // 从URL的查询参数中获取食物名称，例如: /api/recipe?word=西兰花
    const foodName = req.query.word;
    console.log(`收到了查询菜谱的请求，关键词: ${foodName}`);

    // 检查密钥和参数
    if (!tianxingApiKey) {
        return res.status(500).json({ error: "服务器天行数据API密钥未配置" });
    }
    if (!foodName) {
        return res.status(400).json({ error: "缺少'word'参数，请提供要查询的食物名称" });
    }

    try {
        const response = await axios.get('https://apis.tianapi.com/caipu/index', {
            params: {
                key: tianxingApiKey,
                word: foodName,
                num: 5 // 我们设定最多返回5条相关的菜谱
            }
        });

        // 天行数据API成功的标志是 code 为 200
        if (response.data.code === 200) {
            console.log(`成功查询到关于“${foodName}”的 ${response.data.result.list.length} 条菜谱`);
            res.json(response.data.result.list); // 直接返回菜谱列表
        } else {
            // 如果API返回错误，将错误信息返回给前端
            console.error("天行数据菜谱API返回错误:", response.data.msg);
            res.status(500).json({ error: "查询菜谱失败", details: response.data.msg });
        }
    } catch (error) {
        console.error("调用天行数据菜谱API时发生网络或代码错误:", error.message);
        res.status(500).json({ error: "调用外部API失败", details: error.message });
    }
});

// 接口三：获取一条随机健康小妙招
app.get('/api/healthtip', async (req, res) => {
    console.log("收到了获取健康小妙招的请求！");

    if (!tianxingApiKey) {
        return res.status(500).json({ error: "服务器天行数据API密钥未配置" });
    }

    try {
        // 为了满足API要求并实现随机性，我们从一个预设的有效关键词列表中随机选择一个
        const healthKeywords = ['失眠', '感冒', '咳嗽', '胃痛', '便秘','头晕','发烧'];
        const randomKeyword = healthKeywords[Math.floor(Math.random() * healthKeywords.length)];
        console.log(`本次随机查询的健康关键词: ${randomKeyword}`);

        const response = await axios.get('https://apis.tianapi.com/healthskill/index', {
            params: {
                key: tianxingApiKey,
                word: randomKeyword,
            }
        });
        
        if (response.data.code === 200 && response.data.result.list.length > 0) {
            // 从返回的列表中随机选择一条
            const tips = response.data.result.list;
            const randomTip = tips[Math.floor(Math.random() * tips.length)];
            console.log("成功获取一条随机小妙招:", randomTip.content);
            res.json(randomTip);
        } else {
            // 如果API返回错误或列表为空
            const reason = response.data.msg || "未找到相关小妙招";
            console.error("天行数据健康小妙招API返回错误:", reason);
            res.status(500).json({ error: "获取健康小妙招失败", details: reason });
        }
    } catch (error) {
        console.error("调用天行数据健康小妙招API时发生网络或代码错误:", error.message);
        res.status(500).json({ error: "调用外部API失败", details: error.message });
    }
});


// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器正在 http://localhost:${PORT} 上运行`);
});