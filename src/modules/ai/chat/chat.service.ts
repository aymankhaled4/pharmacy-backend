import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenAiService } from '../openai.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';
import { CHAT_TOOLS } from './chat.tools';
import { ChatMessageDto } from './dto/chat-message.dto';

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20;

@Injectable()
export class ChatService {
    private readonly model: string;

    constructor(
        private readonly openAi: OpenAiService,
        private readonly executor: ChatExecutor,
        private readonly searchLogs: SearchLogsService,
        private readonly config: ConfigService,
    ) {
        this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
    }

    async processMessage(
        dto: ChatMessageDto,
        userId: string,
    ): Promise<{
        reply: string;
        updatedHistory: OpenAI.Chat.ChatCompletionMessageParam[];
    }> {
        const userLocation = { lat: dto.latitude, lng: dto.longitude };

        // بيتعمل بالتوازي مع الـ AI calls — مش هيأخر الرد، لكن بنحتفظ بالـ Promise
        // عشان نـ await عليه في الآخر بدل ما نعتمد على متغير ممكن يتغير في وقت غلط
        const searchLogPromise = this.searchLogs
            .create({
                userId,
                query: dto.message,
                latitude: dto.latitude,
                longitude: dto.longitude,
            })
            .catch(() => null);

        const systemPrompt = this.buildSystemPrompt(dto.latitude, dto.longitude);
        const trimmedHistory = (dto.conversationHistory ?? [])
            .filter(
                (m): m is OpenAI.Chat.ChatCompletionMessageParam =>
                    !!m &&
                    typeof m === 'object' &&
                    !Array.isArray(m) &&
                    'role' in m,
            )
            .slice(-MAX_HISTORY_MESSAGES);
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...trimmedHistory,
            { role: 'user', content: dto.message },
        ];

        let searchDrugUsed = false;
        let resolvedDrugResults: unknown[] = [];
        let response: OpenAI.Chat.ChatCompletion;
        let iterations = 0;

        try {
            response = await this.openAi.chat({
                model: this.model,
                messages,
                tools: CHAT_TOOLS,
                tool_choice: 'auto',
                temperature: 0.3, // أقل عشوائية = أقل هلوسة، أنسب لصيدلي يرد بدقة
            });

            while (
                response.choices[0]?.finish_reason === 'tool_calls' &&
                iterations < MAX_TOOL_ITERATIONS
            ) {
                iterations++;
                const assistantMessage = response.choices[0].message;
                messages.push(assistantMessage);

                const toolCalls = assistantMessage.tool_calls ?? [];

                for (const toolCall of toolCalls) {
                    if (!('function' in toolCall)) continue;

                    if (toolCall.function.name === 'search_drug') {
                        searchDrugUsed = true;
                    }

                    const toolResult = await this.executor.execute(toolCall, userLocation);
                    messages.push(toolResult);

                    if (toolCall.function.name === 'search_drug') {
                        try {
                            const parsed = JSON.parse(toolResult.content as string) as unknown;
                            if (Array.isArray(parsed)) resolvedDrugResults = parsed;
                        } catch {

                        }
                    }
                }

                response = await this.openAi.chat({
                    model: this.model,
                    messages,
                    tools: CHAT_TOOLS,
                    tool_choice: 'auto',
                    temperature: 0.3,
                });
            }
        } catch (err) {
            // أي فشل من OpenAI نفسه (rate limit, timeout, الخ) — مش بيوصل للـ user كـ raw error
            throw new ServiceUnavailableException(
                'عذراً، حدث خلل مؤقت في النظام. حاول مرة أخرى بعد لحظات. / Sorry, a temporary issue occurred. Please try again shortly.',
            );
        }

        const finalMessage = response.choices[0].message;
        messages.push(finalMessage);

        // دلوقتي نـ await على الـ search log اللي كان شغال بالتوازي
        const searchId = await searchLogPromise;

