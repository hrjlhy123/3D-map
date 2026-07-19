import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

const openai = new OpenAI({
    // 可在 .env 中通过 OPENAI_TIMEOUT_MS 修改
    timeout: Number(
        process.env.OPENAI_TIMEOUT_MS || 45_000
    ),

    // 避免搜索超时以后再次自动等待一轮
    maxRetries: 0,
});

const PORT = Number(
    process.env.RAG_PORT || 3006
);

const VECTOR_STORE_ID =
    process.env.OPENAI_VECTOR_STORE_ID;

const MODEL =
    process.env.OPENAI_MODEL || "gpt-5.6";

// 可以单独设置更快、更便宜的路由模型
const ROUTER_MODEL =
    process.env.OPENAI_ROUTER_MODEL || MODEL;

if (!VECTOR_STORE_ID) {
    throw new Error(
        "OPENAI_VECTOR_STORE_ID is missing from .env"
    );
}

app.use(cors());
app.use(express.json({ limit: "200kb" }));

function buildCommonInput({
    question,
    dashboardContext,
    mapContext,
}) {
    return `
User question:
${question}

Current dashboard context:
${JSON.stringify(dashboardContext, null, 2)}

Current map context:
${JSON.stringify(mapContext, null, 2)}
    `.trim();
}

function getOutputText(response, fallback = "") {
    const text = response?.output_text?.trim();
    return text || fallback;
}

function isTimeoutError(error) {
    return (
        error?.constructor?.name ===
        "APIConnectionTimeoutError" ||
        /timed out/i.test(error?.message || "")
    );
}

function describeSelectedBuilding(mapContext) {
    const building =
        mapContext?.selectedBuilding;

    if (!building) {
        return [
            "No building is currently selected.",
            `Camera distance: ${mapContext?.camera?.distanceMeters ??
            "unknown"
            }`,
        ].join("\n");
    }

    return [
        `Building ID: ${building.buildingId ?? "unknown"
        }`,

        `OSM ID: ${building.osmId ?? "unknown"
        }`,

        `Coordinates: ${building.latitude ?? "unknown"
        }, ${building.longitude ?? "unknown"
        }`,

        `H3 cell: ${building.h3Cell ?? "unknown"
        }`,

        `Rendered height: ${building.heightMeters ?? "unknown"
        } meters`,

        `Application property type: ${building.propertyType ?? "unknown"
        }`,
    ].join("\n");
}

/*
 * 让 OpenAI 判断应该使用哪一种处理方式。
 *
 * direct:
 *   普通聊天、问候、一般问题，或者仅靠当前传入的
 *   map/dashboard context 就能回答的问题。
 *
 * local:
 *   需要查询项目文档、Dashboard 定义或合成数据。
 *
 * full:
 *   需要当前互联网信息、真实位置资料、建筑周边信息、
 *   公开来源核实或最新市场信息。
 */
