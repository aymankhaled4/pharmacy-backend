export interface RowResult {
    drugName: string;
    status: 'matched' | 'auto_created' | 'failed';
    drugId?: string;
    error?: string;
}

export interface ImportResult {
    matched: number;
    autoCreated: number;
    failed: number;
    total: number;
    rows: RowResult[];
}
