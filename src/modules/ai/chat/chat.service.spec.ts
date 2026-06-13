import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { OpenAiService } from '../openai.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import OpenAI from 'openai';

function makeCompletion(
    finishReason: 'stop' | 'tool_calls',
    content: string | null,
    toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[],
): OpenAI.Chat.ChatCompletion {
    return {
        id: 'cmpl-1',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o',
        choices: [
            {
                index: 0,
                finish_reason: finishReason,
                logprobs: null,
                message: {
                    role: 'assistant',
                    content,
                    refusal: null,
                    tool_calls: toolCalls,
                },
            },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}

function makeToolCall(
    name: string,
    args: Record<string, unknown>,
    id = 'call_1',
): OpenAI.Chat.ChatCompletionMessageToolCall {
    return {
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
    };
}

describe('ChatService', () => {
    let service: ChatService;
    let mockChat: jest.Mock;
    let mockExecute: jest.Mock;
    let mockCreate: jest.Mock;
    let mockUpdateResolved: jest.Mock;
    let mockCreateSuggestions: jest.Mock;

    beforeEach(async () => {
        mockChat = jest.fn();
        mockExecute = jest.fn();
        mockCreate = jest.fn().mockResolvedValue('search-log-id-1');
        mockUpdateResolved = jest.fn().mockResolvedValue(undefined);
        mockCreateSuggestions = jest.fn().mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ChatService,
                { provide: OpenAiService, useValue: { chat: mockChat } },
                { provide: ChatExecutor, useValue: { execute: mockExecute } },
                {
                    provide: SearchLogsService,
                    useValue: {
                        create: mockCreate,
                        updateResolved: mockUpdateResolved,
                        createSuggestions: mockCreateSuggestions,
                    },
                },
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn().mockReturnValue('gpt-4o') },
                },
            ],
        }).compile();

        service = module.get<ChatService>(ChatService);
    });

    // Test 1: No tool calls → single OpenAI call, returns reply and history
    it('should make a single OpenAI call and return reply when no tool calls', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'Hello there!'));

        const dto: ChatMessageDto = { message: 'Hi' };
        const result = await service.processMessage(dto, 'user-1');

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(result.reply).toBe('Hello there!');
        expect(result.updatedHistory).toBeDefined();
    });

    // Test 2: Message triggering one tool → loop runs twice, tool result in history
    it('should run loop twice when one tool call is triggered', async () => {
        const toolCall = makeToolCall('search_drug', { query: 'Panadol' });
        mockChat
            .mockResolvedValueOnce(makeCompletion('tool_calls', null, [toolCall]))
            .mockResolvedValueOnce(makeCompletion('stop', 'Found Panadol!'));

        mockExecute.mockResolvedValueOnce({
            role: 'tool',
            tool_call_id: 'call_1',
            content: JSON.stringify([{ id: 'drug-1', active_ingredient: 'PARACETAMOL' }]),
        });

        const dto: ChatMessageDto = { message: 'Find Panadol' };
        const result = await service.processMessage(dto, 'user-1');

        expect(mockChat).toHaveBeenCalledTimes(2);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(result.reply).toBe('Found Panadol!');
    });

    // Test 3: Chained tools (search_drug → find_nearby_pharmacies) → loop runs 3 times
    it('should run loop 3 times for chained tool calls', async () => {
        const tc1 = makeToolCall('search_drug', { query: 'Aspirin' }, 'call_1');
        const tc2 = makeToolCall(
            'find_nearby_pharmacies',
            { drug_id: 'drug-1', lat: 30, lng: 31 },
            'call_2',
        );

        mockChat
            .mockResolvedValueOnce(makeCompletion('tool_calls', null, [tc1]))
            .mockResolvedValueOnce(makeCompletion('tool_calls', null, [tc2]))
            .mockResolvedValueOnce(makeCompletion('stop', 'Here are nearby pharmacies'));

        mockExecute
            .mockResolvedValueOnce({
                role: 'tool',
                tool_call_id: 'call_1',
                content: JSON.stringify([{ id: 'drug-1', active_ingredient: 'ASPIRIN' }]),
            })
            .mockResolvedValueOnce({
                role: 'tool',
                tool_call_id: 'call_2',
                content: JSON.stringify([{ pharmacy_id: 'ph-1', pharmacy_name: 'Pharmacy A' }]),
            });

        const dto: ChatMessageDto = { message: 'Where can I buy Aspirin?', latitude: 30, longitude: 31 };
        const result = await service.processMessage(dto, 'user-1');

        expect(mockChat).toHaveBeenCalledTimes(3);
        expect(mockExecute).toHaveBeenCalledTimes(2);
        expect(result.reply).toBe('Here are nearby pharmacies');
    });

    // Test 4: finish_reason = 'stop' on first response → loop never executes
    it('should not execute loop when finish_reason is stop immediately', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'Direct answer'));

        const dto: ChatMessageDto = { message: 'What is Paracetamol?' };
        await service.processMessage(dto, 'user-1');

        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    // Test 5: conversationHistory is included between system prompt and user message
    it('should include conversationHistory between system prompt and user message', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'Reply'));

        const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
        ];
        const dto: ChatMessageDto = { message: 'Follow-up', conversationHistory: history };

        await service.processMessage(dto, 'user-1');

        const callArgs = mockChat.mock.calls[0][0] as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };
        const messages = callArgs.messages;

        expect(messages[0].role).toBe('system');
        expect(messages[1]).toEqual(history[0]);
        expect(messages[2]).toEqual(history[1]);
        // The first call to OpenAI has the new user message as the last entry
        expect(messages[3]).toEqual({ role: 'user', content: 'Follow-up' });
    });

    // Test 6: System prompt contains GPS when coordinates provided
    it('should include GPS coordinates in system prompt when provided', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'OK'));

        const dto: ChatMessageDto = { message: 'test', latitude: 30.1, longitude: 31.2 };
        await service.processMessage(dto, 'user-1');

        const callArgs = mockChat.mock.calls[0][0] as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };
        const systemContent = callArgs.messages[0].content as string;
        expect(systemContent).toContain('30.1');
        expect(systemContent).toContain('31.2');
    });

    // Test 7: System prompt notes unavailable GPS when no coordinates
    it('should note GPS unavailability in system prompt when no coordinates provided', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'OK'));

        const dto: ChatMessageDto = { message: 'test' };
        await service.processMessage(dto, 'user-1');

        const callArgs = mockChat.mock.calls[0][0] as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };
        const systemContent = callArgs.messages[0].content as string;
        expect(systemContent.toLowerCase()).toContain('unavailable');
    });

    // Test 8: Returned updatedHistory does NOT contain the system prompt
    it('should not include system prompt in updatedHistory', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'Done'));

        const dto: ChatMessageDto = { message: 'Hello' };
        const result = await service.processMessage(dto, 'user-1');

        const hasSystem = result.updatedHistory.some((m) => m.role === 'system');
        expect(hasSystem).toBe(false);
    });

    // Test 9: SearchLogsService.create() called once per processMessage()
    it('should call SearchLogsService.create() exactly once per processMessage()', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'Done'));

        const dto: ChatMessageDto = { message: 'Hello' };
        await service.processMessage(dto, 'user-1');

        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Test 10: updateResolved() called when search_drug tool used and returned results
    it('should call updateResolved when search_drug was used and returned results', async () => {
        const tc = makeToolCall('search_drug', { query: 'Panadol' });
        mockChat
            .mockResolvedValueOnce(makeCompletion('tool_calls', null, [tc]))
            .mockResolvedValueOnce(makeCompletion('stop', 'Found it'));

        mockExecute.mockResolvedValueOnce({
            role: 'tool',
            tool_call_id: 'call_1',
            content: JSON.stringify([{ id: 'drug-1', active_ingredient: 'PARACETAMOL' }]),
        });

        const dto: ChatMessageDto = { message: 'Panadol' };
        await service.processMessage(dto, 'user-1');

        expect(mockUpdateResolved).toHaveBeenCalledWith(
            'search-log-id-1',
            'PARACETAMOL',
            true,
        );
    });

    // Test 11: Tool executor errors do not crash the loop
    it('should not crash when tool executor returns an error object', async () => {
        const tc = makeToolCall('search_drug', { query: 'BadDrug' });
        mockChat
            .mockResolvedValueOnce(makeCompletion('tool_calls', null, [tc]))
            .mockResolvedValueOnce(makeCompletion('stop', 'Sorry, could not find it'));

        mockExecute.mockResolvedValueOnce({
            role: 'tool',
            tool_call_id: 'call_1',
            content: JSON.stringify({ error: 'DB error' }),
        });

        const dto: ChatMessageDto = { message: 'BadDrug' };
        const result = await service.processMessage(dto, 'user-1');

        expect(result.reply).toBe('Sorry, could not find it');
    });

    // Test 12: userId is correctly passed to search log creation
    it('should pass userId to SearchLogsService.create()', async () => {
        mockChat.mockResolvedValueOnce(makeCompletion('stop', 'OK'));

        const dto: ChatMessageDto = { message: 'test' };
        await service.processMessage(dto, 'specific-user-id');

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'specific-user-id' }),
        );
    });
});