async function routeRequest({
    question,
    dashboardContext,
    mapContext,
}) {
    const routerStartedAt = Date.now();

    console.log("[Router] Classifying request...");

    const routerResponse =
        await openai.responses.create({
            model: ROUTER_MODEL,

            instructions: `
You are the intent router and conversational front layer
for a WebGPU-based 3D GIS dashboard.

Choose exactly one mode:

DIRECT
Use when:
- The user is greeting, thanking, chatting, joking, or
  asking a general conversational question.
- The user asks something answerable directly from the live
  map or dashboard context supplied in the request.
- No uploaded documentation or current public information
  is required.

LOCAL
Use when:
- The answer requires uploaded project documentation.
- The user asks how WebGPU rendering, H3 streaming, picking,
  dashboard KPIs, or this application's synthetic demo data
  works.
- Current internet information is not required.

FULL
Use when:
- The user explicitly asks to search, verify online, browse,
  or use public sources.
- The question concerns current, latest, real-world, nearby,
  surrounding, address, neighborhood, owner, market, public
  GIS, or exact building information.
- Information may have changed or must be verified using
  public web sources.

Important distinctions:
- "What is the selected building's rendered height?" can be
  DIRECT because the live map context may contain it.
- "How does this application select a building?" is LOCAL
  because the project documentation is relevant.
- "What is around this selected building?" is FULL because
  it requires real-world public information.
- A greeting such as "hi" must be DIRECT.

For DIRECT mode:
- Write the complete final user-facing response in
  direct_answer.
- Answer naturally and concisely.
- You may use the supplied live map/dashboard context.
- Do not mention routing, RAG, file search, or web search.

For LOCAL and FULL modes:
- Set direct_answer to an empty string.

Return only the required structured result.
            `.trim(),

            input: `
User question:
${question}

Has selected building:
${Boolean(mapContext?.selectedBuilding)}

Selected building:
${JSON.stringify(
                mapContext?.selectedBuilding || null,
                null,
                2
            )}

Dashboard context:
${JSON.stringify(
                dashboardContext || {},
                null,
                2
            )}

Camera context:
${JSON.stringify(
                mapContext?.camera || {},
                null,
                2
            )}
            `.trim(),

            text: {
                format: {
                    type: "json_schema",
                    name: "gis_request_route",
                    description:
                        "Selects the data sources needed to answer the GIS dashboard user.",

                    strict: true,

                    schema: {
                        type: "object",

                        additionalProperties: false,

                        properties: {
                            mode: {
                                type: "string",
                                enum: [
                                    "direct",
                                    "local",
                                    "full",
                                ],
                            },

                            reason: {
                                type: "string",
                            },

                            direct_answer: {
                                type: "string",
                            },
                        },

                        required: [
                            "mode",
                            "reason",
                            "direct_answer",
                        ],
                    },
                },
            },

            reasoning: {
                effort: "low",
            },

            max_output_tokens: 400,
        });

    const rawResult =
        getOutputText(routerResponse);

    let route;

    try {
        route = JSON.parse(rawResult);
    } catch (error) {
        console.error(
            "[Router] Invalid structured output:",
            rawResult
        );

        throw new Error(
            "The request router returned invalid JSON."
        );
    }

    const allowedModes = new Set([
        "direct",
        "local",
        "full",
    ]);

    if (!allowedModes.has(route.mode)) {
        throw new Error(
            `Unsupported request mode: ${route.mode}`
        );
    }

    console.log(
        `[Router] Mode: ${route.mode}`
    );

    console.log(
        `[Router] Reason: ${route.reason}`
    );

    console.log(
        `[Router] Completed in ${Date.now() - routerStartedAt
        } ms`
    );

    return route;
}

/*
 * LOCAL 模式：
 * 直接使用 file_search 回答用户。
 */
async function runLocalAnswer(commonInput) {
    console.log(
        "[RAG] Starting local-only file search..."
    );

    const startedAt = Date.now();

    const response =
        await openai.responses.create({
            model: MODEL,

            instructions: `
You are the local knowledge-base Real Estate Market Assistant for a
WebGPU-based 3D GIS dashboard.

Search the uploaded:
- project documentation,
- dashboard data dictionary,
- Seattle synthetic market demo dataset.

Answer the user directly.

Rules:
1. Use the supplied live map and dashboard context when
   relevant.
2. Clearly identify synthetic, simulated, or demo-only data.
3. Do not claim that synthetic values are verified Seattle
   market statistics.
4. Do not invent building-specific financial information.
5. Do not claim to have searched the public web.
6. Use the heading "LOCAL RAG DATA" only when it improves
   clarity; do not force a long report for a simple question.
7. Keep the answer concise and useful.
            `.trim(),

            input: commonInput,

            tools: [
                {
                    type: "file_search",

                    vector_store_ids: [
                        VECTOR_STORE_ID,
                    ],

                    max_num_results: 4,
                },
            ],

            tool_choice: "required",

            reasoning: {
                effort: "low",
            },

            max_output_tokens: 900,
        });

    console.log(
        `[RAG] Local search completed in ${Date.now() - startedAt
        } ms`
    );

    return {
        answer: getOutputText(
            response,
            "The local knowledge base did not return an answer."
        ),

        durationMs:
            Date.now() - startedAt,
    };
}

/*
 * FULL 模式第一步：
 * 先检索本地文件，但只产生供下一步使用的摘要。
 */
