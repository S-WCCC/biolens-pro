// 这是一个运行在 Vercel 云端的后端代码
// 只有在这里才能安全地调用通义千问/OpenAI

export default async function handler(req, res) {
  // 1. 获取前端发来的用户指令
  const { message } = req.body;

  // 2. 调用通义千问 API (以阿里云 DashScope 为例)
  // 你需要去阿里云申请一个 API KEY
  const apiKey = process.env.DASHSCOPE_API_KEY; 

  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen-turbo', // 使用通义千问 Turbo 模型
      input: {
        messages: [
          {
            role: "system",
            content: "你是一个 PDB 可视化助手。请把用户指令转换为 JSON。只输出 JSON。..." // 把上面的 Prompt 放这里
          },
          {
            role: "user",
            content: message
          }
        ]
      }
    })
  });

  const data = await response.json();
  
  // 3. 把 AI 生成的 JSON 发回给前端
  // 假设通义千问返回的结构在 output.text 里
  res.status(200).json({ result: data.output.text });
}
```

#### 第三步：修改前端 `App.jsx` 去调用这个 API

在 `App.jsx` 的 `handleAiSubmit` 函数里，把现在的模拟逻辑替换成真实的请求：

```javascript
// 在 src/App.jsx 中

const handleAiSubmit = async (e) => {
  e.preventDefault();
  // ...省略 UI 更新代码...

  // 真实请求后端
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: aiInput }) // 发送用户说的话
    });
    
    const data = await res.json();
    const command = JSON.parse(data.result); // 解析 AI 返回的 JSON

    // 执行指令
    if (command.action === 'color') {
       setCustomColor(command.params);
    } else if (command.action === 'spin') {
       toggleSpin();
    }
    // ... 更多逻辑
    
  } catch (err) {
    console.error("AI 没听懂:", err);
  }
};
