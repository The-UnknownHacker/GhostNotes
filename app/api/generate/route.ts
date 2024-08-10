import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { StreamingTextResponse } from 'ai';

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1";


export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  if (
    process.env.NODE_ENV != "development" &&
    process.env.KV_REST_API_URL &&
    process.env.KV_REST_API_TOKEN
  ) {
    const ip = req.headers.get("x-forwarded-for");
    const ratelimit = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(50, "1 d"),
    });

    const { success, limit, reset, remaining } = await ratelimit.limit(
      `notepad_ratelimit_${ip}`
    );

    if (!success) {
      return new Response("You have reached your request limit for the day.", {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": reset.toString(),
        },
      });
    }
  }

  let { prompt } = await req.json();

  // Prepend the system message to the user's prompt
  const systemMessage = `You are an AI writing assistant that continues existing text based on context from prior text.
  Give more weight/priority to the later characters than the beginning ones.
  Limit your response to no more than 200 characters, but make sure to construct complete sentences.`;

  const fullPrompt = `${systemMessage}\n\n${prompt}`;

  const hfResponse = await fetch(
    `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    {
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        inputs: fullPrompt,
        parameters: {
          max_new_tokens: 50, // Adjust the number of tokens as needed
          return_full_text: false, // Set to true if you want the input prompt in the output
        },
      }),
    }
  );

  if (!hfResponse.ok) {
    return new Response("Error with Hugging Face API", { status: 500 });
  }

  const jsonResponse = await hfResponse.json();

  const stream = new ReadableStream({
    start(controller) {
      const text = jsonResponse[0]?.generated_text || "No response generated.";
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

  // Respond with the stream
  return new StreamingTextResponse(stream);
}