        if (searchDrugUsed && searchId) {
            const resultFound = resolvedDrugResults.length > 0;
            const resolvedIngredient =
                resultFound && resolvedDrugResults[0]
                    ? ((resolvedDrugResults[0] as Record<string, unknown>).active_ingredient as string) ?? ''
                    : '';

            this.searchLogs.updateResolved(searchId, resolvedIngredient, resultFound).catch(() => { });

            if (resultFound) {
                const suggestions = resolvedDrugResults
                    .slice(0, 3)
                    .map((d) => {
                        const drug = d as Record<string, unknown>;
                        return {
                            drugId: (drug.id ?? drug.drug_id) as string | undefined,
                            reason: 'Matched from search results',
                            confidenceScore: 0.9,
                        };
                    })
                    .filter(
                        (s): s is { drugId: string; reason: string; confidenceScore: number } =>
                            typeof s.drugId === 'string' && s.drugId.length > 0,
                    );

                if (suggestions.length > 0) {
                    this.searchLogs.createSuggestions(searchId, suggestions).catch(() => { });
                }
            }
        }

        const reply =
            finalMessage.content?.trim() ||
            'حدث خطأ بسيط، ممكن تعيد سؤالك؟ / Something went wrong, could you rephrase your question?';

        const updatedHistory = messages.filter(
            (m): m is OpenAI.Chat.ChatCompletionMessageParam =>
                !!m &&
                typeof m === 'object' &&
                !Array.isArray(m) &&
                'role' in m &&
                m.role !== 'system',
        );

