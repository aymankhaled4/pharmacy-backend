import * as XLSX from 'xlsx';

export interface NormalizedRow {
    drug_name?: string | null;
    batch_number?: string | null;
    quantity?: number | null;
    expiry_date?: string | null;
    selling_price?: number | null;
    discount_percent?: number | null;
}

const NUMERIC_FIELDS = new Set<string>(['quantity', 'selling_price', 'discount_percent']);
const STRING_FIELDS = new Set<string>(['drug_name', 'batch_number', 'expiry_date']);

/** Format a JS Date as YYYY-MM-DD */
function formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export class ExcelParser {
    /**
     * Parses an .xlsx or .xls Buffer and returns headers + rows.
     * Empty/missing cells become null. Date cells return YYYY-MM-DD string.
     * Empty file returns { headers: [], rows: [] }.
     */
    static parse(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
        let workbook: XLSX.WorkBook;

        try {
            workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
        } catch {
            return { headers: [], rows: [] };
        }

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            return { headers: [], rows: [] };
        }

        const sheet = workbook.Sheets[sheetName];

        // Keep raw values; dates come back as JS Date objects when cellDates:true
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: null,
            raw: true,
        });

        if (!raw || raw.length === 0) {
            return { headers: [], rows: [] };
        }

        const headerRow = raw[0] as (string | null)[];
        const headers = headerRow.map((h) => (h !== null && h !== undefined ? String(h) : ''));

        if (headers.every((h) => h === '')) {
            return { headers: [], rows: [] };
        }

        const rows: Record<string, unknown>[] = [];

        for (let i = 1; i < raw.length; i++) {
            const cells = raw[i] as unknown[];
            const row: Record<string, unknown> = {};

            headers.forEach((header, idx) => {
                let cell = cells[idx] !== undefined ? cells[idx] : null;

                // Convert Date objects to YYYY-MM-DD strings
                if (cell instanceof Date) {
                    cell = formatDate(cell);
                }

                row[header] = cell;
            });

            rows.push(row);
        }

        return { headers, rows };
    }

    /**
     * Maps a raw row to a NormalizedRow using the provided fieldMap.
     * Numeric fields are coerced; string fields are trimmed.
     * Missing mapped values return null.
     */
    static normalize(
        row: Record<string, unknown>,
        fieldMap: Record<string, string>,
    ): NormalizedRow {
        const result: NormalizedRow = {};

        for (const [header, fieldName] of Object.entries(fieldMap)) {
            const raw = header in row ? row[header] : null;
            const targetKey = fieldName as keyof NormalizedRow;

            if (raw === null || raw === undefined) {
                (result as Record<string, unknown>)[targetKey] = null;
                continue;
            }

            if (NUMERIC_FIELDS.has(fieldName)) {
                const num = Number(raw);
                (result as Record<string, unknown>)[targetKey] = isNaN(num) ? null : num;
            } else if (STRING_FIELDS.has(fieldName)) {
                (result as Record<string, unknown>)[targetKey] = String(raw).trim();
            } else {
                (result as Record<string, unknown>)[targetKey] = raw;
            }
        }

        return result;
    }
}
