import fs from "node:fs";
import path from "node:path";

type DigestJson = {
    title: string;
    date: string;
    highlights: string[];
    mustRead: Array<{
        title: string;
        summary: string;
        reason: string;
        url?: string;
    }>;
    categories: Array<{
        name: string;
        items: Array<{
            title: string;
            summary: string;
            url?: string;
        }>;
    }>;
    overview?: string;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
}

// 你可以把这里替换成 ai-daily-digest 实际生成的原始内容来源
const inputFile = path.resolve("./output/digest.md");
if (!fs.existsSync(inputFile)) {
    throw new Error("output/digest.md not found");
}

const rawContent = fs.readFileSync(inputFile, "utf8");

const prompt = `
你是一个中文 AI 行业日报编辑。

请把下面的日报内容，整理成“适合 Lark 群机器人发送”的结构化 JSON。

强制要求：
1. 所有字段内容必须使用简体中文
2. 不要输出 Markdown
3. 不要输出解释
4. 不要输出代码块
5. 只输出合法 JSON
6. JSON 结构必须严格符合下面格式：

{
  "title": "每日 AI 摘要",
  "date": "YYYY-MM-DD",
  "highlights": ["重点1", "重点2", "重点3"],
  "mustRead": [
    {
      "title": "标题",
      "summary": "摘要",
      "reason": "推荐理由",
      "url": "可选，原文链接"
    }
  ],
  "categories": [
    {
      "name": "分类名称",
      "items": [
        {
          "title": "标题",
          "summary": "一句话摘要",
          "url": "可选，原文链接"
        }
      ]
    }
  ],
  "overview": "整体概览，可选"
}

附加要求：
- highlights 控制在 3 条
- mustRead 控制在 3 到 5 条
- categories 保留主要分类即可
- 每条 summary 尽量 40 到 80 字
- 如果原文中有链接，尽量保留到 url 字段
- title 固定写“每日 AI 摘要”

下面是原始日报内容：

${rawContent}
`.trim();

async function callGemini(promptText: string): Promise<string> {
    const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

    const resp = await fetch(`${endpoint}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text: promptText
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json"
            }
        })
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gemini request failed: ${resp.status} ${err}`);
    }

    const data = await resp.json();
    const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error("Gemini returned empty content");
    }

    return text;
}

function safeParseJson(text: string): DigestJson {
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`Failed to parse Gemini JSON: ${text}`);
    }
}

async function main() {
    const outputText = await callGemini(prompt);
    const digest = safeParseJson(outputText);

    // 基础兜底
    digest.title = digest.title || "每日 AI 摘要";
    digest.date = digest.date || new Date().toISOString().slice(0, 10);
    digest.highlights = Array.isArray(digest.highlights) ? digest.highlights : [];
    digest.mustRead = Array.isArray(digest.mustRead) ? digest.mustRead : [];
    digest.categories = Array.isArray(digest.categories) ? digest.categories : [];

    fs.mkdirSync("./output", { recursive: true });
    fs.writeFileSync("./output/digest.json", JSON.stringify(digest, null, 2), "utf8");

    console.log("Generated output/digest.json");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});