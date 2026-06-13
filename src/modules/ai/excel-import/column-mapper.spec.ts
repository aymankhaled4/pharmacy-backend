import { Test, TestingModule } from '@nestjs/testing';
import { ColumnMapperService } from './column-mapper';
import { OpenAiService } from '../openai.service';

function makeOpenAiResponse(json: Record<string, string>) {
    return {
        choices: [
            {
                message: { role: 'assistant', content: JSON.stringify(json) },
                finish_reason: 'stop',
            },
        ],
    };
}

describe('ColumnMapperService', () => {
    let service: ColumnMapperService;
    let mockChat: jest.Mock;

    beforeEach(async () => {
        mockChat = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ColumnMapperService,
                { provide: OpenAiService, useValue: { chat: mockChat } },
            ],
        }).compile();

        service = module.get<ColumnMapperService>(ColumnMapperService);
    });

    // Test 1: English headers mapped correctly
    it('should map English headers correctly', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ 'Drug Name': 'drug_name', 'Qty': 'quantity' }),
        );

        const result = await service.mapColumns(['Drug Name', 'Qty']);

        expect(result['Drug Name']).toBe('drug_name');
        expect(result['Qty']).toBe('quantity');
    });

    // Test 2: Arabic headers mapped correctly
    it('should map Arabic headers correctly', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ 'اسم الدواء': 'drug_name', 'الكمية': 'quantity' }),
        );

        const result = await service.mapColumns(['اسم الدواء', 'الكمية']);

        expect(result['اسم الدواء']).toBe('drug_name');
        expect(result['الكمية']).toBe('quantity');
    });

    // Test 3: Mixed Arabic/English headers work correctly
    it('should handle mixed Arabic/English headers', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({
                'اسم الدواء': 'drug_name',
                'Qty': 'quantity',
                'Expiry': 'expiry_date',
            }),
        );

        const result = await service.mapColumns(['اسم الدواء', 'Qty', 'Expiry']);

        expect(result['اسم الدواء']).toBe('drug_name');
        expect(result['Qty']).toBe('quantity');
        expect(result['Expiry']).toBe('expiry_date');
    });

    // Test 4: Unrelated headers omitted from result
    it('should omit unrelated headers like Notes and Supplier', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({
                'Drug Name': 'drug_name',
                // AI correctly omits Notes and Supplier
            }),
        );

        const result = await service.mapColumns(['Drug Name', 'Notes', 'Supplier']);

        expect(result['Notes']).toBeUndefined();
        expect(result['Supplier']).toBeUndefined();
        expect(result['Drug Name']).toBe('drug_name');
    });

    // Test 5: Hallucinated field names stripped
    it('should strip hallucinated field names not in the allowed list', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({
                'Drug Name': 'drug_name',
                'Whatever': 'hallucinated_field',   // not in allowed list
                'Price': 'price_per_unit',          // also not in allowed list
            }),
        );

        const result = await service.mapColumns(['Drug Name', 'Whatever', 'Price']);

        expect(result['Drug Name']).toBe('drug_name');
        expect(result['Whatever']).toBeUndefined();
        expect(result['Price']).toBeUndefined();
    });

    // Test 6: Returns empty object when no headers match
    it('should return empty object when no headers match any target field', async () => {
        mockChat.mockResolvedValueOnce(makeOpenAiResponse({}));

        const result = await service.mapColumns(['Notes', 'Supplier', 'Reference']);

        expect(result).toEqual({});
    });

    // Test 7: Uses response_format: json_object — never parses raw text
    it('should always call OpenAI with response_format: json_object', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ 'Drug Name': 'drug_name' }),
        );

        await service.mapColumns(['Drug Name']);

        const callParams = mockChat.mock.calls[0][0] as { response_format: { type: string } };
        expect(callParams.response_format).toEqual({ type: 'json_object' });
    });
});
