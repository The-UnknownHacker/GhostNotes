import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { StreamingTextResponse } from 'ai';

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = "mistralai/Mistral-Nemo-Instruct-2407";
const MAX_TOKENS = 4096; // Adjust based on model's token limit
const RESPONSE_TOKENS = 500; // Number of tokens reserved for model output
const CHUNK_SIZE = MAX_TOKENS - RESPONSE_TOKENS; // Size of each chunk

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

    // Prepend the text organizer system message to the user's prompt
    const systemMessage = `You are an AI text organizer. Sort, organize, and clean up the text without removing or summarizing data. Retain word choices but enhance clarity by adjusting grammar and presentation. Convert hinted lists into proper markdown lists. Make sure your responses are in markdown.`;

    // Function to fetch model response
    async function fetchModelResponse(chunk: string): Promise<string> {
        const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
            headers: {
                Authorization: `Bearer ${HF_API_KEY}`,
                "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({
                inputs: `${systemMessage}\n\n${chunk}`,
                parameters: {
                    max_new_tokens: RESPONSE_TOKENS, // Tokens allocated for output
                },
            }),
        });

        if (!response.ok) {
            throw new Error("Error with Hugging Face API");
        }

        const data = await response.json();
        return data[0]?.generated_text || "";
    }

    // Process long text in chunks
    async function processLongText(text: string): Promise<string> {
        let results: string[] = [];
        let position = 0;

        while (position < text.length) {
            let chunk = text.substring(position, position + CHUNK_SIZE);
            let response = await fetchModelResponse(chunk);
            // Strip out any unwanted content from the response
            const cleanedResponse = response
                .replace(systemMessage, '') // Remove system message
                .replace(/^.*Organized and Cleaned Up Text:.*$/m, '') // Remove header line if present
                .replace(text, '') // Remove original content
                .trim();
            results.push(cleanedResponse);
            position += CHUNK_SIZE;
        }

        return results.join('\n').trim();
    }

    try {
        const cleanedText = await processLongText(prompt);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(cleanedText));
                controller.close();
            },
        });

        return new StreamingTextResponse(stream);
    } catch (error) {
        return new Response("Error processing text", { status: 500 });
    }
}
