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

        // Preserve the full history as-is — filtering by shape loses tool messages
        // from Gemini which may have non-standard fields. Just cap the length.
        const rawHistory = dto.conversationHistory ?? [];
        const trimmedHistory = rawHistory.slice(-MAX_HISTORY_MESSAGES) as OpenAI.Chat.ChatCompletionMessageParam[];

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
                temperature: 0.3,
            });

            // while (
            //     response.choices[0]?.finish_reason === 'tool_calls' &&
            //     iterations < MAX_TOOL_ITERATIONS
            // ) {
            //     iterations++;
            //     const assistantMessage = response.choices[0].message;
            //     messages.push(assistantMessage);

            //     const toolCalls = assistantMessage.tool_calls ?? [];

            //     for (const toolCall of toolCalls) {
            //         if (!('function' in toolCall)) continue;

            //         if (toolCall.function.name === 'search_drug') {
            //             searchDrugUsed = true;
            //         }

            //         const toolResult = await this.executor.execute(toolCall, userLocation);
            //         messages.push(toolResult);

            //         if (toolCall.function.name === 'search_drug') {
            //             try {
            //                 const parsed = JSON.parse(toolResult.content as string) as unknown;
            //                 if (Array.isArray(parsed)) resolvedDrugResults = parsed;
            //             } catch {

            //             }
            //         }
            //     }

            //     response = await this.openAi.chat({
            //         model: this.model,
            //         messages,
            //         tools: CHAT_TOOLS,
            //         tool_choice: 'auto',
            //         temperature: 0.3,
            //     });
            // }

            while (response.choices[0]?.finish_reason === 'tool_calls') {
                const assistantMessage = response.choices[0].message;
                messages.push(assistantMessage);

                const toolCalls = assistantMessage.tool_calls ?? [];

                for (const toolCall of toolCalls) {
                    if (!('function' in toolCall)) continue;

                    if (toolCall.function.name === 'search_drug') {
                        searchDrugUsed = true;

                        let newQuery = '';
                        try {
                            newQuery = (JSON.parse(toolCall.function.arguments) as { query?: string }).query ?? '';
                        } catch {
                        }

                        const previousResults = this.extractLastSearchDrugResults(messages);

                        console.log('[DEBUG] newQuery:', newQuery);
                        console.log('[DEBUG] previousResults found:', previousResults?.length ?? 'null');
                        console.log('[DEBUG] isRedundant:', previousResults ? this.isRedundantDrugSearch(newQuery, previousResults) : 'N/A');

                        if (previousResults && this.isRedundantDrugSearch(newQuery, previousResults)) {
                            console.log('[DEBUG] BLOCKED redundant search, reusing previous results');
                            // Return previous results WITH a hint to use them directly
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({
                                    reused_results: previousResults,
                                    instruction: 'These are the same results from your previous search. Do NOT search again. Resolve the user reply directly against the brand_name fields in reused_results.',
                                }),
                            });
                            resolvedDrugResults = previousResults;
                            continue;
                        }

                        console.log('[DEBUG] ALLOWED new search to proceed');
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
            throw new ServiceUnavailableException(
                'عذراً، حدث خلل مؤقت في النظام. حاول مرة أخرى بعد لحظات. / Sorry, a temporary issue occurred. Please try again shortly.',
            );
        }

        const finalMessage = response.choices[0].message;
        messages.push(finalMessage);

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

        // Build updatedHistory explicitly:
        // - Keep the old history as-is (preserves any extra fields from Gemini like extra_content)
        // - Append only the new messages from this turn (user message + tool calls + assistant reply)
        // slice from trimmedHistory.length (not dto.conversationHistory.length) because trimmedHistory
        // may be shorter due to MAX_HISTORY_MESSAGES cap and filter — and messages[0] is the system prompt
        const newTurnMessages = messages.slice(1 + trimmedHistory.length);

        // Sanitize: Gemini sometimes returns assistant messages with content: [] (empty array)
        // instead of content: null or content: string. Flutter's fromJson treats [] as invalid
        // and produces empty entries. Normalize content field before sending to client.
        const sanitizedNewTurn = newTurnMessages.map((m) => {
            if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
            const msg = m as unknown as Record<string, unknown>;
            // Normalize empty array content to null
            if (Array.isArray(msg['content']) && (msg['content'] as unknown[]).length === 0) {
                return { ...msg, content: null } as unknown as OpenAI.Chat.ChatCompletionMessageParam;
            }
            return m;
        }).filter((m): m is OpenAI.Chat.ChatCompletionMessageParam =>
            m !== null &&
            typeof m === 'object' &&
            !Array.isArray(m) &&
            'role' in (m as object),
        );

        const updatedHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
            ...(dto.conversationHistory ?? []),
            ...sanitizedNewTurn,
        ];

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
            `- CRITICAL — drug_id MUST always be a real UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) taken directly from the "id" field of a search_drug result in this conversation. NEVER construct, guess, or invent a drug_id like "panadol-extra-48-tabs" or any slug/text string. If you don't have a valid UUID from search results, call search_drug first to get one.`,
            `- CRITICAL: When calling find_nearby_pharmacies, you MUST use the exact drug_id UUID returned from search_drug results. NEVER generate or guess a drug_id. Only use drug_ids from the search_drug tool response.`,

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
            `- SINGLE MESSAGE RULE — CRITICAL: If a user sends a message that contains MULTIPLE pieces of information at once (e.g. "48 العادى" contains both size=48 AND variant=العادي, or "بانادول إكسترا 48" contains both brand and size), treat ALL pieces in that single message as simultaneously confirmed. Do NOT ask about any of them again. Extract all information from the message at once and proceed directly to the tool call. A message like "48 العادى" after discussing Panadol Extra variants means: size=48, variant=Extra (not Optizorb) — call find_nearby_pharmacies immediately with drug_id "465d86ad-fea4-4e8d-85dc-c8df304f502b" (PANADOL EXTRA 48 F.C. TABS.).`,

            ``,
            `## TOOL CALL DISCIPLINE — CRITICAL:`,
            `- NEVER call search_drug again with a generic brand word alone (e.g. "Panadol", "بانادول", "عادي", "العادي") when you already have search results for that exact brand from earlier in this conversation. Re-searching with a broader term throws away the specific variant you already confirmed and returns unrelated products.`,
            `- Once search_drug has returned results for a specific product family in this conversation (e.g. "Panadol Extra" with its variants), resolve ALL follow-up variant descriptors ("العادي", "48 قرص", "أوبتيزورب", "الكبير") by matching them against the brand_name/strength fields ALREADY in those results. Do NOT call search_drug again for this.`,
            `- Only call search_drug again if the user explicitly names a different drug or product family you have not searched for yet in this conversation.`,
            `- Before calling search_drug, ask yourself: "Do I already have results in this conversation that answer this?" If yes, use them directly instead of searching again.`,

            ``,
            `## VARIANT RESOLUTION ALGORITHM — CRITICAL, NO GUESSING:`,
            `- When the user replies with a variant descriptor ("العادي", "أوبتيزورب", "الكبير", "48"), you must resolve it ONLY against the brand_name/strength fields of the EXACT candidate list from your most recent search_drug tool result — never invent a name that is not literally present in that list.`,
            `- "العادي" / "normal" / "regular" means: pick the candidate whose brand_name does NOT contain the special variant keyword being contrasted (e.g. if the choice was "Extra" vs "Extra Optizorb", then "العادي" = the candidate without "OPTIZORB" in its brand_name — in this case "PANADOL EXTRA 48 F.C. TABS.", NOT a separate product called "Panadol Regular" which does not exist in the candidates).`,
            `- Match the pack size too ("48 قرص" must match a candidate whose brand_name contains "48", not 24).`,
            `- If no candidate matches both the variant descriptor AND the pack size exactly, pick the closest single match and proceed — do not invent a brand_name that isn't in the list.`,
            `- CRITICAL — ANSWER SCOPE: When you ask the user "Option A ولا Option B?", their next reply ("العادي", "الأول", "التاني", "ده") refers EXCLUSIVELY to the two options you just listed in your immediately preceding message. NEVER resolve their reply against any other product in the DB or any earlier turn. The scope is ONLY the options from your last question. For example: if you asked "بانادول إكسترا العادي ولا بانادول إكسترا أوبتيزورب؟" and user says "العادي" → that means "بانادول إكسترا العادي" period. It CANNOT mean "Panadol Advance" or any other product not in your last question.`,

            ``,
            `## FOLLOW-THROUGH RULE — CRITICAL, NO EMPTY PROMISES:`,
            `- NEVER tell the user "هدورلك" / "هشوفلك" / "ثواني" / "let me check" / "I'll search for that" unless you are calling find_nearby_pharmacies or another tool IN THE SAME RESPONSE, right now.`,
            `- If you say you will look something up, the tool call MUST be present in this same turn. A text-only reply that merely promises future action without an actual tool_call is FORBIDDEN.`,
            `- Once you've resolved which drug_id the user means (per the VARIANT RESOLUTION ALGORITHM above), immediately call find_nearby_pharmacies with that drug_id — do not just confirm the drug name and stop.`,

            ``,
            `## ANSWER SCOPE RULE — CRITICAL, PREVENTS DRUG MIX-UPS:`,
            `- When you ask the user a question with specific options (e.g. "Extra normal or Extra Optizorb?"), the user's next reply is answering THAT exact question — resolve it ONLY against the options you just listed in your immediately preceding message.`,
            `- NEVER resolve a short/ambiguous reply (like "العادي", "اه", "48") against an OLDER list of options from earlier in the conversation. Only your most recent question's options are valid candidates.`,
            `- The confirmed drug family from CONTEXT MEMORY does not change because of a short reply. If you were discussing "Panadol Extra" and asked about its variants, the user's answer stays within Panadol Extra — it can NEVER jump to a different Panadol product (Advance, Cold & Flu, Joint, etc.) unless the user explicitly names that product.`,
            `- If you are ever unsure which of your own previous questions the user is replying to, default to your MOST RECENT question — never an earlier one.`,

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

    private extractLastSearchDrugResults(
        messages: OpenAI.Chat.ChatCompletionMessageParam[],
    ): Array<Record<string, unknown>> | null {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== 'assistant') continue;

            const toolCalls = (msg as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls ?? [];

            for (const tc of toolCalls) {
                if (!('function' in tc) || tc.function.name !== 'search_drug') continue;

                const toolMsg = messages.find(
                    (m) => m.role === 'tool' && (m as OpenAI.Chat.ChatCompletionToolMessageParam).tool_call_id === tc.id,
                ) as OpenAI.Chat.ChatCompletionToolMessageParam | undefined;

                if (!toolMsg) continue;

                try {
                    const parsed = JSON.parse(toolMsg.content as string);

                    // Direct array (normal search result)
                    if (Array.isArray(parsed) && parsed.length > 0) return parsed;

                    // Wrapped reused result: { reused_results: [...], instruction: '...' }
                    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.reused_results) && parsed.reused_results.length > 0) {
                        return parsed.reused_results;
                    }
                } catch {
                    continue;
                }
            }
        }
        return null;
    }
    private isRedundantDrugSearch(
        newQuery: string,
        previousResults: Array<Record<string, unknown>>,
    ): boolean {
        const q = newQuery.toLowerCase().trim();
        if (!q) return false;

        // Only block if the new query is a vague single-word brand root
        // that would return a broader/less specific result than we already have.
        // e.g. searching "panadol" when we already have "panadol extra 48" results → block
        // but allow "panadol extra optizorb" even if we have "panadol extra" results → allow
        const queryWords = q.split(/\s+/).filter(w => w.length > 2);
        if (queryWords.length > 2) return false; // specific query → always allow

        return previousResults.some((r) => {
            const brand = String(r.brand_name ?? '').toLowerCase();
            const firstWord = brand.split(' ')[0] ?? '';
            // Block only if query is a root word already covered by previous results
            return firstWord.length > 2 && q === firstWord;
        });
    }
}