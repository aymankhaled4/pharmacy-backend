import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatService } from './chat.service';

@ApiTags('AI Chat')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(SupabaseAuthGuard, RolesGuard)
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Post('chat')
    @Roles('user')
    @ApiOperation({ summary: 'Send a message to the AI assistant' })
    chat(@CurrentUser() user: AuthUser, @Body() dto: ChatMessageDto) {
        return this.chatService.processMessage(dto, user.id);
    }
}
