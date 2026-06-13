import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ExcelImportService } from './excel-import.service';
import { ImportResult } from './dto/import-result.dto';

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
        await job.progress(10);

        const buffer = Buffer.from(job.data.bufferBase64, 'base64');
        const result = await this.importService.processFile(buffer, job.data.pharmacyId);

        await job.progress(100);

        return result;
    }
}
