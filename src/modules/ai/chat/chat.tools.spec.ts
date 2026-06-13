import OpenAI from 'openai';
import { CHAT_TOOLS } from './chat.tools';

type FunctionTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;

describe('CHAT_TOOLS', () => {
    // Test 1: exactly 3 items
    it('should have exactly 3 tools', () => {
        expect(CHAT_TOOLS).toHaveLength(3);
    });

    // Test 2: each tool has type: 'function'
    it('each tool should have type "function"', () => {
        CHAT_TOOLS.forEach((tool) => {
            expect(tool.type).toBe('function');
        });
    });

    // Test 3: search_drug — query is required
    it('search_drug should have query as a required parameter', () => {
        const tool = CHAT_TOOLS.find((t: FunctionTool) => t.function.name === 'search_drug');
        expect(tool).toBeDefined();
        const params = tool!.function.parameters as {
            required: string[];
            properties: Record<string, { type: string }>;
        };
        expect(params.required).toContain('query');
        expect(params.properties.query.type).toBe('string');
    });

    // Test 4: find_nearby_pharmacies — drug_id, lat, lng required; radius_km optional
    it('find_nearby_pharmacies should have drug_id, lat, lng required and radius_km optional', () => {
        const tool = CHAT_TOOLS.find(
            (t: FunctionTool) => t.function.name === 'find_nearby_pharmacies',
        );
        expect(tool).toBeDefined();
        const params = tool!.function.parameters as {
            required: string[];
            properties: Record<string, { type: string }>;
        };
        expect(params.required).toContain('drug_id');
        expect(params.required).toContain('lat');
        expect(params.required).toContain('lng');
        expect(params.required).not.toContain('radius_km');
        expect(params.properties.radius_km).toBeDefined();
    });

    // Test 5: find_alternatives — active_ingredient is required
    it('find_alternatives should have active_ingredient as a required parameter', () => {
        const tool = CHAT_TOOLS.find(
            (t: FunctionTool) => t.function.name === 'find_alternatives',
        );
        expect(tool).toBeDefined();
        const params = tool!.function.parameters as {
            required: string[];
            properties: Record<string, { type: string }>;
        };
        expect(params.required).toContain('active_ingredient');
        expect(params.properties.active_ingredient.type).toBe('string');
    });

    // Test 6: all parameter types are valid JSON Schema types
    it('all parameter types should be valid JSON Schema primitive types', () => {
        const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
        CHAT_TOOLS.forEach((tool: FunctionTool) => {
            const params = tool.function.parameters as {
                properties: Record<string, { type: string }>;
            };
            Object.values(params.properties).forEach((prop) => {
                expect(validTypes).toContain(prop.type);
            });
        });
    });
});
