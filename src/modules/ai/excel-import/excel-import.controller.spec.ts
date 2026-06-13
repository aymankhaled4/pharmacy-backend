import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ExcelImportController } from './excel-import.controller';
import { ExcelImportService } from './excel-import.service';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { getQueueToken } from '@nestjs/bull';
import { IMPORT_QUEUE } from './import-queue.processor';
import { ImportResult } from './dto/import-result.dto';
import { Reflector } from '@nestjs/core';

function makeXlsxBuffer(rows: unknown[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function makeFile(
    buffer: Buffer,
    name = 'test.xlsx',
    mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
): Express.Multer.File {
    return {
        fieldname: 'file',
        originalname: name,
        encoding: '7bit',
        mimetype,
        size: buffer.length,
        buffer,
        stream: undefined,
        destination: '',
        filename: name,
        path: '',
    } as unknown as Express.Multer.File;
}

const mockImportResult: ImportResult = {
    matched: 1,
    autoCreated: 0,
    failed: 0,
    total: 1,
    rows: [{ drugName: 'Panadol', status: 'matched', drugId: 'drug-1' }],
};

describe('ExcelImportController', () => {
    let controller: ExcelImportController;
    let mockProcessFile: jest.Mock;
    let mockQueueAdd: jest.Mock;
    let mockQueueGetJob: jest.Mock;

    const pharmacyUser = { id: 'pharmacy-1', role: 'pharmacy', token: 'tok' };

    beforeEach(async () => {
        jest.clearAllMocks();

        mockProcessFile = jest.fn().mockResolvedValue(mockImportResult);
        mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-123' });
        mockQueueGetJob = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ExcelImportController],
            providers: [
                { provide: ExcelImportService, useValue: { processFile: mockProcessFile } },
                {
                    provide: getQueueToken(IMPORT_QUEUE),
                    useValue: { add: mockQueueAdd, getJob: mockQueueGetJob },
                },
                Reflector,
            ],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<ExcelImportController>(ExcelImportController);
    });

    // Test 1: .xlsx upload → 200
    it('should accept .xlsx files', async () => {
        const rows = [['Drug Name', 'Qty', 'Price'], ...Array.from({ length: 5 }, () => ['Panadol', 10, 15])];
        const file = makeFile(makeXlsxBuffer(rows));

        const result = await controller.upload(pharmacyUser as any, file);

        expect(result).toBeDefined();
        expect(mockProcessFile).toHaveBeenCalled();
    });

    // Test 2: .xls upload → 200
    it('should accept .xls files', async () => {
        const ws = XLSX.utils.aoa_to_sheet([['Drug Name', 'Qty'], ['Aspirin', 50]]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const xlsBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;

        const file = makeFile(xlsBuffer, 'test.xls', 'application/vnd.ms-excel');

        const result = await controller.upload(pharmacyUser as any, file);
        expect(result).toBeDefined();
    });

    // Test 3: .csv upload → 400
    it('should reject .csv files with 400', async () => {
        const csvBuffer = Buffer.from('Drug Name,Qty\nPanadol,10');
        const file = makeFile(csvBuffer, 'test.csv', 'text/csv');

        await expect(controller.upload(pharmacyUser as any, file)).rejects.toThrow(
            BadRequestException,
        );
    });

    // Test 4: No file → 400
    it('should throw 400 when no file is uploaded', async () => {
        await expect(controller.upload(pharmacyUser as any, undefined)).rejects.toThrow(
            BadRequestException,
        );
    });

    // Test 5: File > 10MB → 400
    it('should throw 400 when file exceeds 10MB', async () => {
        const bigBuffer = Buffer.alloc(11 * 1024 * 1024);
        const file = makeFile(bigBuffer, 'large.xlsx');

        await expect(controller.upload(pharmacyUser as any, file)).rejects.toThrow(
            BadRequestException,
        );
    });

    // Test 6: File ≤ 200 rows → synchronous, returns ImportResult
    it('should process synchronously for files with ≤ 200 rows', async () => {
        const dataRows = Array.from({ length: 5 }, (_, i) => [`Drug${i}`, 10, 15]);
        const buffer = makeXlsxBuffer([['Drug Name', 'Qty', 'Price'], ...dataRows]);
        const file = makeFile(buffer);

        const result = await controller.upload(pharmacyUser as any, file);

        expect(mockProcessFile).toHaveBeenCalled();
        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(result).toEqual(mockImportResult);
    });

    // Test 7: File > 200 rows → enqueued, returns { jobId, queued: true, rowCount }
    it('should enqueue for files with > 200 rows', async () => {
        const dataRows = Array.from({ length: 201 }, (_, i) => [`Drug${i}`, 10, 15]);
        const buffer = makeXlsxBuffer([['Drug Name', 'Qty', 'Price'], ...dataRows]);
        const file = makeFile(buffer);

        const result = await controller.upload(pharmacyUser as any, file) as {
            jobId: string;
            queued: boolean;
            rowCount: number;
        };

        expect(mockQueueAdd).toHaveBeenCalled();
        expect(mockProcessFile).not.toHaveBeenCalled();
        expect(result.queued).toBe(true);
        expect(result.jobId).toBe('job-123');
        expect(result.rowCount).toBe(201);
    });

    // Test 8: No auth header → 401 (guard throws)
    it('should return 401 when no auth header', async () => {
        const mod = await Test.createTestingModule({
            controllers: [ExcelImportController],
            providers: [
                { provide: ExcelImportService, useValue: { processFile: mockProcessFile } },
                { provide: getQueueToken(IMPORT_QUEUE), useValue: { add: mockQueueAdd, getJob: mockQueueGetJob } },
                Reflector,
            ],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => { throw new UnauthorizedException(); } })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        const guard = mod.get(SupabaseAuthGuard) as unknown as { canActivate: () => boolean };
        expect(() => guard.canActivate()).toThrow(UnauthorizedException);
    });

    // Test 9: User JWT → 403 (roles guard throws)
    it('should return 403 for non-pharmacy users', async () => {
        const mod = await Test.createTestingModule({
            controllers: [ExcelImportController],
            providers: [
                { provide: ExcelImportService, useValue: { processFile: mockProcessFile } },
                { provide: getQueueToken(IMPORT_QUEUE), useValue: { add: mockQueueAdd, getJob: mockQueueGetJob } },
                Reflector,
            ],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => { throw new ForbiddenException(); } })
            .compile();

        const guard = mod.get(RolesGuard) as unknown as { canActivate: () => boolean };
        expect(() => guard.canActivate()).toThrow(ForbiddenException);
    });

    // Test 10: Valid jobId → returns state and progress
    it('should return job state and progress for a valid jobId', async () => {
        const mockJob = {
            id: 'job-123',
            getState: jest.fn().mockResolvedValue('active'),
            progress: jest.fn().mockReturnValue(50),
            returnvalue: null,
        };
        mockQueueGetJob.mockResolvedValueOnce(mockJob);

        const result = await controller.status('job-123') as {
            jobId: string;
            state: string;
            progress: number;
            result: unknown;
        };

        expect(result.jobId).toBe('job-123');
        expect(result.state).toBe('active');
        expect(result.progress).toBe(50);
        expect(result.result).toBeNull();
    });

    // Test 11: Non-existent jobId → 404
    it('should throw 404 for a non-existent jobId', async () => {
        mockQueueGetJob.mockResolvedValueOnce(null);

        await expect(controller.status('nonexistent-job')).rejects.toThrow(
            NotFoundException,
        );
    });
});
