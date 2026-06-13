import { Test, TestingModule } from '@nestjs/testing';
import { DrugMatcherService, DrugCandidate } from './drug-matcher';
import { OpenAiService } from '../openai.service';

function makeOpenAiResponse(json: Record<string, unknown>) {
    return {
        choices: [
            {
                message: { role: 'assistant', content: JSON.stringify(json) },
                finish_reason: 'stop',
            },
        ],
    };
}

const candidates: DrugCandidate[] = [
    {
        id: 'drug-uuid-1',
        brand_name: 'Panadol',
        brand_name_ar: 'بانادول',
        generic_name: 'Paracetamol',
        active_ingredient: 'PARACETAMOL',
    },
    {
        id: 'drug-uuid-2',
        brand_name: 'Aspirin',
        brand_name_ar: 'أسبرين',
        generic_name: 'Acetylsalicylic Acid',
        active_ingredient: 'ASPIRIN',
    },
];

describe('DrugMatcherService', () => {
    let service: DrugMatcherService;
    let mockChat: jest.Mock;

    beforeEach(async () => {
        mockChat = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DrugMatcherService,
                { provide: OpenAiService, useValue: { chat: mockChat } },
            ],
        }).compile();

        service = module.get<DrugMatcherService>(DrugMatcherService);
    });

    // Test 1: verify() returns correct drug_id when match found
    it('verify() should return the correct drug_id when a match is found', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ matched: true, drug_id: 'drug-uuid-1' }),
        );

        const result = await service.verify('Panadol', candidates);

        expect(result).toBe('drug-uuid-1');
    });

    // Test 2: verify() returns null when no match
    it('verify() should return null when no match found', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ matched: false, drug_id: null }),
        );

        const result = await service.verify('UnknownDrug', candidates);

        expect(result).toBeNull();
    });

    // Test 3: verify() with empty candidates returns null without calling API
    it('verify() with empty candidates should return null without calling OpenAI', async () => {
        const result = await service.verify('Panadol', []);

        expect(result).toBeNull();
        expect(mockChat).not.toHaveBeenCalled();
    });

    // Test 4: verify() AI error returns null — does not throw
    it('verify() should return null on OpenAI error without throwing', async () => {
        mockChat.mockRejectedValueOnce(new Error('OpenAI timeout'));

        const result = await service.verify('Panadol', candidates);

        expect(result).toBeNull();
    });

    // Test 5: verify() AI returns drug_id not in candidates → returns null (prevents hallucination)
    it('verify() should return null when AI returns a drug_id not in candidates', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ matched: true, drug_id: 'hallucinated-id-not-in-list' }),
        );

        const result = await service.verify('Panadol', candidates);

        expect(result).toBeNull();
    });

    // Test 6: generate() returns object with all 7 fields populated
    it('generate() should return an object with all 7 required fields', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({
                brand_name: 'TestDrug',
                generic_name: 'Test Generic',
                active_ingredient: 'TEST INGREDIENT',
                category: 'Analgesic',
                strength: '500mg',
                dosage_form: 'Tablet',
                manufacturer: 'Test Pharma',
            }),
        );

        const result = await service.generate('TestDrug');

        expect(result.brand_name).toBe('TestDrug');
        expect(result.generic_name).toBe('Test Generic');
        expect(result.active_ingredient).toBeDefined();
        expect(result.category).toBe('Analgesic');
        expect(result.strength).toBe('500mg');
        expect(result.dosage_form).toBe('Tablet');
        expect(result.manufacturer).toBe('Test Pharma');
    });

    // Test 7: generate() active_ingredient is UPPERCASE
    it('generate() active_ingredient should always be UPPERCASE', async () => {
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({
                brand_name: 'TestDrug',
                generic_name: 'Generic',
                active_ingredient: 'paracetamol',   // lowercase from AI
                category: 'Analgesic',
                strength: '500mg',
                dosage_form: 'Tablet',
                manufacturer: 'Pharma Co',
            }),
        );

        const result = await service.generate('TestDrug');

        expect(result.active_ingredient).toBe('PARACETAMOL');
    });

    // Test 8: generate() no field is undefined or missing
    it('generate() should use "Unknown" fallback so no field is undefined', async () => {
        // AI returns incomplete response
        mockChat.mockResolvedValueOnce(
            makeOpenAiResponse({ brand_name: 'PartialDrug' }),
        );

        const result = await service.generate('PartialDrug');

        expect(result.brand_name).toBe('PartialDrug');
        expect(result.generic_name).toBe('Unknown');
        expect(result.active_ingredient).toBe('UNKNOWN');
        expect(result.category).toBe('Unknown');
        expect(result.strength).toBe('Unknown');
        expect(result.dosage_form).toBe('Unknown');
        expect(result.manufacturer).toBe('Unknown');
    });
});
