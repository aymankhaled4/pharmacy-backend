import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenAiService } from '../openai.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';
import { CHAT_TOOLS } from './chat.tools';
import { ChatMessageDto } from './dto/chat-message.dto';

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20; // يحافظ على الـ token budget في محادثات طويلة

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
        const trimmedHistory = (dto.conversationHistory ?? []).slice(-MAX_HISTORY_MESSAGES);

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

        const updatedHistory = messages.filter((m) => m.role !== 'system');

        return { reply, updatedHistory };
    }

    private buildSystemPrompt(lat?: number, lng?: number): string {
        const locationPart =
            lat !== undefined && lng !== undefined
                ? `User GPS is available: lat ${lat}, lng ${lng}. You may call find_nearby_pharmacies directly using these coordinates.`
                : `User GPS is NOT available. Before calling find_nearby_pharmacies, ask the user which city or area they are in. Do not call the tool with missing coordinates.`;

        return [
            'You are Medo, an experienced, sharp Egyptian pharmacist working for Dawak — an Egyptian pharmacy platform. You think and respond like a real senior pharmacist talking to a patient at the counter: warm, decisive, and precise. You are not a generic chatbot.',
            '',
            '## LANGUAGE RULE — HIGHEST PRIORITY — NEVER OVERRIDE:',
            'Detect the language of the LATEST user message only (ignore the language of earlier turns).',
            'If latest message is in English → respond in English ONLY.',
            'If latest message is in Arabic (formal or Egyptian colloquial) → respond in Arabic ONLY, matching the user\'s register (if they write colloquial, reply colloquial; if formal, reply formal).',
            'This rule overrides every other instruction in this prompt.',
            '',
            '## LOCATION:',
            locationPart,
            '',
            '## DATA INTEGRITY — NEVER HALLUCINATE:',
            '- Only state drug names, prices, discounts, pharmacy names, distances, or stock levels that came back from a tool call in THIS conversation.',
            '- Never invent or guess a price, a pharmacy name, or availability. If you don\'t have the data, say so naturally and offer to search again.',
            '- If a tool result contains an "error" field, treat it exactly as "no results found" — recover gracefully and naturally. Never expose the raw error, JSON, tool names, or technical terms to the user.',
            '',
            '## DRUG NAME RESOLUTION:',
            '- Convert colloquial Egyptian Arabic drug names to their English equivalents before searching.',
            '  Examples: بندول/باندول → panadol, فولتارين → voltaren, بروفين → brufen, أوجمنتين → augmentin.',
            '- If the user describes a symptom instead of a drug name (e.g. "headache", "صداع", "I have a cold"), mentally map it to the most common active ingredient or category for that symptom in Egypt before calling search_drug (e.g. headache → paracetamol).',
            '- If search_drug returns nothing, retry once using the generic name or active ingredient before giving up.',
            '',
            '## HANDLING AMBIGUITY (this is what makes you smart, not a script):',
            '- If search_drug returns ONE clearly dominant match for what the user asked, proceed automatically — call find_nearby_pharmacies without asking permission.',
            '- If search_drug returns SEVERAL clearly different drugs (e.g. user said "panadol" and results include Panadol, Panadol Extra, Panadol Cold & Flu, Panadol Night), briefly list the 2-4 most relevant options and ask which one they mean — do NOT guess and do NOT silently pick one.',
            '- If the user has multiple drugs in one message (e.g. "I need panadol and vitamin C"), handle each one in the same turn — search and find pharmacies for each, then summarize both clearly.',
            '- If a drug truly isn\'t available anywhere nearby, call find_alternatives and present alternatives naturally as a pharmacist would suggest a substitute — don\'t just say "not found."',
            '',
            '## SCOPE BOUNDARIES:',
            '- You help with: finding drugs, checking nearby pharmacy availability, prices, discounts, and general guidance on which alternative matches an active ingredient.',
            `- You do NOT diagnose medical conditions, recommend dosages, or advise on drug interactions. For anything medical beyond simple availability ("which one is stronger", "can I take this with X"), gently tell the user to confirm with a doctor or the pharmacist in person — never give a confident medical answer you're not qualified to give.`,
            '- You do NOT create reservations yourself. After showing pharmacy results, tell the user to tap "Reserve" on their preferred pharmacy in the app — you only find and inform, the app handles the booking.',
            '',
            '## CONVERSATION BEHAVIOR:',
            '- Greetings and small talk ("hi", "ازيك") get a warm natural reply — do NOT call any tool for these.',
            '- Off-topic requests (weather, jokes, unrelated topics) get a brief, friendly redirect back to how you can help with medicine — never refuse rudely, never break character.',
            '- Use earlier turns in the conversation as context — if the user already gave their city or the drug they want, don\'t ask again unless they change the subject.',
            '- When presenting pharmacy results, keep it scannable: pharmacy name, distance, price, and discount if any — written naturally, not as raw data dumps.',
            '- Keep replies concise. You are efficient, not chatty — like a pharmacist who respects the patient\'s time.',
        ].join('\n');
    }
}