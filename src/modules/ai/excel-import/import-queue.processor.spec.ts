import { ImportQueueProcessor, IMPORT_QUEUE, IMPORT_JOB_OPTIONS, ImportJobData } from './import-queue.processor';
import { ExcelImportService } from './excel-import.service';
import { ImportResult } from './dto/import-result.dto';
import { Job } from 'bull';

function makeJob(data: ImportJobData): jest.Mocked<Job<ImportJobData>> {
    return {
        data,
        progress: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Job<ImportJobData>>;
}

describe('ImportQueueProcessor', () => {
    let processor: ImportQueueProcessor;
    let mockProcessFile: jest.Mock;

    const mockResult: ImportResult = {
        matched: 2,
        autoCreated: 1,
        failed: 0,
        total: 3,
        rows: [],
    };

    beforeEach(() => {
        mockProcessFile = jest.fn().mockResolvedValue(mockResult);
        const mockService = { processFile: mockProcessFile } as unknown as ExcelImportService;
        processor = new ImportQueueProcessor(mockService);
    });

    // Test 1: Job processes and returns ImportResult
    it('should process job and return ImportResult', async () => {
        const originalBuffer = Buffer.from('fake-excel-content');
        const base64 = originalBuffer.toString('base64');
        const job = makeJob({ pharmacyId: 'ph-1', bufferBase64: base64 });

        const result = await processor.handle(job);

        expect(result).toEqual(mockResult);
        expect(mockProcessFile).toHaveBeenCalledTimes(1);
    });

    // Test 2: updateProgress(10) called at start, updateProgress(100) at end
    it('should call progress(10) at start and progress(100) at end', async () => {
        const originalBuffer = Buffer.from('content');
        const job = makeJob({
            pharmacyId: 'ph-1',
            bufferBase64: originalBuffer.toString('base64'),
        });

        await processor.handle(job);

        expect(job.progress).toHaveBeenNthCalledWith(1, 10);
        expect(job.progress).toHaveBeenNthCalledWith(2, 100);
    });

    // Test 3: Base64 string decoded to correct original Buffer
    it('should decode base64 to the original Buffer and pass to service', async () => {
        const originalContent = 'test-excel-binary-data';
        const originalBuffer = Buffer.from(originalContent);
        const base64 = originalBuffer.toString('base64');

        const job = makeJob({ pharmacyId: 'ph-1', bufferBase64: base64 });

        await processor.handle(job);

        const passedBuffer = mockProcessFile.mock.calls[0][0] as Buffer;
        expect(passedBuffer.toString()).toBe(originalContent);
    });

    // Test 4: Queue configured with attempts: 3 via exported job options constant
    it('should export IMPORT_JOB_OPTIONS with attempts: 3 for retry configuration', () => {
        expect(IMPORT_JOB_OPTIONS.attempts).toBe(3);
    });
});
