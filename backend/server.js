// 1. 引入需要的库
const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 引入文件系统模块
const path = require('path'); // 引入路径处理模块
// 引入dotenv库，让我们可以使用.env文件中的环境变量
require('dotenv').config(); 

// --- 预加载城市编码数据 ---
// 创建一个Map来存储城市名到adcode的映射，查询效率高
const adcodeMap = new Map();
try {
    // 服务器启动时，同步读取CSV文件内容
    // 请确保 adcode.csv 文件在 backend 文件夹中
    const csvPath = path.join(__dirname, 'adcode.csv');
    const csvData = fs.readFileSync(csvPath, 'utf8');
    
    // 按行分割数据，并跳过表头
    const rows = csvData.split('\n').slice(1);
    rows.forEach(row => {
        // 按逗号分割每一行的数据
        const columns = row.split(',');
        if (columns.length >= 2) {
            const cityName = columns[0].trim(); // 中文名
            const adcode = columns[1].trim();   // adcode
            if (cityName && adcode) {
                adcodeMap.set(cityName, adcode);
            }
        }
    });
    console.log(`成功加载 ${adcodeMap.size} 条城市编码数据。`);
} catch (error) {
    console.error("加载城市编码文件失败！请确保 'adcode.csv' 文件存在于backend文件夹中。", error);
    process.exit(1); // 如果文件加载失败，则终止服务启动
}

// 2. 创建 express 应用实例
const app = express();
const PORT = 3000;

// 3. 中间件配置
app.use(express.json()); // 解析JSON请求体

// --- 从.env文件中安全地获取API密钥 ---
const juheWeightApiKey = process.env.JUHE_WEIGHT_API_KEY;
const juheCalorieApiKey = process.env.JUHE_CALORIE_API_KEY;
const amapApiKey = process.env.AMAP_API_KEY; // 获取高德API密钥

// --- API 接口定义 ---

app.get('/', (req, res) => {
    res.send('你好，我的健康规划师后端服务器已经启动！');
});

// 定义核心API接口
app.post('/api/getHealthPlan', async (req, res) => { // 将函数改为异步(async)
    console.log("收到了请求！");
    const userData = req.body;
    console.log("收到的用户数据:", userData);

    // 检查所有API密钥是否都已配置
    if (!juheWeightApiKey || !juheCalorieApiKey || !amapApiKey) {
        return res.status(500).json({ error: "服务器API密钥配置不完整" });
    }

    // --- 城市名转adcode (已更新) ---
    // 新的逻辑：直接、精确地查找前端发送的城市/区域名称
    const adcode = adcodeMap.get(userData.city);
    
    // 如果无法直接找到编码，返回明确的错误
    if (!adcode) {
        return res.status(400).json({ 
            error: `无法找到地区 "${userData.city}" 的编码。请确保前端发送的是一个有效且完整的市级或区县级名称。` 
        });
    }

    try {
        // --- 并行调用三个API ---
        const [weightResponse, calorieResponse, weatherResponse] = await Promise.all([
            // (1) 调用“标准体重计算”API
            axios.get('http://apis.juhe.cn/fapig/calculator/weight', {
                params: { key: juheWeightApiKey, height: userData.height, weight: userData.weight }
            }),
            // (2) 调用“每日热量/卡里路消耗”API
            axios.get('http://apis.juhe.cn/fapig/healthy/calorie', {
                params: { key: juheCalorieApiKey, height: userData.height, weight: userData.weight, age: userData.age, level: userData.activityLevel }
            }),
            // (3) 调用高德天气查询API
            axios.get('https://restapi.amap.com/v3/weather/weatherInfo', {
                params: {
                    key: amapApiKey, // 使用高德的密钥
                    city: adcode,    // 使用转换后的adcode
                    extensions: 'base' // 获取实时天气
                }
            })
        ]);

        // --- 数据处理与整合 ---
        const isWeightApiSuccess = weightResponse.data.error_code === 0;
        const isCalorieApiSuccess = calorieResponse.data.error_code === 0;
        const isWeatherApiSuccess = weatherResponse.data.status === '1'; // 高德API成功的标志是status为'1'

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
        
        const weightData = weightResponse.data.result;
        const calorieData = calorieResponse.data.result;
        const weatherData = weatherResponse.data.lives[0]; // 实时天气信息在lives数组的第一个元素

        const combinedResult = {
            weightInfo: {
                bmi: weightData.bmi,
                levelMessage: weightData.levelMsg,
                idealWeight: weightData.idealWeight,
                normalWeightRange: weightData.normalWeight
            },
            calorieInfo: {
                dailyCalorieRange: calorieData.range 
            },
            weatherInfo: {
                weather: weatherData.weather,
                temperature: weatherData.temperature,
                humidity: weatherData.humidity,
                windDirection: weatherData.winddirection,
                windPower: weatherData.windpower
            }
        };

        console.log("成功调用外部API并整合数据:", combinedResult);
        res.json(combinedResult);

    } catch (error) {
        console.error("调用外部API时发生网络或代码错误:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "调用外部API失败", details: error.message });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器正在 http://localhost:${PORT} 上运行`);
});