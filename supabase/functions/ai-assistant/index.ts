// AI Edge Function
// 目标：接收前端指令与页面上下文，调用外部 LLM，返回只读答复或可应用 patch
// 安全：LLM 密钥仅从 Supabase Secrets 读取，不在前端暴露

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type AiMode = "readonly" | "preview_patch";

interface AiHistoryItem {
  role?: string;
  content?: string;
}

interface AiRequest {
  instruction?: string;
  context?: Record<string, unknown>;
  history?: AiHistoryItem[];
  requirePatchFormat?: boolean;
}

interface AiResponse {
  mode: AiMode;
  message: string;
  patch?: Record<string, unknown>;
}

// CORS 头
// 作用：允许浏览器从本地页面直接调用该 Edge Function
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 处理预检请求
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. 解析请求
    const body = (await req.json()) as AiRequest;
    const instruction = (body.instruction || "").trim();
    const context = body.context || {};

    // 兼容传统 chat 模式历史
    // 目的：让 AI 基于最近几轮对话更好地理解连续指令
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const safeHistory = rawHistory
      .filter((item) => item && typeof item.content === "string" && item.content.trim())
      .slice(-12)
      .map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: String(item.content),
      }));

    if (!instruction) {
      return new Response(
        JSON.stringify({ mode: "readonly", message: "指令不能为空。" } satisfies AiResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    // 2. 从 Secrets 读取 LLM 配置
    // 必需：AI_API_KEY / AI_BASE_URL
    // 可选：AI_MODEL（默认 gemini-3-pro-preview）
    const aiApiKey = Deno.env.get("AI_API_KEY");
    const aiBaseUrl = Deno.env.get("AI_BASE_URL");
    const aiModel = Deno.env.get("AI_MODEL") || "gemini-3-pro-preview";

    if (!aiApiKey || !aiBaseUrl) {
      return new Response(
        JSON.stringify({ mode: "readonly", message: "AI 服务未配置：请在 Supabase Secrets 设置 AI_API_KEY / AI_BASE_URL。" } satisfies AiResponse),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        },
      );
    }

    // 3. 构建系统提示词
    // 约束：只允许返回有限白名单字段，避免越权写入
    const systemPrompt = `你是“时间追踪应用”的数据助手。
你会收到 instruction 和 context（含 records/todos/questions/dailyPlans 等）。
请按以下规则输出 JSON：
1) 如果是分析/问答需求，输出：{"mode":"readonly","message":"..."}
2) 如果是数据修改需求，输出：{"mode":"preview_patch","message":"变更说明","patch":{...}}
3) patch 只允许包含这些顶层键：records,todos,questions,dailyPlans,currentTask,currentTaskDescription,currentPlanId,currentTodoId,startTime,pausedTime,isPaused
4) 禁止输出其它键；禁止 markdown 代码块；必须是合法 JSON 字符串。`;

    // 4. 调用第三方 LLM（OpenAI 兼容接口）
    const upstreamRes = await fetch(`${aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiApiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          ...safeHistory,
          {
            role: "user",
            content: JSON.stringify({ instruction, context, requirePatchFormat: !!body.requirePatchFormat }),
          },
        ],
      }),
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      throw new Error(`上游 LLM 调用失败(${upstreamRes.status}): ${errText}`);
    }

    const upstreamData = await upstreamRes.json();
    const content = upstreamData?.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      throw new Error("上游 LLM 未返回可解析内容。");
    }

    // 5. 解析 LLM JSON 输出并做字段白名单过滤
    let parsed: AiResponse;
    try {
      parsed = JSON.parse(content) as AiResponse;
    } catch {
      throw new Error("AI 返回不是合法 JSON。请检查模型兼容性。")
    }

    const safe: AiResponse = {
      mode: parsed.mode === "preview_patch" ? "preview_patch" : "readonly",
      message: typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message
        : "AI 已完成处理。",
    };

    if (safe.mode === "preview_patch" && parsed.patch && typeof parsed.patch === "object") {
      const patch = parsed.patch as Record<string, unknown>;
      const allowedKeys = new Set([
        "records",
        "todos",
        "questions",
        "dailyPlans",
        "currentTask",
        "currentTaskDescription",
        "currentPlanId",
        "currentTodoId",
        "startTime",
        "pausedTime",
        "isPaused",
      ]);
      const arrayKeys = new Set(["records", "todos", "questions", "dailyPlans"]);

      const filteredPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (!allowedKeys.has(key)) {
          continue;
        }

        // 对列表字段做数组校验，避免模型返回对象或字符串污染前端数据结构。
        if (arrayKeys.has(key)) {
          if (Array.isArray(value)) {
            filteredPatch[key] = value;
          }
          continue;
        }

        // 对标量字段分别做最小类型校验，只透传前端可安全消费的值。
        if (key === "currentTask" && (typeof value === "string" || value === null)) {
          filteredPatch[key] = value;
          continue;
        }
        if (key === "currentTaskDescription" && typeof value === "string") {
          filteredPatch[key] = value;
          continue;
        }
        if ((key === "currentPlanId" || key === "currentTodoId" || key === "startTime") && (typeof value === "number" || value === null)) {
          filteredPatch[key] = value;
          continue;
        }
        if (key === "pausedTime" && typeof value === "number") {
          filteredPatch[key] = value;
          continue;
        }
        if (key === "isPaused" && typeof value === "boolean") {
          filteredPatch[key] = value;
        }
      }

      safe.patch = filteredPatch;
    }

    return new Response(JSON.stringify(safe), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        mode: "readonly",
        message: `函数错误：${error instanceof Error ? error.message : String(error)}`,
      } satisfies AiResponse),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
