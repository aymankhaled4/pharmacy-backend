import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ExcelImportService } from './excel-import.service';
import { ImportResult, RowResult } from './dto/import-result.dto';

export const IMPORT_QUEUE = 'excel-import';

/** Default job options applied to all jobs added to this queue */
export const IMPORT_JOB_OPTIONS = { attempts: 3 };

export interface ImportJobData {
    pharmacyId: string;
    bufferBase64: string;
}

@Processor(IMPORT_QUEUE)
export class ImportQueueProcessor {
    constructor(private readonly importService: ExcelImportService) { }

    @Process()
    async handle(job: Job<ImportJobData>): Promise<ImportResult> {
        // 5% — job picked up
        await job.progress(5);

        const buffer = Buffer.from(job.data.bufferBase64, 'base64');

        // Parse + column mapping (AI call)
        const prepared = await this.importService.prepare(buffer);

        if (!prepared) {
            await job.progress(100);
            return { matched: 0, autoCreated: 0, failed: 0, total: 0, rows: [] };
        }

        // 15% — parsing + column mapping done
        await job.progress(15);

        const { normalizedRows, rawRows } = prepared;
        const total = normalizedRows.length;

        const rowResults: RowResult[] = [];
        let matched = 0;
        let autoCreated = 0;
        let failed = 0;

        for (let i = 0; i < total; i++) {
            const result = await this.importService.processRow(
                normalizedRows[i],
                rawRows[i],
                i,
                job.data.pharmacyId,
            );

            rowResults.push(result);
            if (result.status === 'matched') matched++;
            else if (result.status === 'auto_created') autoCreated++;
            else failed++;

            // Progress: 15% → 95% distributed across all rows
            const rowProgress = 15 + Math.round(((i + 1) / total) * 80);
            await job.progress(rowProgress);
        }

        // 100% — done
        await job.progress(100);

        return { matched, autoCreated, failed, total: rowResults.length, rows: rowResults };
    }
}
