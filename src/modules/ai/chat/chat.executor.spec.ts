import { Test, TestingModule } from '@nestjs/testing';
import { ChatExecutor } from './chat.executor';
import { SupabaseService } from '../../../database/supabase.service';
import OpenAI from 'openai';

function makeToolCall(
    name: string,
    args: Record<string, unknown>,
    id = 'call_123',
): OpenAI.Chat.ChatCompletionMessageToolCall {
    return {
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
    };
}

describe('ChatExecutor', () => {
    let executor: ChatExecutor;

    // We build mock chains fresh before each test
    let mockRpc: jest.Mock;
    let mockFrom: jest.Mock;
    let mockSelect: jest.Mock;
    let mockIlike: jest.Mock;
    let mockLimit: jest.Mock;

    beforeEach(async () => {
        mockLimit = jest.fn();
        mockIlike = jest.fn().mockReturnValue({ limit: mockLimit });
        mockSelect = jest.fn().mockReturnValue({ ilike: mockIlike });
        mockFrom = jest.fn().mockReturnValue({ select: mockSelect });
        mockRpc = jest.fn();

        const mockSupabase = {
            adminClient: {
                rpc: mockRpc,
                from: mockFrom,
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChatExecutor,
                { provide: SupabaseService, useValue: mockSupabase },
            ],
        }).compile();

        executor = module.get<ChatExecutor>(ChatExecutor);
    });

    // Test 1: search_drug calls RPC with correct param and returns serialized array
    it('search_drug should call search_drugs RPC and return serialized array', async () => {
        const drugs = [{ id: 'drug-1', brand_name: 'Panadol' }];
        mockRpc.mockResolvedValueOnce({ data: drugs, error: null });

        const result = await executor.execute(
            makeToolCall('search_drug', { query: 'Panadol' }),
            {},
        );

        expect(mockRpc).toHaveBeenCalledWith('search_drugs', { p_query: 'Panadol' });
        expect(result.role).toBe('tool');
        expect(result.tool_call_id).toBe('call_123');
        expect(JSON.parse(result.content as string)).toEqual(drugs);
    });

    // Test 2: find_nearby_pharmacies defaults to radius_km: 10
    it('find_nearby_pharmacies should default radius_km to 10', async () => {
        mockRpc.mockResolvedValueOnce({ data: [], error: null });

        await executor.execute(
            makeToolCall('find_nearby_pharmacies', {
                drug_id: 'drug-1',
                lat: 30.0,
                lng: 31.0,
            }),
            {},
        );

        expect(mockRpc).toHaveBeenCalledWith('search_nearby_pharmacies', {
            drug_id: 'drug-1',
            lat: 30.0,
            lng: 31.0,
            radius_km: 10,
        });
    });

    // Test 3: find_nearby_pharmacies uses userLocation when args lack coordinates
    it('find_nearby_pharmacies should fall back to userLocation when args lack lat/lng', async () => {
        mockRpc.mockResolvedValueOnce({ data: [], error: null });

        await executor.execute(
            makeToolCall('find_nearby_pharmacies', { drug_id: 'drug-1' }),
            { lat: 30.5, lng: 31.5 },
        );

        expect(mockRpc).toHaveBeenCalledWith('search_nearby_pharmacies', {
            drug_id: 'drug-1',
            lat: 30.5,
            lng: 31.5,
            radius_km: 10,
        });
    });

    // Test 4: find_alternatives queries drugs table with ILIKE and limits to 10
    it('find_alternatives should query drugs with ILIKE and limit 10', async () => {
        const alternatives = [{ id: 'drug-2', brand_name: 'Generic' }];
        mockLimit.mockResolvedValueOnce({ data: alternatives, error: null });

        const result = await executor.execute(
            makeToolCall('find_alternatives', { active_ingredient: 'PARACETAMOL' }),
            {},
        );

        expect(mockFrom).toHaveBeenCalledWith('drugs');
        expect(mockIlike).toHaveBeenCalledWith('active_ingredient', '%PARACETAMOL%');
        expect(mockLimit).toHaveBeenCalledWith(10);
        expect(JSON.parse(result.content as string)).toEqual(alternatives);
    });

    // Test 5: Supabase error is caught and returned as { error: message } — does NOT throw
    it('should catch Supabase errors and return them serialized without throwing', async () => {
        mockRpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'DB connection error' },
        });

        const result = await executor.execute(
            makeToolCall('search_drug', { query: 'Aspirin' }),
            {},
        );

        expect(result.role).toBe('tool');
        expect(JSON.parse(result.content as string)).toEqual({
            error: 'DB connection error',
        });
    });

    // Test 6: Unknown tool name returns { error: 'Unknown tool: xyz' } — does NOT throw
    it('should return error for unknown tool name without throwing', async () => {
        const result = await executor.execute(
            makeToolCall('unknown_tool', {}),
            {},
        );

        expect(result.role).toBe('tool');
        expect(JSON.parse(result.content as string)).toEqual({
            error: 'Unknown tool: unknown_tool',
        });
    });

    // Test 7: Return always has role: 'tool' and tool_call_id matching the input
    it('should always return role: "tool" and matching tool_call_id', async () => {
        mockRpc.mockResolvedValueOnce({ data: [], error: null });

        const result = await executor.execute(
            makeToolCall('search_drug', { query: 'test' }, 'my-call-id'),
            {},
        );

        expect(result.role).toBe('tool');
        expect(result.tool_call_id).toBe('my-call-id');
    });

    // Test 8: content is always a JSON string, never a raw object
    it('content should always be a JSON string', async () => {
        mockRpc.mockResolvedValueOnce({ data: [{ id: '1' }], error: null });

        const result = await executor.execute(
            makeToolCall('search_drug', { query: 'test' }),
            {},
        );

        expect(typeof result.content).toBe('string');
        expect(() => JSON.parse(result.content as string)).not.toThrow();
    });
});
