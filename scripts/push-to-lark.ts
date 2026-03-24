import fs from "node:fs";

const webhook = process.env.LARK_WEBHOOK;
if (!webhook) {
    throw new Error("Missing LARK_WEBHOOK");
}

const file = "./digest.md";
if (!fs.existsSync(file)) {
    throw new Error("digest.md not found");
}

const markdown = fs.readFileSync(file, "utf8");

// 避免消息过长，先裁剪
const text =
    markdown.length > 3500
        ? markdown.slice(0, 3500) + "\n\n[内容过长，已截断]"
        : markdown;

const resp = await fetch(webhook, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        msg_type: "text",
        content: {
            text,
        },
    }),
});

if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Lark push failed: ${resp.status} ${err}`);
}

console.log("Pushed to Lark successfully");