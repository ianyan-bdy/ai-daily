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

const webhook = process.env.LARK_WEBHOOK;
if (!webhook) {
    throw new Error("Missing LARK_WEBHOOK");
}

const inputFile = path.resolve("./output/digest.json");
if (!fs.existsSync(inputFile)) {
    throw new Error("output/digest.json not found");
}

const digest = JSON.parse(fs.readFileSync(inputFile, "utf8")) as DigestJson;

async function send(payload: any) {
    const resp = await fetch(webhook!, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Lark push failed: ${resp.status} ${err}`);
    }
}

function buildCoverCard(d: DigestJson) {
    return {
        msg_type: "interactive",
        card: {
            config: {
                wide_screen_mode: true
            },
            header: {
                template: "blue",
                title: {
                    tag: "plain_text",
                    content: `${d.title}｜${d.date}`
                }
            },
            elements: [
                {
                    tag: "div",
                    text: {
                        tag: "plain_text",
                        content: "今日重点"
                    }
                },
                ...d.highlights.map((h, idx) => ({
                    tag: "div",
                    text: {
                        tag: "plain_text",
                        content: `${idx + 1}. ${h}`
                    }
                })),
                ...(d.overview
                    ? [
                        { tag: "hr" },
                        {
                            tag: "div",
                            text: {
                                tag: "plain_text",
                                content: `整体概览：${d.overview}`
                            }
                        }
                    ]
                    : [])
            ]
        }
    };
}

function buildMustReadCard(d: DigestJson) {
    const elements: any[] = [
        {
            tag: "div",
            text: {
                tag: "plain_text",
                content: "今日必读"
            }
        }
    ];

    d.mustRead.forEach((item, idx) => {
        elements.push(
            { tag: "hr" },
            {
                tag: "div",
                text: {
                    tag: "plain_text",
                    content: `必读 ${idx + 1}：${item.title}`
                }
            },
            {
                tag: "div",
                text: {
                    tag: "plain_text",
                    content: `摘要：${item.summary}`
                }
            },
            {
                tag: "div",
                text: {
                    tag: "plain_text",
                    content: `推荐理由：${item.reason}`
                }
            }
        );

        if (item.url) {
            elements.push({
                tag: "action",
                actions: [
                    {
                        tag: "button",
                        text: {
                            tag: "plain_text",
                            content: "查看原文"
                        },
                        type: "default",
                        url: item.url
                    }
                ]
            });
        }
    });

    return {
        msg_type: "interactive",
        card: {
            config: {
                wide_screen_mode: true
            },
            header: {
                template: "green",
                title: {
                    tag: "plain_text",
                    content: `${d.title}｜今日必读`
                }
            },
            elements
        }
    };
}

function buildCategoryCards(d: DigestJson) {
    return d.categories.map(category => {
        const elements: any[] = [
            {
                tag: "div",
                text: {
                    tag: "plain_text",
                    content: category.name
                }
            }
        ];

        category.items.forEach((item, idx) => {
            elements.push(
                { tag: "hr" },
                {
                    tag: "div",
                    text: {
                        tag: "plain_text",
                        content: `${idx + 1}. ${item.title}`
                    }
                },
                {
                    tag: "div",
                    text: {
                        tag: "plain_text",
                        content: item.summary
                    }
                }
            );

            if (item.url) {
                elements.push({
                    tag: "action",
                    actions: [
                        {
                            tag: "button",
                            text: {
                                tag: "plain_text",
                                content: "原文链接"
                            },
                            type: "default",
                            url: item.url
                        }
                    ]
                });
            }
        });

        return {
            msg_type: "interactive",
            card: {
                config: {
                    wide_screen_mode: true
                },
                header: {
                    template: "wathet",
                    title: {
                        tag: "plain_text",
                        content: `${d.title}｜${category.name}`
                    }
                },
                elements
            }
        };
    });
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const payloads = [
        buildCoverCard(digest),
        buildMustReadCard(digest),
        ...buildCategoryCards(digest)
    ];

    for (const payload of payloads) {
        await send(payload);
        await sleep(800);
    }

    console.log("Pushed digest cards to Lark successfully");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});