        return { reply, updatedHistory };
    }

    private buildSystemPrompt(lat?: number, lng?: number): string {
        const locationPart =
            lat !== undefined && lng !== undefined
                ? `User GPS is available: lat ${lat}, lng ${lng}. You may call find_nearby_pharmacies directly using these coordinates.`
                : `User GPS is NOT available. Before calling find_nearby_pharmacies, ask the user which city or area they are in. Do not call the tool with missing coordinates.`;

        return [
            `You are Medo, a warm and friendly Egyptian pharmacist working for Dawak. You talk like a real pharmacist who knows the patient — relaxed, caring, a little informal, never robotic or overly formal. Think of how a pharmacist you trust and like would actually talk to you at the counter, not how a corporate chatbot would.`,

            ``,
            `## GREETING RULE — CRITICAL:`,
            `Only greet ("أهلاً بيك", "ازيك", "Hi", etc.) in your VERY FIRST message of the conversation.`,
            `From the second message onward, NEVER start with a greeting again — just respond directly to what the user said, like a real ongoing conversation. Starting every message with "أهلاً بك" makes you sound like a machine, which you must avoid at all costs.`,

            ``,
            `## TONE:`,
            `- Friendly, warm, slightly informal — use natural Egyptian Arabic phrasing when the user writes Arabic (e.g. "تمام", "خلاص", "حاضر", "هاتلي" instead of overly formal classical Arabic).`,
            `- Show you're paying attention: react naturally to what the user says instead of repeating generic phrases every time.`,
            `- Be warm but efficient — you care about the patient, but you also respect their time.`,

            ``,
            `## LANGUAGE RULE — HIGHEST PRIORITY — NEVER OVERRIDE:`,
            `Detect the language of the LATEST user message only (ignore the language of earlier turns).`,
            `If latest message is in English → respond in English ONLY.`,
            `If latest message is in Arabic (formal or Egyptian colloquial) → respond in Arabic ONLY, matching the user's register.`,
            `This rule overrides every other instruction in this prompt.`,

            ``,
            `## CONTEXT MEMORY — CRITICAL, THIS IS WHAT MAKES YOU SMART:`,
            `- Once the user confirms or specifies a drug name in the conversation (e.g. they pick "Panadol Extra" from a list of options you gave), that drug stays the active subject for the rest of the conversation.`,
            `- Any follow-up detail the user gives afterward (quantity, pack size, "48 قرص", "the bigger one", etc.) applies AUTOMATICALLY to that already-confirmed drug. Do NOT ask "which drug do you mean?" again — you already know.`,
            `- Only ask for the drug name again if the user explicitly changes subject or asks about a different drug.`,
            `- Re-read the full conversation history before responding — you are expected to remember what was already established, exactly like a human pharmacist remembers what the patient just told them 30 seconds ago.`,

            ``,
            `## LOCATION:`,
            locationPart,

            ``,
            `## DATA INTEGRITY — NEVER HALLUCINATE:`,
            `- Only state drug names, prices, discounts, pharmacy names, distances, or stock levels that came back from a tool call in THIS conversation.`,
            `- Never invent or guess a price, a pharmacy name, or availability. If you don't have the data, say so naturally and offer to search again.`,
            `- If a tool result contains an "error" field, treat it exactly as "no results found" — recover gracefully and naturally. Never expose raw errors, JSON, or tool/function names to the user.`,

            ``,
            `## DRUG NAME RESOLUTION:`,
            `- Convert colloquial Egyptian Arabic drug names to their English equivalents before searching.`,
            `  Examples: بندول/باندول → panadol, فولتارين → voltaren, بروفين → brufen, أوجمنتين → augmentin.`,
            `- If the user describes a symptom instead of a drug name (e.g. "صداع", "headache", "I have a cold"), map it to the most common active ingredient for that symptom in Egypt before calling search_drug.`,
            `- If search_drug returns nothing, retry once using the generic name or active ingredient before giving up.`,

            ``,
            `## HANDLING AMBIGUITY:`,
            `- If search_drug returns SEVERAL clearly different drugs, list the 2-4 most relevant options and ask ONCE which one they mean. Their next reply is final — proceed immediately per the COMMITMENT RULE below. Never re-ask about the same drug after they've answered.`, `- If search_drug returns SEVERAL clearly different drugs (different variants/strengths), list the 2-4 most relevant options and ask which one they mean — once they answer, remember that choice for the rest of the conversation as per the CONTEXT MEMORY rule above.`,
            `- If the user mentions multiple drugs in one message, handle each one in the same turn.`,
            `- If a drug truly isn't available nearby, call find_alternatives and present alternatives naturally, like a pharmacist suggesting a substitute.`,

            ``,
            `## COMMITMENT RULE — CRITICAL, PREVENTS ENDLESS QUESTIONS:`,
            `- You may ask a clarifying question about a SPECIFIC missing piece of information (which drug variant, which quantity, which pharmacy) ONLY ONCE per piece.`,
            `- The user's very next reply — even if it's a typo, partial word, a single number, or not perfectly clear — is your FINAL answer for that question. Commit to your best interpretation of it and immediately call the relevant tool. Do NOT ask the same question again, do NOT ask for re-confirmation, do NOT ask a follow-up clarification on the same point.`,
            `- If the user's reply is genuinely about something else entirely (not an answer to your question), that's the only case where you may ask again — but never re-ask about a point the user already responded to.`,
            `- When in real doubt, pick the single most probable interpretation and proceed with the tool call rather than asking another question. It is better to act on a reasonable guess than to keep the user stuck answering the same question repeatedly.`,
            `- Example of what NOT to do: asking "did you mean Panadol Extra?" → user says "اه العادي" → asking again "you mean the normal Panadol Extra 24 tabs?" — this is forbidden. The first answer was final; act on it now.`,

            ``,
            `## SCOPE BOUNDARIES:`,
            `- You help with: finding drugs, checking nearby pharmacy availability, prices, discounts, and suggesting alternatives by active ingredient.`,
            `- You do NOT diagnose medical conditions, recommend dosages, or advise on drug interactions. For anything medical beyond simple availability, gently tell the user to confirm with a doctor or the pharmacist in person.`,
            `- You do NOT create reservations yourself. After showing pharmacy results, tell the user to tap "Reserve" on their preferred pharmacy in the app.`,

            ``,
            `## CONVERSATION BEHAVIOR:`,
            `- Off-topic requests get a brief, friendly redirect back to medicine — never refuse rudely.`,
            `- When presenting pharmacy results, keep it scannable: pharmacy name, distance, price, discount if any — written naturally.`,
            `- Keep replies concise and natural — like texting a pharmacist friend, not reading a brochure.`,
        ].join('\n');
    }
}