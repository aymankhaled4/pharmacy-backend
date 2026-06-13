import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../database/supabase.service';
import { ExcelParser } from './excel-parser';
import { ColumnMapperService } from './column-mapper';
import { DrugMatcherService } from './drug-matcher';
import { preMatch } from './drug-name-matcher';
import { ImportResult, RowResult } from './dto/import-result.dto';

@Injectable()
export class ExcelImportService {
    constructor(
        private readonly supabase: SupabaseService,
        private readonly columnMapper: ColumnMapperService,
        private readonly drugMatcher: DrugMatcherService,
    ) { }

    async processFile(buffer: Buffer, pharmacyId: string): Promise<ImportResult> {
        // Step 1 — parse
        const { headers, rows } = ExcelParser.parse(buffer);

        // Step 2 — empty file
        if (rows.length === 0) {
            return { matched: 0, autoCreated: 0, failed: 0, total: 0, rows: [] };
        }

        // Step 3 — map columns once
        const fieldMap = await this.columnMapper.mapColumns(headers);

        // Step 4 — normalize all rows
        const normalizedRows = rows.map((r) => ExcelParser.normalize(r, fieldMap));

        // Step 5 — process each row sequentially
        const rowResults: RowResult[] = [];
        let matched = 0;
        let autoCreated = 0;
        let failed = 0;

        for (let i = 0; i < normalizedRows.length; i++) {
            const normalized = normalizedRows[i];
            const rawRow = rows[i];
            // Best-effort drugName from normalized or raw values
            const drugName =
                normalized.drug_name ??
                (rawRow[Object.keys(rawRow)[0]] as string | undefined) ??
                `Row ${i + 1}`;

            try {
                // Validate required fields
                if (!normalized.drug_name) {
                    rowResults.push({ drugName, status: 'failed', error: 'Missing drug_name' });
                    failed++;
                    continue;
                }
                if (!normalized.quantity || normalized.quantity <= 0) {
                    rowResults.push({ drugName, status: 'failed', error: 'quantity must be > 0' });
                    failed++;
                    continue;
                }
                if (!normalized.selling_price || normalized.selling_price <= 0) {
                    rowResults.push({ drugName, status: 'failed', error: 'selling_price must be > 0' });
                    failed++;
                    continue;
                }

                // Search candidates (top 20 from RPC)
                const { data: candidates, error: searchError } =
                    await this.supabase.adminClient.rpc('search_drugs', {
                        p_query: normalized.drug_name,
                    });

                if (searchError) throw new Error(searchError.message);

                const top3 = (candidates ?? []).slice(0, 3) as Array<{
                    id: string;
                    brand_name: string;
                    brand_name_ar: string;
                    generic_name: string;
                    active_ingredient: string;
                }>;

                // Normalise: RPC returns drug_id, DrugMatcherService expects id
                const top3Normalised = top3.map((d: any) => ({
                    id: d.id ?? d.drug_id,
                    brand_name: d.brand_name,
                    brand_name_ar: d.brand_name_ar,
                    generic_name: d.generic_name,
                    active_ingredient: d.active_ingredient,
                }));

                // Step 1 — Pre-match using string normalization (no AI call)
                const allCandidatesNormalised = (candidates ?? []).map((d: any) => ({
                    id: d.id ?? d.drug_id,
                    brand_name: d.brand_name,
                }));
                const preMatchedId = preMatch(normalized.drug_name, allCandidatesNormalised);

                // Step 2 — Fall back to AI only if pre-match failed
                const matchedId = preMatchedId ?? await this.drugMatcher.verify(normalized.drug_name, top3Normalised);

                if (matchedId) {
                    // Insert into inventory
                    await this.insertInventory(matchedId, pharmacyId, normalized);
                    rowResults.push({ drugName: normalized.drug_name, status: 'matched', drugId: matchedId });
                    matched++;
                } else {
                    // Auto-create drug record
                    const generated = await this.drugMatcher.generate(normalized.drug_name);

                    const { data: newDrug, error: drugInsertError } =
                        await this.supabase.adminClient
                            .from('drugs')
                            .insert({
                                brand_name: generated.brand_name,
                                generic_name: generated.generic_name,
                                active_ingredient: generated.active_ingredient,
                                category: generated.category,
                                strength: generated.strength,
                                dosage_form: generated.dosage_form,
                                manufacturer: generated.manufacturer,
                            })
                            .select('id')
                            .single();

                    if (drugInsertError) throw new Error(drugInsertError.message);

                    const newDrugId = (newDrug as { id: string }).id;
                    await this.insertInventory(newDrugId, pharmacyId, normalized);
                    rowResults.push({ drugName: normalized.drug_name, status: 'auto_created', drugId: newDrugId });
                    autoCreated++;
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                rowResults.push({ drugName, status: 'failed', error: message });
                failed++;
            }
        }

        return {
            matched,
            autoCreated,
            failed,
            total: rowResults.length,
            rows: rowResults,
        };
    }

    private async insertInventory(
        drugId: string,
        pharmacyId: string,
        row: ReturnType<typeof ExcelParser.normalize>,
    ): Promise<void> {
        const { error } = await this.supabase.adminClient.from('inventory').insert({
            drug_id: drugId,
            pharmacy_id: pharmacyId,
            quantity: row.quantity!,
            selling_price: row.selling_price!,
            discount_percent: row.discount_percent ?? 0,
            batch_number: row.batch_number ?? null,
            expiry_date: row.expiry_date ?? null,
            status: 'active',
        });

        if (error) throw new Error(error.message);
    }
}
