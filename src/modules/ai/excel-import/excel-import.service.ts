import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../database/supabase.service';
import { ExcelParser } from './excel-parser';
import { ColumnMapperService } from './column-mapper';
import { DrugMatcherService } from './drug-matcher';
import { preMatch } from './drug-name-matcher';
import { ImportResult, RowResult } from './dto/import-result.dto';

export interface PreparedImport {
    normalizedRows: ReturnType<typeof ExcelParser.normalize>[];
    rawRows: Record<string, unknown>[];
}

@Injectable()
export class ExcelImportService {
    constructor(
        private readonly supabase: SupabaseService,
        private readonly columnMapper: ColumnMapperService,
        private readonly drugMatcher: DrugMatcherService,
    ) { }

    // ─── Full pipeline (used for sync small files) ────────────────────────────

    async processFile(buffer: Buffer, pharmacyId: string): Promise<ImportResult> {
        const { headers, rows } = ExcelParser.parse(buffer);

        if (rows.length === 0) {
            return { matched: 0, autoCreated: 0, failed: 0, total: 0, rows: [] };
        }

        const fieldMap = await this.columnMapper.mapColumns(headers);
        const normalizedRows = rows.map((r) => ExcelParser.normalize(r, fieldMap));

        const rowResults: RowResult[] = [];
        let matched = 0;
        let autoCreated = 0;
        let failed = 0;

        for (let i = 0; i < normalizedRows.length; i++) {
            const result = await this.processRow(normalizedRows[i], rows[i], i, pharmacyId);
            rowResults.push(result);
            if (result.status === 'matched') matched++;
            else if (result.status === 'auto_created') autoCreated++;
            else failed++;
        }

        return { matched, autoCreated, failed, total: rowResults.length, rows: rowResults };
    }

    // ─── Step 1: parse + column mapping only (used by queue processor) ───────

    async prepare(buffer: Buffer): Promise<PreparedImport | null> {
        const { headers, rows } = ExcelParser.parse(buffer);
        if (rows.length === 0) return null;

        const fieldMap = await this.columnMapper.mapColumns(headers);
        const normalizedRows = rows.map((r) => ExcelParser.normalize(r, fieldMap));

        return { normalizedRows, rawRows: rows };
    }

    // ─── Step 2: process a single row (used by queue processor for progress) ──

    async processRow(
        normalized: ReturnType<typeof ExcelParser.normalize>,
        rawRow: Record<string, unknown>,
        index: number,
        pharmacyId: string,
    ): Promise<RowResult> {
        const drugName =
            normalized.drug_name ??
            (rawRow[Object.keys(rawRow)[0]] as string | undefined) ??
            `Row ${index + 1}`;

        try {
            if (!normalized.drug_name) {
                return { drugName, status: 'failed', error: 'Missing drug_name' };
            }
            if (!normalized.quantity || normalized.quantity <= 0) {
                return { drugName, status: 'failed', error: 'quantity must be > 0' };
            }
            if (!normalized.selling_price || normalized.selling_price <= 0) {
                return { drugName, status: 'failed', error: 'selling_price must be > 0' };
            }

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

            const top3Normalised = top3.map((d: any) => ({
                id: d.id ?? d.drug_id,
                brand_name: d.brand_name,
                brand_name_ar: d.brand_name_ar,
                generic_name: d.generic_name,
                active_ingredient: d.active_ingredient,
            }));

            const allCandidatesNormalised = (candidates ?? []).map((d: any) => ({
                id: d.id ?? d.drug_id,
                brand_name: d.brand_name,
            }));
            const preMatchedId = preMatch(normalized.drug_name, allCandidatesNormalised);
            const matchedId = preMatchedId ?? await this.drugMatcher.verify(normalized.drug_name, top3Normalised);

            if (matchedId) {
                await this.insertInventory(matchedId, pharmacyId, normalized);
                return { drugName: normalized.drug_name, status: 'matched', drugId: matchedId };
            }

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
            return { drugName: normalized.drug_name, status: 'auto_created', drugId: newDrugId };

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { drugName, status: 'failed', error: message };
        }
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private async insertInventory(
        drugId: string,
        pharmacyId: string,
        row: ReturnType<typeof ExcelParser.normalize>,
    ): Promise<void> {
        // Upsert logic:
        //   - same drug_id + pharmacy_id + batch_number (non-null) → update quantity/price/expiry
        //   - same drug_id + pharmacy_id + batch_number = null     → update (partial unique index)
        //   - different batch_number                               → insert new row
        const { error } = await this.supabase.adminClient
            .from('inventory')
            .upsert(
                {
                    drug_id: drugId,
                    pharmacy_id: pharmacyId,
                    batch_number: row.batch_number ?? null,
                    quantity: row.quantity!,
                    selling_price: row.selling_price!,
                    expiry_date: row.expiry_date ?? null,
                    discount_percent: row.discount_percent ?? 0,
                    status: 'active',
                },
                {
                    onConflict: 'drug_id,pharmacy_id,batch_number',
                    ignoreDuplicates: false,
                },
            );

        if (error) throw new Error(error.message);
    }
}
