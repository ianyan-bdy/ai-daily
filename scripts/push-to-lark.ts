import fs from "node:fs";

const webhook = process.env.LARK_WEBHOOK;
if (!webhook) {
    throw new Error("Missing LARK_WEBHOOK");
}

const file = "./digest.md";
if (!fs.existsSync(file)) {
    throw new Error("digest.md not found");
}

const markdown = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

type SectionMap = {
    todayHighlights?: string;
    mustRead?: string;
    overview?: string;
    categorized?: string;
};

function findSectionTitleIndex(md: string, title: string): number {
    const patterns = [
        new RegExp(`^#\\s+${escapeRegExp(title)}\\s*$`, "m"),
        new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "m"),
        new RegExp(`^###\\s+${escapeRegExp(title)}\\s*$`, "m"),
    ];

    for (const p of patterns) {
        const m = md.match(p);
        if (m && m.index !== undefined) return m.index;
    }
    return -1;
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSections(md: string): SectionMap {
    const keys = [
        { key: "todayHighlights", title: "今日看点" },
        { key: "mustRead", title: "今日必读" },
        { key: "overview", title: "数据概览" },
        { key: "categorized", title: "分类文章列表" },
    ] as const;

    const found = keys
        .map(k => ({
            ...k,
            idx: findSectionTitleIndex(md, k.title),
        }))
        .filter(k => k.idx >= 0)
        .sort((a, b) => a.idx - b.idx);

    const result: SectionMap = {};
    for (let i = 0; i < found.length; i++) {
        const start = found[i].idx;
        const end = i < found.length - 1 ? found[i + 1].idx : md.length;
        const block = md.slice(start, end).trim();
        (result as any)[found[i].key] = block;
    }
    return result;
}

function stripSectionHeading(block?: string): string {
    if (!block) return "";
    return block.replace(/^#{1,6}\s+.+$/m, "").trim();
}

function splitMustRead(block: string): string[] {
    const body = stripSectionHeading(block);

    // 优先按三级标题拆；没有就按二级标题/粗体标题回退
    let parts = body.split(/\n(?=###\s+)/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
        parts = body.split(/\n(?=##\s+)/).map(s => s.trim()).filter(Boolean);
    }
    if (parts.length <= 1) {
        parts = body.split(/\n(?=\*\*Top\s*\d+)/i).map(s => s.trim()).filter(Boolean);
    }

    // 如果还是没拆开，按较大的段落拆
    if (parts.length <= 1) {
        parts = body.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    }

    return parts;
}

function splitCategorized(block: string): Array<{ title: string; body: string }> {
    const body = stripSectionHeading(block);

    // 按分类标题切分，兼容 ## / ### 两种情况
    const raw = body.split(/\n(?=##\s+|###\s+)/).map(s => s.trim()).filter(Boolean);

    const sections: Array<{ title: string; body: string }> = [];
    for (const item of raw) {
        const lines = item.split("\n");
        const first = lines[0] || "分类";
        const title = first.replace(/^#{2,3}\s+/, "").trim();
        const content = lines.slice(1).join("\n").trim();
        if (content) {
            sections.push({ title, body: content });
        }
    }

    // 如果没识别出来，就整块返回
    if (sections.length === 0 && body) {
        sections.push({ title: "分类文章列表", body });
    }

    return sections;
}

function splitLongText(text: string, maxLen = 2800): string[] {
    if (text.length <= maxLen) return [text];

    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = "";

    for (const p of paragraphs) {
        const next = current ? `${current}\n\n${p}` : p;
        if (next.length > maxLen) {
            if (current) {
                chunks.push(current.trim());
                current = p;
            } else {
                // 单段超长，硬切
                for (let i = 0; i < p.length; i += maxLen) {
                    chunks.push(p.slice(i, i + maxLen));
                }
                current = "";
            }
        } else {
            current = next;
        }
    }

    if (current) chunks.push(current.trim());
    return chunks;
}

async function sendCard(title: string, body: string, index?: number, total?: number) {
    const headerTitle =
        index && total ? `${title}（${index}/${total}）` : title;

    const payload = {
        msg_type: "interactive",
        card: {
            config: {
                wide_screen_mode: true,
            },
            header: {
                template: "blue",
                title: {
                    tag: "plain_text",
                    content: headerTitle,
                },
            },
            elements: [
                {
                    tag: "markdown",
                    content: body,
                },
            ],
        },
    };

    const resp = await fetch(webhook!, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Lark push failed: ${resp.status} ${err}`);
    }
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const sections = extractSections(markdown);

const cards: Array<{ title: string; body: string }> = [];

// 1. 封面：今日看点
if (sections.todayHighlights) {
    const body = stripSectionHeading(sections.todayHighlights);
    cards.push({
        title: `每日 AI 摘要｜${new Date().toISOString().slice(0, 10)}`,
        body: `**今日看点**\n\n${body}`,
    });
}

// 2. 今日必读
if (sections.mustRead) {
    const mustReadItems = splitMustRead(sections.mustRead);
    if (mustReadItems.length > 0) {
        mustReadItems.forEach((item, idx) => {
            cards.push({
                title: `今日必读 Top ${idx + 1}`,
                body: item,
            });
        });
    }
}

// 3. 数据概览
if (sections.overview) {
    const body = stripSectionHeading(sections.overview);
    const chunks = splitLongText(body, 2600);
    chunks.forEach((chunk, idx) => {
        cards.push({
            title: chunks.length > 1 ? `数据概览 Part ${idx + 1}` : "数据概览",
            body: chunk,
        });
    });
}

// 4. 分类文章列表
if (sections.categorized) {
    const categorized = splitCategorized(sections.categorized);
    categorized.forEach(section => {
        const chunks = splitLongText(section.body, 2600);
        chunks.forEach((chunk, idx) => {
            cards.push({
                title: chunks.length > 1 ? `${section.title} Part ${idx + 1}` : section.title,
                body: chunk,
            });
        });
    });
}

// 如果没识别出固定结构，就退化成整篇切块
if (cards.length === 0) {
    const fallbackChunks = splitLongText(markdown, 2600);
    fallbackChunks.forEach((chunk, idx) => {
        cards.push({
            title: `每日 AI 摘要 Part ${idx + 1}`,
            body: chunk,
        });
    });
}

// 逐条发送，避免太快
for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    await sendCard(c.title, c.body, i + 1, cards.length);
    await sleep(800);
}

console.log(`Pushed ${cards.length} cards to Lark successfully`);