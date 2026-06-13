import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { SupabaseService } from '../../../database/supabase.service';

@Injectable()
export class ChatExecutor {
    constructor(private readonly supabase: SupabaseService) { }

    async execute(
        toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
        userLocation: { lat?: number; lng?: number },
    ): Promise<OpenAI.Chat.ChatCompletionToolMessageParam> {
        const tool_call_id = toolCall.id;

        // Only function-type tool calls have a .function property
        if (!('function' in toolCall)) {
            return this.toolMessage(tool_call_id, {
                error: `Unsupported tool call type`,
            });
        }

        const fn = toolCall.function;

        try {
            let args: Record<string, unknown>;
            try {
                args = JSON.parse(fn.arguments) as Record<string, unknown>;
            } catch {
                return this.toolMessage(tool_call_id, { error: 'Invalid tool arguments JSON' });
            }

            let result: unknown;

            if (fn.name === 'search_drug') {
                result = await this.searchDrug(args.query as string);
            } else if (fn.name === 'find_nearby_pharmacies') {
                result = await this.findNearbyPharmacies(args, userLocation);
            } else if (fn.name === 'find_alternatives') {
                result = await this.findAlternatives(args.active_ingredient as string);
            } else {
                return this.toolMessage(tool_call_id, {
                    error: `Unknown tool: ${fn.name}`,
                });
            }

            return this.toolMessage(tool_call_id, result);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return this.toolMessage(tool_call_id, { error: message });
        }
    }

    private async searchDrug(query: string): Promise<unknown> {
        const { data, error } = await this.supabase.adminClient.rpc('search_drugs', {
            p_query: query,
        });

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    private async findNearbyPharmacies(
        args: Record<string, unknown>,
        userLocation: { lat?: number; lng?: number },
    ): Promise<unknown> {
        const drug_id = args.drug_id as string;
        const lat = (args.lat as number | undefined) ?? userLocation.lat;
        const lng = (args.lng as number | undefined) ?? userLocation.lng;
        const radius_km = (args.radius_km as number | undefined) ?? 10;

        const { data, error } = await this.supabase.adminClient.rpc(
            'search_nearby_pharmacies',
            { drug_id, lat, lng, radius_km },
        );

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    private async findAlternatives(activeIngredient: string): Promise<unknown> {
        const { data, error } = await this.supabase.adminClient
            .from('drugs')
            .select('id, brand_name, brand_name_ar, generic_name, active_ingredient, strength, dosage_form')
            .ilike('active_ingredient', `%${activeIngredient}%`)
            .limit(10);

        if (error) throw new Error(error.message);
        return data ?? [];
    }

    private toolMessage(
        tool_call_id: string,
        result: unknown,
    ): OpenAI.Chat.ChatCompletionToolMessageParam {
        return {
            role: 'tool',
            tool_call_id,
            content: JSON.stringify(result),
        };
    }
}
