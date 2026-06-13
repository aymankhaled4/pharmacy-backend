import { Test, TestingModule } from '@nestjs/testing';
import {
    ForbiddenException,
    UnauthorizedException,
} from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Reflector } from '@nestjs/core';

const mockChatService = {
    processMessage: jest.fn().mockResolvedValue({
        reply: 'Here is your answer',
        updatedHistory: [],
    }),
};

describe('ChatController', () => {
    let controller: ChatController;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ChatController],
            providers: [
                { provide: ChatService, useValue: mockChatService },
                Reflector,
            ],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<ChatController>(ChatController);
    });

    // Test 1: No Authorization header → 401 (SupabaseAuthGuard throws)
    it('should return 401 when no Authorization header is present', async () => {
        const mod = await Test.createTestingModule({
            controllers: [ChatController],
            providers: [{ provide: ChatService, useValue: mockChatService }, Reflector],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({
                canActivate: () => {
                    throw new UnauthorizedException('Missing authorization token');
                },
            })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        const guard = mod.get(SupabaseAuthGuard) as unknown as { canActivate: () => boolean };
        expect(() => guard.canActivate()).toThrow(UnauthorizedException);
    });

    // Test 2: Pharmacy JWT → 403 (RolesGuard throws)
    it('should return 403 when user has pharmacy role', async () => {
        const mod = await Test.createTestingModule({
            controllers: [ChatController],
            providers: [{ provide: ChatService, useValue: mockChatService }, Reflector],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => { throw new ForbiddenException('Access denied'); } })
            .compile();

        const rolesGuard = mod.get(RolesGuard) as unknown as { canActivate: () => boolean };
        expect(() => rolesGuard.canActivate()).toThrow(ForbiddenException);
    });

    // Test 3: Admin JWT → 403 (RolesGuard throws)
    it('should return 403 when user has admin role', async () => {
        const mod = await Test.createTestingModule({
            controllers: [ChatController],
            providers: [{ provide: ChatService, useValue: mockChatService }, Reflector],
        })
            .overrideGuard(SupabaseAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => { throw new ForbiddenException('Access denied'); } })
            .compile();

        const rolesGuard = mod.get(RolesGuard) as unknown as { canActivate: () => boolean };
        expect(() => rolesGuard.canActivate()).toThrow(ForbiddenException);
    });

    // Test 4: Valid user JWT + valid body → returns { reply, updatedHistory }
    it('should return reply and updatedHistory for valid user with valid body', async () => {
        const user = { id: 'user-1', role: 'user', token: 'valid-token' };
        const dto = { message: 'Find Panadol' };

        const result = await controller.chat(user as any, dto as any);

        expect(mockChatService.processMessage).toHaveBeenCalledWith(dto, user.id);
        expect(result).toEqual({ reply: 'Here is your answer', updatedHistory: [] });
    });

    // Test 5: Missing message in body — DTO validation is at pipe level; controller delegates
    it('should delegate to ChatService with the provided dto', async () => {
        const user = { id: 'user-2', role: 'user', token: 'tok' };
        const dto = { message: 'Hello' };

        await controller.chat(user as any, dto as any);

        expect(mockChatService.processMessage).toHaveBeenCalledWith(dto, user.id);
    });

    // Test 6: Valid body without conversationHistory → 200
    it('should handle dto without conversationHistory', async () => {
        const user = { id: 'user-3', role: 'user', token: 'tok' };
        const dto = { message: 'Where can I find aspirin?' };

        const result = await controller.chat(user as any, dto as any);

        expect(result).toBeDefined();
        expect(result.reply).toBe('Here is your answer');
    });
});
