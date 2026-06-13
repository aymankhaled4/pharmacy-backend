import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from '../openai.service';

const ALLOWED_FIELDS = new Set([
    'drug_name',
    'batch_number',
    'quantity',
    'expiry_date',
    'selling_price',
    'discount_percent',
]);

@Injectable()
export class ColumnMapperService {
    private readonly model: string;

    constructor(
        private readonly openAi: OpenAiService,
        private readonly config: ConfigService,
    ) {
        this.model = this.config.get<string>('openai.model') ?? 'gpt-4o-mini';
    }

    async mapColumns(headers: string[]): Promise<Record<string, string>> {
        if (headers.length === 0) return {};

        const prompt = [
            'You are a data mapping assistant for a pharmacy inventory system.',
            'Map each of the following Excel column headers to one of these standard field names:',
            'drug_name, batch_number, quantity, expiry_date, selling_price, discount_percent',
            '',
            'Rules:',
            '- Only use the exact field names listed above.',
            '- If a header does not match any field, omit it.',
            '- Return a flat JSON object: { "<original_header>": "<field_name>", ... }',
            '',
            `Headers to map: ${JSON.stringify(headers)}`,
        ].join('\n');

        const response = await this.openAi.chat({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        });

        let raw: Record<string, unknown> = {};
        try {
            const content = response.choices[0]?.message?.content ?? '{}';
            raw = JSON.parse(content) as Record<string, unknown>;
        } catch {
            return {};
        }

        const validated: Record<string, string> = {};
        for (const [header, fieldName] of Object.entries(raw)) {
            if (typeof fieldName === 'string' && ALLOWED_FIELDS.has(fieldName)) {
                validated[header] = fieldName;
            }
        }

        return validated;
    }
}
