import { Test, TestingModule } from '@nestjs/testing';
import * as XLSX from 'xlsx';
import { ExcelImportService } from './excel-import.service';
import { SupabaseService } from '../../../database/supabase.service';
import { ColumnMapperService } from './column-mapper';
import { DrugMatcherService } from './drug-matcher';

/** Build an in-memory .xlsx buffer */
function makeXlsx(rows: unknown[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Empty (zero-byte) buffer */
const emptyBuffer = Buffer.from([]);

describe('ExcelImportService', () => {
    let service: ExcelImportService;
    let mockRpc: jest.Mock;
    let mockFrom: jest.Mock;
    let mockMapColumns: jest.Mock;
    let mockVerify: jest.Mock;
    let mockGenerate: jest.Mock;

    // We rebuild the mock chains freshly in each test
    const buildSupabaseMock = () => {
        const mockInventoryInsert = jest.fn();
        const mockDrugSingle = jest.fn();
        const mockDrugInsertSelect = jest.fn().mockReturnValue({ single: mockDrugSingle });
        const mockDrugInsert = jest.fn().mockReturnValue({ select: mockDrugInsertSelect });

        mockFrom = jest.fn().mockImplementation((table: string) => {
            if (table === 'inventory') return { insert: mockInventoryInsert };
            if (table === 'drugs') return { insert: mockDrugInsert };
            return {};
        });

        mockRpc = jest.fn();

        return {
            adminClient: { rpc: mockRpc, from: mockFrom },
            _mockInventoryInsert: mockInventoryInsert,
            _mockDrugSingle: mockDrugSingle,
        };
    };

    let mocks: ReturnType<typeof buildSupabaseMock>;

    beforeEach(async () => {
        jest.clearAllMocks();
        mocks = buildSupabaseMock();

        mockMapColumns = jest.fn();
        mockVerify = jest.fn();
        mockGenerate = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExcelImportService,
                { provide: SupabaseService, useValue: mocks },
                {
                    provide: ColumnMapperService,
                    useValue: { mapColumns: mockMapColumns },
                },
                {
                    provide: DrugMatcherService,
                    useValue: { verify: mockVerify, generate: mockGenerate },
                },
            ],
        }).compile();

        service = module.get<ExcelImportService>(ExcelImportService);
    });

    // Test 1: Empty Excel file returns zeroed ImportResult
    it('should return zeroed ImportResult for an empty file', async () => {
        const result = await service.processFile(emptyBuffer, 'pharmacy-1');

        expect(result).toEqual({ matched: 0, autoCreated: 0, failed: 0, total: 0, rows: [] });
        expect(mockMapColumns).not.toHaveBeenCalled();
    });

    // Test 2: Matched row → status: 'matched', inventory inserted
    it('should insert inventory with matched drug_id for a matched row', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 50, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [{ id: 'drug-1', brand_name: 'Panadol', brand_name_ar: 'بانادول', generic_name: 'Paracetamol', active_ingredient: 'PARACETAMOL' }], error: null });
        mockVerify.mockResolvedValueOnce('drug-1');
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.matched).toBe(1);
        expect(result.rows[0].status).toBe('matched');
        expect(result.rows[0].drugId).toBe('drug-1');
        expect(mocks._mockInventoryInsert).toHaveBeenCalledWith(
            expect.objectContaining({ drug_id: 'drug-1', pharmacy_id: 'pharmacy-1' }),
        );
    });

    // Test 3: Unmatched row → status: 'auto_created', drug + inventory inserted
    it('should auto_create a new drug record when no match found', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['BrandNewDrug', 10, 25.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [], error: null });
        mockVerify.mockResolvedValueOnce(null);
        mockGenerate.mockResolvedValueOnce({
            brand_name: 'BrandNewDrug',
            generic_name: 'Generic',
            active_ingredient: 'UNKNOWN',
            category: 'Unknown',
            strength: 'Unknown',
            dosage_form: 'Tablet',
            manufacturer: 'Unknown',
        });
        mocks._mockDrugSingle.mockResolvedValueOnce({ data: { id: 'new-drug-id' }, error: null });
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.autoCreated).toBe(1);
        expect(result.rows[0].status).toBe('auto_created');
        expect(result.rows[0].drugId).toBe('new-drug-id');
    });

    // Test 4: Row missing drug_name → status: 'failed'
    it('should fail a row with missing drug_name', async () => {
        const buffer = makeXlsx([
            ['Qty', 'Price'],
            [100, 20.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Qty': 'quantity',
            'Price': 'selling_price',
        });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.failed).toBe(1);
        expect(result.rows[0].status).toBe('failed');
    });

    // Test 5: Row with quantity = 0 → status: 'failed'
    it('should fail a row with quantity = 0', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 0, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.failed).toBe(1);
        expect(result.rows[0].status).toBe('failed');
    });

    // Test 6: Row with invalid selling_price → status: 'failed'
    it('should fail a row with selling_price = 0', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 10, 0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.failed).toBe(1);
        expect(result.rows[0].status).toBe('failed');
    });

    // Test 7: Inventory INSERT error → status: 'failed' with error message
    it('should fail a row when inventory INSERT errors', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 50, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [{ id: 'drug-1', brand_name: 'Panadol', brand_name_ar: '', generic_name: 'P', active_ingredient: 'P' }], error: null });
        mockVerify.mockResolvedValueOnce('drug-1');
        mocks._mockInventoryInsert.mockResolvedValueOnce({
            error: { message: 'FK constraint violation' },
        });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.failed).toBe(1);
        expect(result.rows[0].status).toBe('failed');
        expect(result.rows[0].error).toContain('FK constraint');
    });

    // Test 8: Failed row does NOT stop subsequent rows
    it('a failed row should not stop subsequent rows from processing', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['BadRow', 0, 15.0],    // fails — quantity = 0
            ['GoodRow', 10, 20.0],  // should still be processed
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [], error: null });
        mockVerify.mockResolvedValueOnce(null);
        mockGenerate.mockResolvedValueOnce({
            brand_name: 'GoodRow',
            generic_name: 'G',
            active_ingredient: 'G',
            category: 'G',
            strength: 'G',
            dosage_form: 'Tablet',
            manufacturer: 'G',
        });
        mocks._mockDrugSingle.mockResolvedValueOnce({ data: { id: 'good-drug-id' }, error: null });
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.total).toBe(2);
        expect(result.failed).toBe(1);
        expect(result.autoCreated).toBe(1);
    });

    // Test 9: mapColumns() called exactly once regardless of row count
    it('should call mapColumns exactly once per processFile call', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Drug A', 10, 15.0],
            ['Drug B', 20, 25.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValue({ data: [], error: null });
        mockVerify.mockResolvedValue(null);
        mockGenerate.mockResolvedValue({
            brand_name: 'X', generic_name: 'X', active_ingredient: 'X',
            category: 'X', strength: 'X', dosage_form: 'X', manufacturer: 'X',
        });
        mocks._mockDrugSingle.mockResolvedValue({ data: { id: 'new-id' }, error: null });
        mocks._mockInventoryInsert.mockResolvedValue({ error: null });

        await service.processFile(buffer, 'pharmacy-1');

        expect(mockMapColumns).toHaveBeenCalledTimes(1);
    });

    // Test 10: verify() receives max 3 candidates
    it('should pass at most 3 candidates to verify()', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 10, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });

        // Return 5 candidates from RPC
        const candidates = Array.from({ length: 5 }, (_, i) => ({
            id: `drug-${i}`,
            brand_name: `Drug${i}`,
            brand_name_ar: '',
            generic_name: 'Gen',
            active_ingredient: 'ING',
        }));
        mockRpc.mockResolvedValueOnce({ data: candidates, error: null });
        mockVerify.mockResolvedValueOnce('drug-0');
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        await service.processFile(buffer, 'pharmacy-1');

        const passedCandidates = mockVerify.mock.calls[0][1] as unknown[];
        expect(passedCandidates).toHaveLength(3);
    });

    // Test 11: matched + autoCreated + failed === total
    it('matched + autoCreated + failed should equal total', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['GoodMatched', 10, 15.0],
            ['GoodNew', 5, 20.0],
            ['BadRow', 0, 10.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc
            .mockResolvedValueOnce({ data: [{ id: 'drug-1', brand_name: 'GM', brand_name_ar: '', generic_name: 'G', active_ingredient: 'G' }], error: null })
            .mockResolvedValueOnce({ data: [], error: null });
        mockVerify
            .mockResolvedValueOnce('drug-1')
            .mockResolvedValueOnce(null);
        mockGenerate.mockResolvedValueOnce({
            brand_name: 'GoodNew', generic_name: 'G', active_ingredient: 'G',
            category: 'G', strength: 'G', dosage_form: 'G', manufacturer: 'G',
        });
        mocks._mockDrugSingle.mockResolvedValueOnce({ data: { id: 'new-drug' }, error: null });
        mocks._mockInventoryInsert.mockResolvedValue({ error: null });

        const result = await service.processFile(buffer, 'pharmacy-1');

        expect(result.matched + result.autoCreated + result.failed).toBe(result.total);
        expect(result.total).toBe(3);
    });

    // Test 12: Missing discount_percent inserts as 0
    it('should insert discount_percent as 0 when missing', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 10, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [{ id: 'drug-1', brand_name: 'P', brand_name_ar: '', generic_name: 'P', active_ingredient: 'P' }], error: null });
        mockVerify.mockResolvedValueOnce('drug-1');
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        await service.processFile(buffer, 'pharmacy-1');

        expect(mocks._mockInventoryInsert).toHaveBeenCalledWith(
            expect.objectContaining({ discount_percent: 0 }),
        );
    });

    // Test 13: Missing batch_number inserts as null, not empty string
    it('should insert batch_number as null when missing', async () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Qty', 'Price'],
            ['Panadol', 10, 15.0],
        ]);

        mockMapColumns.mockResolvedValueOnce({
            'Drug Name': 'drug_name',
            'Qty': 'quantity',
            'Price': 'selling_price',
        });
        mockRpc.mockResolvedValueOnce({ data: [{ id: 'drug-1', brand_name: 'P', brand_name_ar: '', generic_name: 'P', active_ingredient: 'P' }], error: null });
        mockVerify.mockResolvedValueOnce('drug-1');
        mocks._mockInventoryInsert.mockResolvedValueOnce({ error: null });

        await service.processFile(buffer, 'pharmacy-1');

        expect(mocks._mockInventoryInsert).toHaveBeenCalledWith(
            expect.objectContaining({ batch_number: null }),
        );
    });
});
