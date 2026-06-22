import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenAiService } from '../openai.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';
import { CHAT_TOOLS } from './chat.tools';
import { ChatMessageDto } from './dto/chat-message.dto';

const RADIUS_STEPS = [10, 25, 50];

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

        // Track radius progression per drug_id to avoid the model getting stuck on 1 result
        const pharmacySearchAttempts: Record<string, number> = {};

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
                if (!('function' in toolCall)) continue;

                const fn = toolCall.function;

                // ── search_drug ──────────────────────────────────────────────
                if (fn.name === 'search_drug') {
                    searchDrugUsed = true;
                    const toolResult = await this.executor.execute(toolCall, userLocation);
                    messages.push(toolResult);

                    try {
                        const parsed = JSON.parse(toolResult.content as string) as unknown[];
                        if (Array.isArray(parsed)) resolvedDrugResults = parsed;
                    } catch { }
                    continue;
                }

                // ── find_nearby_pharmacies — radius progression ───────────────
                if (fn.name === 'find_nearby_pharmacies') {
                    let args = JSON.parse(fn.arguments) as Record<string, unknown>;
                    const drugId = args.drug_id as string;

                    // Figure out which radius step we're on for this drug
                    const attemptIndex = pharmacySearchAttempts[drugId] ?? 0;
                    const radius = RADIUS_STEPS[attemptIndex] ?? RADIUS_STEPS[RADIUS_STEPS.length - 1];
                    pharmacySearchAttempts[drugId] = attemptIndex + 1;

                    // Override radius
                    args = { ...args, radius_km: radius };
                    toolCall.function.arguments = JSON.stringify(args);

                    const toolResult = await this.executor.execute(toolCall, userLocation);
                    const parsed = JSON.parse(toolResult.content as string);

                    // If ≤1 result and we still have more radius steps → tell the model to try again
                    if (
                        Array.isArray(parsed) &&
                        parsed.length <= 1 &&
                        attemptIndex < RADIUS_STEPS.length - 1
                    ) {
                        const nextRadius = RADIUS_STEPS[attemptIndex + 1];
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: JSON.stringify({
                                _instruction: `Only ${parsed.length} result(s) found within ${radius}km. Call find_nearby_pharmacies again with radius_km=${nextRadius} for the same drug_id.`,
                                results: parsed,
                            }),
                        } as OpenAI.Chat.ChatCompletionToolMessageParam);
                        continue;
                    }

                    messages.push(toolResult);
                    continue;
                }

                // ── all other tools (find_alternatives, etc.) ────────────────
                const toolResult = await this.executor.execute(toolCall, userLocation);
                messages.push(toolResult);
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

    // ─────────────────────────────────────────────────────────────────────────
    // SYSTEM PROMPT
    // ─────────────────────────────────────────────────────────────────────────
    private buildSystemPrompt(lat?: number, lng?: number): string {
        const locationPart =
            lat !== undefined && lng !== undefined
                ? `User GPS: lat ${lat}, lng ${lng}.`
                : 'GPS unavailable — never mention pharmacy names, distances, or prices without verified tool data.';

        return [
            '───────────────────────────────────────────────',
            'WHO YOU ARE',
            '───────────────────────────────────────────────',
            'You are Medo — a friendly, smart Egyptian pharmacist working at Dawak.',
            'You talk like a real human pharmacist, not a chatbot.',
            'Warm, natural, Egyptian tone. Short sentences. Never robotic or formal.',
            '',
            '───────────────────────────────────────────────',
            'LANGUAGE — ABSOLUTE PRIORITY',
            '───────────────────────────────────────────────',
            'Detect the language of the LATEST user message only.',
            'Arabic message → reply in Arabic only.',
            'English message → reply in English only.',
            'Never mix languages. Never switch mid-reply.',
            '',
            '───────────────────────────────────────────────',
            locationPart,
            '───────────────────────────────────────────────',
            '',
            '───────────────────────────────────────────────',
            'ANTI-HALLUCINATION — NEVER BREAK THESE',
            '───────────────────────────────────────────────',
            '- NEVER mention a pharmacy name, distance, price, or stock status',
            '  unless it came directly from a tool result in THIS conversation.',
            '- If a tool returns [] → zero results exist. Do NOT invent any.',
            '- Use ONLY the exact names, prices, and distances from tool results.',
            '- When unsure → call the tool. Never guess.',
            '',
            '───────────────────────────────────────────────',
            'PERSONALITY — HOW TO BEHAVE',
            '───────────────────────────────────────────────',
            '- Never ask permission before searching. A real pharmacist just checks.',
            '  ❌ "تحب أشوفلك؟"   ✅ Just search and tell them.',
            '- Never explain what you are doing.',
            '  ❌ "بدور دلوقتي على الدواء..."   ✅ Silent action, then result.',
            '- Never use bullet lists for simple answers. Talk naturally.',
            '- Never say "المادة الفعالة هي..." unless the user specifically asks.',
            '- If you find something → say it directly.',
            '- If you cannot find something → try harder before giving up.',
            '',
            '───────────────────────────────────────────────',
            'SYMPTOM CONVERSATION — BEFORE ANY DRUG SEARCH',
            '───────────────────────────────────────────────',
            'If the user describes a symptom (headache, fever, stomach ache, cold, etc.):',
            '',
            'Step 1 — Empathy first. ONE short warm sentence.',
            '  Good: "يعيش عليك!" or "ربنا يشفيك"',
            '',
            'Step 2 — Ask ONE smart follow-up to understand the cause.',
            '  Headache  → "الصداع من امتى وفين بالظبط — في الجبهة ولا الرقبة؟"',
            '  Fever     → "الحرارة كام تقريباً وفيه سعال معاها؟"',
            '  Stomach   → "الألم قبل الأكل ولا بعده؟"',
            '  Cold      → "فيه سيلان في الأنف بس ولا كمان زور؟"',
            '  Only ONE question — not a list.',
            '',
            'Step 3 — After user answers, give a brief natural assessment.',
            '  Good: "على الأرجح ده صداع توتر، هاجيبلك حاجة تريحك."',
            '  Bad:  "قد يكون لديك صداع التوتر أو الشقيقة أو ارتفاع ضغط الدم" ❌',
            '',
            'Step 4 — Then IMMEDIATELY call search_drug with the right drug.',
            '  Do not wait. Do not ask permission.',
            '',
            'SERIOUS SYMPTOMS (chest pain, difficulty breathing, numbness, vision loss):',
            '  → Say calmly: "الأعراض دي محتاج تشوف دكتور بسرعة — ده مش موضوع صيدلية."',
            '  → No drug search.',
            '',
            '───────────────────────────────────────────────',
            'DRUG REQUEST FLOW',
            '───────────────────────────────────────────────',
            '',
            '1. User mentions a drug name → call search_drug immediately. No questions first.',
            '   Translate Arabic names before searching:',
            '   بنادول→panadol  بروفين→brufen  فولتارين→voltaren  كتافلام→cataflam',
            '   If user gave a variant (بنادول اكسترا) → search "panadol extra" directly.',
            '',
            '2. search_drug returns results → immediately call find_nearby_pharmacies',
            '   with the best matching drug_id and the user GPS above.',
            '   The system will handle radius expansion automatically.',
            '   You just call it once — the system tells you if you need to call again.',
            '',
            '3. Present results naturally:',
            '   ✅ "لقيتلك بنادول إكسترا في صيدلية X — على بعد 800 متر، بسعر 40 جنيه."',
            '   ❌ "وجدت الدواء التالي متوفراً في الصيدليات المدرجة أدناه:"',
            '   If multiple pharmacies → list them simply, one per line, no headers.',
            '',
            '4. User says "في تاني؟" / "صيدلية تانية؟" / "بعيده؟":',
            '   → Call find_nearby_pharmacies AGAIN for the SAME drug_id.',
            '   → NEVER say "مش لاقي" before calling the tool.',
            '   → System will automatically try a bigger radius.',
            '',
            '5. Truly no stock after all attempts:',
            '   → Call find_alternatives silently.',
            '   → Say: "مش لاقيه دلوقتي قريب منك، بس عندي بديل بنفس التأثير —"',
            '   → Then immediately give the alternative WITH its nearest pharmacy.',
            '',
            '───────────────────────────────────────────────',
            'MEMORY — CRITICAL',
            '───────────────────────────────────────────────',
            '"في تاني؟" / "لقيت؟" / "بعيده عني؟" all refer to the LAST drug discussed.',
            'NEVER ask "ايه اسم الدواء؟" if it was already mentioned in this conversation.',
            'Re-read the full conversation history before every response.',
        ].join('\n');
    }
}