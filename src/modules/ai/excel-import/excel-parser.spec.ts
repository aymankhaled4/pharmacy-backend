import * as XLSX from 'xlsx';
import { ExcelParser } from './excel-parser';

/**
 * Helper — build an in-memory .xlsx Buffer from a 2D array.
 * First sub-array is the header row.
 */
function makeXlsx(rows: unknown[][], dateFormat?: string): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Same but .xls format */
function makeXls(rows: unknown[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}

describe('ExcelParser', () => {
    // Test 1: Valid .xlsx returns correct headers and rows
    it('should parse a valid .xlsx and return headers and rows', () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Quantity', 'Price'],
            ['Panadol', 100, 15.5],
        ]);

        const result = ExcelParser.parse(buffer);

        expect(result.headers).toEqual(['Drug Name', 'Quantity', 'Price']);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]['Drug Name']).toBe('Panadol');
    });

    // Test 2: Valid .xls parses correctly
    it('should parse a valid .xls file', () => {
        const buffer = makeXls([
            ['Drug Name', 'Qty'],
            ['Aspirin', 50],
        ]);

        const result = ExcelParser.parse(buffer);

        expect(result.headers).toEqual(['Drug Name', 'Qty']);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]['Drug Name']).toBe('Aspirin');
    });

    // Test 3: Arabic column headers preserved without corruption
    it('should preserve Arabic column headers', () => {
        const buffer = makeXlsx([
            ['اسم الدواء', 'الكمية', 'السعر'],
            ['باندول', 100, 20],
        ]);

        const result = ExcelParser.parse(buffer);

        expect(result.headers).toContain('اسم الدواء');
        expect(result.headers).toContain('الكمية');
        expect(result.rows[0]['اسم الدواء']).toBe('باندول');
    });

    // Test 4: Date cells return YYYY-MM-DD formatted string
    it('should return YYYY-MM-DD string for date cells', () => {
        // Use a JS Date object — SheetJS will encode it as a date cell
        const buffer = makeXlsx([
            ['Drug Name', 'Expiry Date'],
            ['Panadol', new Date('2027-06-15')],
        ]);

        const result = ExcelParser.parse(buffer);
        const expiryVal = result.rows[0]['Expiry Date'] as string;

        // Should match YYYY-MM-DD format
        expect(expiryVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    // Test 5: Empty cell in row returns null, not undefined
    it('should return null for empty cells, not undefined', () => {
        const buffer = makeXlsx([
            ['Drug Name', 'Batch', 'Qty'],
            ['Panadol', null, 50],
        ]);

        const result = ExcelParser.parse(buffer);
        const cellValue = result.rows[0]['Batch'];

        expect(cellValue).toBeNull();
        expect(cellValue).not.toBeUndefined();
    });

    // Test 6: Empty file returns { headers: [], rows: [] }
    it('should return empty headers and rows for an empty file', () => {
        // An empty buffer or file with no sheets
        const result = ExcelParser.parse(Buffer.from([]));

        expect(result.headers).toEqual([]);
        expect(result.rows).toEqual([]);
    });

    // Test 7: normalize() maps headers to correct fields using fieldMap
    it('normalize() should map headers using fieldMap', () => {
        const fieldMap = { 'Drug Name': 'drug_name', 'Qty': 'quantity' };
        const row = { 'Drug Name': 'Panadol', 'Qty': '100' };

        const result = ExcelParser.normalize(row, fieldMap);

        expect(result.drug_name).toBe('Panadol');
        expect(result.quantity).toBe(100);
    });

    // Test 8: normalize() coerces quantity and price to numbers
    it('normalize() should coerce quantity and selling_price to numbers', () => {
        const fieldMap = {
            'Qty': 'quantity',
            'Price': 'selling_price',
            'Discount': 'discount_percent',
        };
        const row = { 'Qty': '200', 'Price': '25.99', 'Discount': '10' };

        const result = ExcelParser.normalize(row, fieldMap);

        expect(result.quantity).toBe(200);
        expect(result.selling_price).toBe(25.99);
        expect(result.discount_percent).toBe(10);
    });

    // Test 9: normalize() trims whitespace from string values
    it('normalize() should trim whitespace from string fields', () => {
        const fieldMap = { 'Drug Name': 'drug_name', 'Batch': 'batch_number' };
        const row = { 'Drug Name': '  Panadol  ', 'Batch': ' B001 ' };

        const result = ExcelParser.normalize(row, fieldMap);

        expect(result.drug_name).toBe('Panadol');
        expect(result.batch_number).toBe('B001');
    });
});
