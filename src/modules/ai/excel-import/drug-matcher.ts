import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from '../openai.service';

export interface DrugCandidate {
    id: string;
    brand_name: string;
    brand_name_ar: string;
    generic_name: string;
    active_ingredient: string;
}

export interface GeneratedDrug {
    brand_name: string;
    generic_name: string;
    active_ingredient: string;
    category: string;
    strength: string;
    dosage_form: string;
    manufacturer: string;
}

const RETRY_DELAYS_MS = [3000, 6000, 12000]; // wait before each retry

@Injectable()
export class DrugMatcherService {
    private readonly model: string;

    constructor(
        private readonly openAi: OpenAiService,
        private readonly config: ConfigService,
    ) {
        this.model = this.config.get<string>('openai.model') ?? 'gpt-4o-mini';
    }

    // ─── helpers ────────────────────────────────────────────────────────────────

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private is429(err: unknown): boolean {
        if (err instanceof Error) {
            return (
                err.message.includes('429') ||
                err.message.toLowerCase().includes('rate') ||
                err.message.toLowerCase().includes('quota')
            );
        }
        return false;
    }

    private async chatWithRetry(
        params: Parameters<OpenAiService['chat']>[0],
    ): ReturnType<OpenAiService['chat']> {
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
            try {
                return await this.openAi.chat(params);
            } catch (err) {
                const isLast = attempt === RETRY_DELAYS_MS.length;
                if (this.is429(err) && !isLast) {
                    await this.sleep(RETRY_DELAYS_MS[attempt]);
                    continue;
                }
                throw err;
            }
        }
        // unreachable — TypeScript needs this
        throw new Error('Exhausted retries');
    }

    // ─── verify ─────────────────────────────────────────────────────────────────

    async verify(drugName: string, candidates: DrugCandidate[]): Promise<string | null> {
        if (candidates.length === 0) return null;

        const prompt = [
            'You are a pharmacist reviewing drug records.',
            '',
            `The pharmacist uploaded a drug named: "${drugName}"`,
            '',
            'Below are existing drug records from our database:',
            JSON.stringify(
                candidates.map((c) => ({
                    id: c.id,
                    brand_name: c.brand_name,
                    brand_name_ar: c.brand_name_ar,
                    generic_name: c.generic_name,
                    active_ingredient: c.active_ingredient,
                })),
                null,
                2,
            ),
            '',
            'Your task: decide if the uploaded drug name refers to the SAME drug as any record above.',
            '',
            'Rules:',
            '- Ignore differences in UPPERCASE/lowercase (e.g. "Amlodipine" = "AMLODIPINE")',
            '- Ignore minor formatting differences (e.g. "10mg" = "10MG", "tab" = "TABS." = "TABLETS")',
            '- Ignore extra words like "Imported", pack size differences unless the strength is different',
            '- DO NOT match if the active ingredient or strength is clearly different',
            '- A human pharmacist reading both names would say: "yes, this is the same drug"',
            '',
            'Return ONLY valid JSON:',
            'If match found:  { "matched": true,  "drug_id": "<id from the list above>" }',
            'If no match:     { "matched": false, "drug_id": null }',
        ].join('\n');

        try {
            const response = await this.chatWithRetry({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0]?.message?.content ?? '{}';
            const parsed = JSON.parse(content) as { matched?: boolean; drug_id?: string | null };

            if (!parsed.matched || !parsed.drug_id) return null;

            // guard against hallucinated IDs
            const validIds = new Set(candidates.map((c) => c.id));
            if (!validIds.has(parsed.drug_id)) return null;

            return parsed.drug_id;
        } catch {
            return null;
        }
    }

    // ─── generate ───────────────────────────────────────────────────────────────

    async generate(drugName: string): Promise<GeneratedDrug> {
        const prompt = [
            'You are a pharmaceutical data assistant.',
            `Generate a complete drug record for: "${drugName}"`,
            '',
            'Return a JSON object with exactly these 7 fields:',
            '- brand_name: string',
            '- generic_name: string',
            '- active_ingredient: string (MUST be UPPERCASE, use "+" to separate combinations)',
            '- category: string',
            '- strength: string',
            '- dosage_form: string',
            '- manufacturer: string',
            '',
            'Use "Unknown" for any field you cannot determine.',
            'Return only valid JSON.',
        ].join('\n');

        const response = await this.chatWithRetry({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(content) as Partial<GeneratedDrug>;

        return {
            brand_name: parsed.brand_name ?? 'Unknown',
            generic_name: parsed.generic_name ?? 'Unknown',
            active_ingredient: (parsed.active_ingredient ?? 'Unknown').toUpperCase(),
            category: parsed.category ?? 'Unknown',
            strength: parsed.strength ?? 'Unknown',
            dosage_form: parsed.dosage_form ?? 'Unknown',
            manufacturer: parsed.manufacturer ?? 'Unknown',
        };
    }
}
