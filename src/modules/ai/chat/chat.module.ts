import { Module } from '@nestjs/common';
import { SupabaseService } from '../../../database/supabase.service';
import { OpenAiService } from '../openai.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatExecutor } from './chat.executor';
import { SearchLogsService } from './search-logs.service';

@Module({
    controllers: [ChatController],
    providers: [
        ChatService,
        ChatExecutor,
        SearchLogsService,
        OpenAiService,
        SupabaseService,
    ],
})
export class ChatModule { }
