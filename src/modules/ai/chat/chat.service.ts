import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenAiService } from '../openai.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';
import { CHAT_TOOLS } from './chat.tools';
import { ChatMessageDto } from './dto/chat-message.dto';

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
        const userLocation = {
            lat: dto.latitude,
            lng: dto.longitude,
        };

        // Step 1 — create search log
        const searchId = await this.searchLogs.create({
            userId,
            query: dto.message,
            latitude: dto.latitude,
            longitude: dto.longitude,
        });

        // Step 2 — build messages
        const systemPrompt = this.buildSystemPrompt(dto.latitude, dto.longitude);

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...(dto.conversationHistory ?? []),
            { role: 'user', content: dto.message },
        ];

        // Step 3 & 4 — function-calling loop
        let searchDrugUsed = false;
        let resolvedDrugResults: unknown[] = [];

        let response = await this.openAi.chat({
            model: this.model,
            messages,
            tools: CHAT_TOOLS,
        });

        while (response.choices[0]?.finish_reason === 'tool_calls') {
            const assistantMessage = response.choices[0].message;
            messages.push(assistantMessage);

            const toolCalls = assistantMessage.tool_calls ?? [];

            // Execute all tool calls in this turn
            for (const toolCall of toolCalls) {
                const isFunctionCall = 'function' in toolCall;

                if (isFunctionCall && toolCall.function.name === 'search_drug') {
                    searchDrugUsed = true;
                }

                const toolResult = await this.executor.execute(toolCall, userLocation);
                messages.push(toolResult);

                // Collect drug results for suggestions
                if (isFunctionCall && toolCall.function.name === 'search_drug') {
                    try {
                        const parsed = JSON.parse(toolResult.content as string) as unknown[];
                        if (Array.isArray(parsed)) {
                            resolvedDrugResults = parsed;
                        }
                    } catch {
                        // ignore parse failures
                    }
                }
            }

            response = await this.openAi.chat({
                model: this.model,
                messages,
                tools: CHAT_TOOLS,
            });
        }

        // Step 5 — finalize logs
        const finalMessage = response.choices[0].message;
        messages.push(finalMessage);

        if (searchDrugUsed) {
            const resultFound = resolvedDrugResults.length > 0;
            const resolvedIngredient =
                resultFound && resolvedDrugResults[0]
                    ? ((resolvedDrugResults[0] as Record<string, unknown>).active_ingredient as string) ?? ''
                    : '';

            await this.searchLogs.updateResolved(searchId, resolvedIngredient, resultFound);

            if (resultFound && resolvedDrugResults.length > 0) {
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
                    .filter((s): s is { drugId: string; reason: string; confidenceScore: number } =>
                        typeof s.drugId === 'string' && s.drugId.length > 0,
                    );

                if (suggestions.length > 0) {
                    await this.searchLogs.createSuggestions(searchId, suggestions);
                }
            }
        }

        // Step 6 — return reply and history stripped of system prompt
        const reply = finalMessage.content ?? '';
        const updatedHistory = messages.filter((m) => m.role !== 'system');

        return { reply, updatedHistory };
    }

    private buildSystemPrompt(lat?: number, lng?: number): string {
        const locationPart =
            lat !== undefined && lng !== undefined
                ? `The user's GPS coordinates are: latitude ${lat}, longitude ${lng}.`
                : 'GPS coordinates are unavailable for this request.';

        return [
            'You are Medo, a friendly and knowledgeable Egyptian pharmacist assistant working for MedConnect pharmacy platform.',
            'You speak naturally like a real pharmacist — warm, professional, and helpful.',
            locationPart,
            '',
            '## Personality & Tone',
            '- Talk like a real Egyptian pharmacist: friendly, reassuring, and clear.',
            '- NEVER mention technical errors, API issues, or system problems to the user.',
            '- NEVER say "حدث خطأ تقني" or "technical error" or "system error".',
            '- If something is unavailable, say it naturally: "مش متاح دلوقتي" or "مش موجود في المنطقة دي".',
            '- Always respond in the same language the user writes in (Arabic or English).',
            '- If user writes in Egyptian colloquial Arabic, respond in the same dialect.',
            '',
            '## Drug Search Behavior',
            '1. When user mentions a drug, first convert colloquial/misspelled names to correct English brand name.',
            '   Examples: "بندول" or "باندول" → search "panadol", "فولتارين" → "voltaren", "بروفين" → "brufen"',
            '2. Call search_drug with the English name or correct spelling.',
            '3. If search returns no results, try the generic name or an alternative spelling — try at least twice.',
            '4. After finding a drug, call find_nearby_pharmacies automatically.',
            '5. If no pharmacies found nearby, say naturally: "مش لاقي الدواء ده قريب منك دلوقتي" and suggest alternatives.',
            '6. If drug is unavailable, call find_alternatives and present them as natural suggestions.',
            '',
            '## When No Results Found',
            'Instead of mentioning errors, say things like:',
            '- "الدواء ده مش متاح في الصيدليات القريبة منك دلوقتي، بس عندي بدائل بنفس التأثير..."',
            '- "مش لاقيتش النوع ده بالقرب منك، تحب أشوفلك بديل؟"',
        ].join('\n');
    }
}