async function runLocalSummary(commonInput) {
    console.log(
        "[RAG] Starting file search..."
    );

    const startedAt = Date.now();

    const response =
        await openai.responses.create({
            model: MODEL,

            instructions: `
You are the local RAG retrieval stage for a WebGPU-based
3D GIS dashboard.

Search the uploaded project documentation, dashboard data
dictionary, and synthetic Seattle market demo dataset.

Return a compact summary for a second research agent.

Label findings with:
- [Project Documentation]
- [Dashboard Data Dictionary]
- [Synthetic Market Dataset]
- [Not Found Locally]

Rules:
1. Do not treat live map context as a retrieved document.
2. Clearly identify synthetic demonstration information.
3. Do not invent building-specific market information.
4. State when the files do not identify the selected
   building.
5. Return 3 to 6 concise factual bullets.
6. Do not produce the final combined response.
            `.trim(),

            input: commonInput,

            tools: [
                {
                    type: "file_search",

                    vector_store_ids: [
                        VECTOR_STORE_ID,
                    ],

                    max_num_results: 4,
                },
            ],

            tool_choice: "required",

            reasoning: {
                effort: "low",
            },

            max_output_tokens: 800,
        });

    console.log(
        `[RAG] File search completed in ${Date.now() - startedAt
        } ms`
    );

    console.log(
        "[RAG] File-search output types:",
        response.output?.map(
            (item) => item.type
        )
    );

    return {
        context: getOutputText(
            response,
            "The uploaded knowledge base did not return a textual summary."
        ),

        durationMs:
            Date.now() - startedAt,
    };
}

/*
 * FULL 模式第二步：
 * 联网检索并综合地图、本地 RAG 和公开资料。
 */
async function runWebSearch({
    commonInput,
    fileContext,
}) {
    console.log(
        "[RAG] Starting web search..."
    );

    const startedAt = Date.now();

    const response =
        await openai.responses.create({
            model: MODEL,

            instructions: `
You are the final GIS research Real Estate Market Assistant embedded in a
WebGPU-based 3D GIS dashboard.

You receive three distinct information sources:

1. LIVE MAP CONTEXT
   Supplied by the running application. It may contain an
   internal building ID, OSM ID, coordinates, H3 cell,
   rendered height, property attributes, and camera state.

2. LOCAL RAG FINDINGS
   Retrieved from uploaded project documentation,
   dashboard definitions, and synthetic demonstration data.

3. WEB SEARCH FINDINGS
   Retrieved during this request from public web sources.

Search using the selected building's available:
- coordinates,
- OSM ID,
- H3 cell,
- Seattle location,
- property attributes.

Prefer:
- OpenStreetMap,
- Seattle government,
- King County,
- authoritative local organizations,
- established mapping sources.

The final answer must use this structure:

LIVE MAP DATA
Explain what the running application directly supplied.

LOCAL RAG DATA
Explain what the uploaded knowledge base contributed.
Clearly identify synthetic demonstration information.

WEB SEARCH DATA
Explain what current public sources indicate. State when
the exact building cannot be reliably identified.

COMBINED INTERPRETATION
Combine the sources and distinguish:
- live application data,
- locally retrieved documentation,
- verified public information,
- remaining unknowns.

Rules:
1. Never invent an address, owner, price, rental revenue,
   neighborhood, or property type.
2. Never present synthetic KPIs as real market data.
3. Do not assign citywide or neighborhood KPI values to an
   individual building.
4. Prefer useful geographic context when exact building
   records are unavailable.
5. Keep the total answer around 200 to 350 words.
            `.trim(),

            input: `
${commonInput}

Internal file-search findings:
${fileContext}
            `.trim(),

            tools: [
                {
                    type: "web_search",
                    search_context_size: "low",
                },
            ],

            tool_choice: "required",

            reasoning: {
                effort: "low",
            },

            max_output_tokens: 1200,
        });

    console.log(
        `[RAG] Web search completed in ${Date.now() - startedAt
        } ms`
    );

    console.log(
        "[RAG] Web-search status:",
        response.status
    );

    console.log(
        "[RAG] Web-search output types:",
        response.output?.map(
            (item) => item.type
        )
    );

    return {
        answer: getOutputText(response),
        durationMs:
            Date.now() - startedAt,
    };
}

