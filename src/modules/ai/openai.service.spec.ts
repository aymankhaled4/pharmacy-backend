import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from './openai.service';
import OpenAI from 'openai';

// Mock the entire openai module
jest.mock('openai');

const mockCreate = jest.fn();

(OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
    () =>
        ({
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        }) as unknown as OpenAI,
);

describe('OpenAiService', () => {
    let service: OpenAiService;

    const mockConfigService = {
        get: jest.fn((key: string) => {
            if (key === 'openai.apiKey') return 'test-api-key';
            return undefined;
        }),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OpenAiService,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<OpenAiService>(OpenAiService);
    });

    // Test 1: Service initializes when OPENAI_API_KEY is present
    it('should initialize when OPENAI_API_KEY is present', () => {
        expect(service).toBeDefined();
        expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    });

    // Test 2: chat() returns a valid ChatCompletion object
    it('should return a valid ChatCompletion for a simple prompt', async () => {
        const mockCompletion: Partial<OpenAI.Chat.ChatCompletion> = {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content: 'Hello!', refusal: null },
                    finish_reason: 'stop',
                    logprobs: null,
                },
            ],
            model: 'gpt-4o',
            created: Date.now(),
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        mockCreate.mockResolvedValueOnce(mockCompletion);

        const result = await service.chat({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Hello' }],
        });

        expect(result).toEqual(mockCompletion);
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Test 3: OpenAI errors propagate — do not catch
    it('should propagate OpenAI API errors to the caller', async () => {
        const apiError = new Error('OpenAI API error: rate limit exceeded');
        mockCreate.mockRejectedValueOnce(apiError);

        await expect(
            service.chat({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello' }],
            }),
        ).rejects.toThrow('OpenAI API error: rate limit exceeded');
    });

    // Test 4: Multiple calls reuse the same internal client instance
    it('should reuse the same internal OpenAI client instance across calls', async () => {
        const mockCompletion = {
            id: 'chatcmpl-test',
            choices: [
                { message: { role: 'assistant', content: 'Reply' }, finish_reason: 'stop' },
            ],
        };

        mockCreate.mockResolvedValue(mockCompletion);

        await service.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'First' }] });
        await service.chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Second' }] });

        // OpenAI constructor was called exactly once (during service init)
        expect(OpenAI).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledTimes(2);
    });
});
