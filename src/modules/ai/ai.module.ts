import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatModule } from './chat/chat.module';
import { ExcelImportModule } from './excel-import/excel-import.module';

@Module({
    imports: [
        BullModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
            }),
            inject: [ConfigService],
        }),
        ChatModule,
        ExcelImportModule,
    ],
})
export class AiModule { }
