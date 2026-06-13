import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../../database/supabase.service';

@Injectable()
export class SearchLogsService {
    constructor(private readonly supabase: SupabaseService) { }

    /**
     * Creates a new search_log row and returns the generated UUID.
     */
    async create(params: {
        userId?: string;
        query: string;
        latitude?: number;
        longitude?: number;
    }): Promise<string> {
        const { data, error } = await this.supabase.adminClient
            .from('search_logs')
            .insert({
                user_id: params.userId ?? null,
                query: params.query,
                latitude: params.latitude ?? null,
                longitude: params.longitude ?? null,
            })
            .select('id')
            .single();

        if (error) {
            throw new InternalServerErrorException(
                `Failed to create search log: ${error.message}`,
            );
        }

        return (data as { id: string }).id;
    }

    /**
     * Updates resolved_ingredient and result_found on an existing search_log row.
     */
    async updateResolved(
        searchId: string,
        resolvedIngredient: string,
        resultFound: boolean,
    ): Promise<void> {
        const { error } = await this.supabase.adminClient
            .from('search_logs')
            .update({
                resolved_ingredient: resolvedIngredient,
                result_found: resultFound,
            })
            .eq('id', searchId);

        if (error) {
            throw new InternalServerErrorException(
                `Failed to update search log: ${error.message}`,
            );
        }
    }

    /**
     * Inserts ai_suggestions rows for a given search_log.
     * No-ops silently when the array is empty.
     */
    async createSuggestions(
        searchId: string,
        suggestions: Array<{
            drugId: string;
            reason: string;
            confidenceScore: number;
        }>,
    ): Promise<void> {
        if (suggestions.length === 0) return;

        const rows = suggestions.map((s) => ({
            search_id: searchId,
            suggested_drug_id: s.drugId,
            reason: s.reason,
            confidence_score: s.confidenceScore,
        }));

        const { error } = await this.supabase.adminClient
            .from('ai_suggestions')
            .insert(rows);

        if (error) {
            throw new InternalServerErrorException(
                `Failed to create AI suggestions: ${error.message}`,
            );
        }
    }
}
