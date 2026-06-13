import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { SearchLogsService } from './search-logs.service';
import { SupabaseService } from '../../../database/supabase.service';

describe('SearchLogsService', () => {
    let service: SearchLogsService;

    // Query builder mocks
    let mockInsert: jest.Mock;
    let mockSelectAfterInsert: jest.Mock;
    let mockSingleAfterInsert: jest.Mock;
    let mockUpdate: jest.Mock;
    let mockEq: jest.Mock;
    let mockFrom: jest.Mock;
    let mockSuggestionsInsert: jest.Mock;

    const buildMockSupabase = () => {
        mockSingleAfterInsert = jest.fn();
        mockSelectAfterInsert = jest.fn().mockReturnValue({ single: mockSingleAfterInsert });
        mockInsert = jest.fn().mockReturnValue({ select: mockSelectAfterInsert });

        mockEq = jest.fn();
        mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

        // For suggestions the insert chain terminates differently
        mockSuggestionsInsert = jest.fn();

        let callCount = 0;
        mockFrom = jest.fn().mockImplementation((table: string) => {
            if (table === 'ai_suggestions') {
                return { insert: mockSuggestionsInsert };
            }
            // search_logs
            return { insert: mockInsert, update: mockUpdate };
        });

        return {
            adminClient: { from: mockFrom },
        };
    };

    beforeEach(async () => {
        const mockSupabase = buildMockSupabase();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchLogsService,
                { provide: SupabaseService, useValue: mockSupabase },
            ],
        }).compile();

        service = module.get<SearchLogsService>(SearchLogsService);
    });

    // Test 1: create() inserts a row and returns a valid UUID
    it('create() should insert a row and return a UUID', async () => {
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        mockSingleAfterInsert.mockResolvedValueOnce({ data: { id: uuid }, error: null });

        const result = await service.create({ userId: 'user-1', query: 'Panadol' });

        expect(result).toBe(uuid);
        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-1', query: 'Panadol' }),
        );
    });

    // Test 2: create() with no userId inserts null
    it('create() with no userId should insert null for user_id', async () => {
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
        mockSingleAfterInsert.mockResolvedValueOnce({ data: { id: uuid }, error: null });

        await service.create({ query: 'Aspirin' });

        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: null }),
        );
    });

    // Test 3: create() with no coordinates inserts null for both
    it('create() with no coordinates should insert null for latitude and longitude', async () => {
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';
        mockSingleAfterInsert.mockResolvedValueOnce({ data: { id: uuid }, error: null });

        await service.create({ query: 'Ibuprofen' });

        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({ latitude: null, longitude: null }),
        );
    });

    // Test 4: updateResolved() updates the correct row by searchId
    it('updateResolved() should update the correct row', async () => {
        mockEq.mockResolvedValueOnce({ error: null });

        await service.updateResolved('search-id-1', 'PARACETAMOL', true);

        expect(mockUpdate).toHaveBeenCalledWith({
            resolved_ingredient: 'PARACETAMOL',
            result_found: true,
        });
        expect(mockEq).toHaveBeenCalledWith('id', 'search-id-1');
    });

    // Test 5: createSuggestions() with empty array returns without DB call
    it('createSuggestions() with empty array should not call DB', async () => {
        await service.createSuggestions('search-id-1', []);

        expect(mockSuggestionsInsert).not.toHaveBeenCalled();
    });

    // Test 6: createSuggestions() inserts all rows when array has items
    it('createSuggestions() should insert all rows', async () => {
        mockSuggestionsInsert.mockResolvedValueOnce({ error: null });

        const suggestions = [
            { drugId: 'drug-1', reason: 'Same ingredient', confidenceScore: 0.9 },
            { drugId: 'drug-2', reason: 'Similar formula', confidenceScore: 0.7 },
        ];

        await service.createSuggestions('search-id-1', suggestions);

        expect(mockSuggestionsInsert).toHaveBeenCalledWith([
            {
                search_id: 'search-id-1',
                suggested_drug_id: 'drug-1',
                reason: 'Same ingredient',
                confidence_score: 0.9,
            },
            {
                search_id: 'search-id-1',
                suggested_drug_id: 'drug-2',
                reason: 'Similar formula',
                confidence_score: 0.7,
            },
        ]);
    });

    // Test 7: DB error in create() throws and propagates
    it('create() should throw when DB returns an error', async () => {
        mockSingleAfterInsert.mockResolvedValueOnce({
            data: null,
            error: { message: 'Connection refused' },
        });

        await expect(service.create({ query: 'test' })).rejects.toThrow(
            InternalServerErrorException,
        );
    });
});