app.post("/api/rag", async (req, res) => {
    const totalStartedAt = Date.now();

    try {
        const question = String(
            req.body?.question || ""
        ).trim();

        const dashboardContext =
            req.body?.dashboardContext || {};

        const mapContext =
            req.body?.mapContext || {};

        if (!question) {
            return res.status(400).json({
                error: "Question is required.",
            });
        }

        /*
         * 第一步只让 OpenAI 选择数据来源。
         * 这里不提供任何工具，因此不会执行搜索。
         */
        const route = await routeRequest({
            question,
            dashboardContext,
            mapContext,
        });

        /*
         * DIRECT:
         * 只有一次 OpenAI 调用，不使用 file_search 或 web_search。
         */
        if (route.mode === "direct") {
            const answer =
                String(
                    route.direct_answer || ""
                ).trim() ||
                "Hello! How can I help with the map or dashboard?";

            return res.json({
                answer,

                mode: "direct",

                routerReason:
                    route.reason,

                pipeline: [
                    "openai_intent_router",
                    "openai_direct_answer",
                ],

                timing: {
                    totalMs:
                        Date.now() -
                        totalStartedAt,
                },
            });
        }

        const commonInput =
            buildCommonInput({
                question,
                dashboardContext,
                mapContext,
            });

        /*
         * LOCAL:
         * OpenAI 路由 + file_search。
         * 不提供 web_search 工具。
         */
        if (route.mode === "local") {
            const localResult =
                await runLocalAnswer(
                    commonInput
                );

            return res.json({
                answer:
                    localResult.answer,

                mode: "local",

                routerReason:
                    route.reason,

                pipeline: [
                    "openai_intent_router",
                    "file_search",
                    "local_answer",
                ],

                timing: {
                    localSearchMs:
                        localResult.durationMs,

                    totalMs:
                        Date.now() -
                        totalStartedAt,
                },
            });
        }

        /*
         * FULL:
         * OpenAI 路由 + file_search + web_search。
         */
        const localResult =
            await runLocalSummary(
                commonInput
            );

        let finalAnswer = "";
        let webSearchMs = 0;
        let webSearchStatus =
            "completed";

        try {
            const webResult =
                await runWebSearch({
                    commonInput,
                    fileContext:
                        localResult.context,
                });

            finalAnswer =
                webResult.answer ||
                localResult.context;

            webSearchMs =
                webResult.durationMs;
        } catch (error) {
            if (!isTimeoutError(error)) {
                throw error;
            }

            webSearchStatus =
                "timed_out";

            webSearchMs =
                Date.now() -
                totalStartedAt -
                localResult.durationMs;

            console.warn(
                "[RAG] Web search timed out. Returning local fallback."
            );

            finalAnswer = `
LIVE MAP DATA

${describeSelectedBuilding(mapContext)}

LOCAL RAG DATA

${localResult.context}

WEB SEARCH DATA

The public web search did not finish within the configured
time limit. No unfinished web result is being presented as
verified information.

COMBINED INTERPRETATION

The live WebGPU application context and local knowledge-base
search completed successfully. Current public information
could not be verified during this request. Synthetic
dashboard values remain demonstration data and should not be
treated as verified property or market records.
            `.trim();
        }

        console.log(
            `[RAG] Entire request completed in ${Date.now() -
            totalStartedAt
            } ms`
        );

        return res.json({
            answer: finalAnswer,

            mode: "full",

            routerReason:
                route.reason,

            pipeline: [
                "openai_intent_router",
                "live_map_context",
                "file_search",
                "web_search",
                "combined_interpretation",
            ],

            localFindings:
                localResult.context,

            webSearchStatus,

            timing: {
                localSearchMs:
                    localResult.durationMs,

                webSearchMs,

                totalMs:
                    Date.now() -
                    totalStartedAt,
            },
        });
    } catch (error) {
        console.error(
            "[RAG] Request failed:",
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                "The AI assistant could not answer the question.",

            timing: {
                totalMs:
                    Date.now() -
                    totalStartedAt,
            },
        });
    }
});

app.listen(
    PORT,
    "127.0.0.1",
    () => {
        console.log(
            `RAG API listening at http://127.0.0.1:${PORT}`
        );
    }
);