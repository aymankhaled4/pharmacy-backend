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
        const userLocation = { lat: dto.latitude, lng: dto.longitude };

        // Fire & forget — don't block the AI call
        let searchId = '';
        this.searchLogs
            .create({
                userId,
                query: dto.message,
                latitude: dto.latitude,
                longitude: dto.longitude,
            })
            .then((id) => { searchId = id; })
            .catch(() => { });

        // Build messages
        const systemPrompt = this.buildSystemPrompt(dto.latitude, dto.longitude);
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...(dto.conversationHistory ?? []),
            { role: 'user', content: dto.message },
        ];

        const tools = CHAT_TOOLS;

        let searchDrugUsed = false;
        let resolvedDrugResults: unknown[] = [];

        let response = await this.openAi.chat({
            model: this.model,
            messages,
            tools,
        });

        while (response.choices[0]?.finish_reason === 'tool_calls') {
            const assistantMessage = response.choices[0].message;
            messages.push(assistantMessage);

            const toolCalls = assistantMessage.tool_calls ?? [];

            for (const toolCall of toolCalls) {
                const isFunctionCall = 'function' in toolCall;

                if (isFunctionCall && toolCall.function.name === 'search_drug') {
                    searchDrugUsed = true;
                }

                const toolResult = await this.executor.execute(toolCall, userLocation);
                messages.push(toolResult);

                if (isFunctionCall && toolCall.function.name === 'search_drug') {
                    try {
                        const parsed = JSON.parse(toolResult.content as string) as unknown[];
                        if (Array.isArray(parsed)) resolvedDrugResults = parsed;
                    } catch {
                        // ignore
                    }
                }
            }

            response = await this.openAi.chat({
                model: this.model,
                messages,
                tools,
            });
        }

        // Finalize logs in background
        const finalMessage = response.choices[0].message;
        messages.push(finalMessage);

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

        const reply = finalMessage.content ?? '';
        const updatedHistory = messages.filter((m) => m.role !== 'system');

        return { reply, updatedHistory };
    }

    private buildSystemPrompt(lat?: number, lng?: number): string {
        const locationPart =
            lat !== undefined && lng !== undefined
                ? `User GPS: lat ${lat}, lng ${lng}.`
                : 'GPS unavailable.';

        return [
            'You are Medo, a friendly Egyptian pharmacist assistant for Dawak — an Egyptian pharmacy platform.',
            '',
            '## LANGUAGE RULE — HIGHEST PRIORITY — NEVER OVERRIDE:',
            'Detect the language of the LATEST user message.',
            'If latest message is in English → respond in English ONLY.',
            'If latest message is in Arabic → respond in Arabic ONLY.',
            'NEVER respond in Arabic if the user wrote in English.',
            'NEVER respond in English if the user wrote in Arabic.',
            'This rule has higher priority than anything else in this prompt.',
            '',
            locationPart,
            '',
            'Never mention technical errors — if something fails, say it naturally like a pharmacist would.',
            '',
            'Drug search rules:',
            '- Convert colloquial Arabic drug names to English before searching.',
            '  Examples: بندول/باندول → panadol, فولتارين → voltaren, بروفين → brufen.',
            '- If search returns nothing, try the generic name or active ingredient.',
            '- After finding a drug with search_drug, ALWAYS call find_nearby_pharmacies immediately and automatically — never ask the user for permission.',
            '- If the user mentions a drug name, search for it AND find nearby pharmacies in one flow without asking.',
            '- If no nearby pharmacies found, call find_alternatives and suggest them naturally.',
        ].join('\n');
    }
}
